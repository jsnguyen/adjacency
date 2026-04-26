import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { TILE_DISTRIBUTION } from '../shared/letters.ts';
import type { Letter } from '../shared/letters.ts';
import { isBoardLayoutType, type BoardLayoutType } from '../shared/boardBonuses.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';
import type {
  GameState,
  LastMoveState,
  MovePreviewState,
  PlayerPublicState,
  TileHolderState,
  TurnHistoryEntryState,
  TurnWordScoreState,
} from '../shared/states.ts';
import { loadDictionary } from './dictionary.ts';
import {
  BOARD_COLS,
  BOARD_ROWS,
  RACK_SIZE,
  coordKey,
  previewMove,
  validateMove,
} from './rules.ts';
import type { LetterTileState } from './rules.ts';
import { loadPersistedRooms, savePersistedRooms, type PersistedRoomState } from './persistence.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DEFAULT_ROOM_ID = 'main';
const DIST_DIR = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dictionary = loadDictionary();
const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const rooms = new Map<string, GameRoom>();
const socketAssignments = new Map<WebSocket, { room: GameRoom; playerId: string }>();
const heartbeatIntervalMs = 30_000;
const sessionAssignments = new Map<string, { roomId: string; playerId: string }>();
const ROOM_CAPACITY = 2;
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

type Player = {
  id: string;
  sessionId: string;
  socket: LiveSocket | null;
  rack: LetterTileState[];
  connected: boolean;
};

type LiveSocket = WebSocket & {
  isAlive: boolean;
};

export class GameRoom {
  readonly id: string;
  private board = new Map<string, LetterTileState>();
  private players = new Map<string, Player>();
  private turnOrder: string[] = [];
  private currentTurnIndex = 0;
  private bag: Letter[];
  private gameEnded = false;
  private finalTurnsRemaining: number | null = null;
  private boardLayout: BoardLayoutType = 'scrabble';
  private nextTileNumber = 1;
  private teamScore = 0;
  private lastMove: LastMoveState = null;
  private turnHistory: TurnHistoryEntryState[] = [];
  private nextTurnNumber = 1;
  private readonly onChange: (() => void) | null;

  constructor(id: string, onChange: (() => void) | null = null) {
    this.id = id;
    this.onChange = onChange;
    this.bag = shuffle(createBag());
  }

  addPlayer(socket: LiveSocket | null, sessionId: string): Player {
    const player: Player = {
      id: randomUUID(),
      sessionId,
      socket,
      rack: [],
      connected: true,
    };
    this.drawRack(player);
    this.players.set(player.id, player);
    this.turnOrder.push(player.id);
    this.markChanged();
    return player;
  }

  removePlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    this.returnRackToBag(player);
    this.players.delete(playerId);

    const removedIndex = this.turnOrder.indexOf(playerId);
    if (removedIndex >= 0) {
      this.turnOrder.splice(removedIndex, 1);
      if (this.turnOrder.length === 0) {
        this.currentTurnIndex = 0;
      } else if (removedIndex < this.currentTurnIndex) {
        this.currentTurnIndex -= 1;
      } else if (removedIndex === this.currentTurnIndex) {
        this.currentTurnIndex %= this.turnOrder.length;
      }
    }

    this.broadcastState();
    this.markChanged();
  }

  isEmpty(): boolean {
    return this.players.size === 0;
  }

  hasOpenSeat(): boolean {
    return this.players.size < ROOM_CAPACITY;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  reconnectPlayer(playerId: string, socket: LiveSocket): Player | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    if (player.socket && player.socket !== socket) {
      socketAssignments.delete(player.socket);
      player.socket.close(1000, 'Session resumed in a new tab.');
    }

    player.socket = socket;
    player.connected = true;
    return player;
  }

  disconnectPlayer(playerId: string): Player | null {
    const player = this.players.get(playerId);
    if (!player) return null;

    player.connected = false;
    player.socket = null;
    this.broadcastState();
    return player;
  }

  playTurn(playerId: string, boardState: TileHolderState, handState: TileHolderState): string | null {
    const player = this.players.get(playerId);
    if (!player) return 'Unknown player.';
    if (this.gameEnded) return 'Game is over.';
    if (this.currentPlayerId() !== playerId) return 'It is not your turn.';

    const result = validateMove(this.board, player.rack, boardState, dictionary.words, this.boardLayout);
    if (!result.ok) return result.reason;
    const playedIds = new Set(result.newTiles.map((tile) => tile.id));
    const rackStateReason = validateSubmittedRack(player.rack, handState, playedIds);
    if (rackStateReason) return rackStateReason;

    for (const tile of result.newTiles) {
      this.board.set(coordKey(tile.col, tile.row), tile);
    }

    player.rack = player.rack.filter((tile) => !playedIds.has(tile.id));
    this.drawRack(player);
    this.teamScore += result.score;
    const wordScores = buildWordScores(result.wordRuns);
    this.lastMove = {
      playerId,
      words: result.words,
      score: result.score,
      message: `Played ${result.words.join(', ')} for ${result.score} points.`,
    };
    this.recordTurn({
      playerId,
      kind: 'play',
      words: wordScores,
      totalScore: result.score,
      message: this.lastMove.message,
    });
    this.completeTurnCycle();
    this.markChanged();
    return null;
  }

  previewTurn(playerId: string, boardState: TileHolderState, handState: TileHolderState): MovePreviewState {
    const player = this.players.get(playerId);
    if (!player) {
      return { valid: false, words: [], totalScore: 0, reason: 'Unknown player.' };
    }
    if (this.gameEnded) {
      return { valid: false, words: [], totalScore: 0, reason: 'Game is over.' };
    }
    if (this.currentPlayerId() !== playerId) {
      return { valid: false, words: [], totalScore: 0, reason: 'It is not your turn.' };
    }

    const preview = previewMove(this.board, player.rack, boardState, dictionary.words, this.boardLayout);
    if (preview.words.length === 0 && !preview.valid) {
      return preview;
    }

    const rackIds = new Set(player.rack.map((tile) => tile.id));
    const committedIds = new Set([...this.board.values()].map((tile) => tile.id));
    const playedIds = new Set(
      boardState.tiles
        .map((tile) => tile.id)
        .filter((tileId) => rackIds.has(tileId) && !committedIds.has(tileId)),
    );
    const rackStateReason = validateSubmittedRack(player.rack, handState, playedIds);
    if (rackStateReason) {
      return {
        valid: false,
        words: preview.words,
        totalScore: preview.totalScore,
        reason: rackStateReason,
      };
    }

    return preview;
  }

  passTurn(playerId: string): string | null {
    if (!this.players.has(playerId)) return 'Unknown player.';
    if (this.gameEnded) return 'Game is over.';
    if (this.currentPlayerId() !== playerId) return 'It is not your turn.';

    this.lastMove = {
      playerId,
      words: [],
      score: 0,
      message: 'Passed.',
    };
    this.recordTurn({
      playerId,
      kind: 'pass',
      words: [],
      totalScore: 0,
      message: 'Passed.',
    });
    this.completeTurnCycle();
    this.markChanged();
    return null;
  }

  exchangeTiles(playerId: string, tileIds: string[]): string | null {
    const player = this.players.get(playerId);
    if (!player) return 'Unknown player.';
    if (this.gameEnded) return 'Game is over.';
    if (this.currentPlayerId() !== playerId) return 'It is not your turn.';

    const uniqueTileIds = [...new Set(tileIds)];
    if (uniqueTileIds.length === 0) return 'Choose at least one tile to exchange.';
    if (this.bag.length < uniqueTileIds.length) return 'There are not enough tiles left in the bag to exchange.';

    const exchangeIds = new Set(uniqueTileIds);
    const exchanging = player.rack.filter((tile) => exchangeIds.has(tile.id));
    if (exchanging.length !== uniqueTileIds.length) {
      return 'You can only exchange tiles from your rack.';
    }

    player.rack = player.rack.filter((tile) => !exchangeIds.has(tile.id));
    this.bag.push(...exchanging.map((tile) => tile.letter));
    shuffleInPlace(this.bag);
    player.rack.push(...this.drawTiles(uniqueTileIds.length));
    this.reindexRack(player);

    this.lastMove = {
      playerId,
      words: [],
      score: 0,
      message: `Exchanged ${uniqueTileIds.length} tile${uniqueTileIds.length === 1 ? '' : 's'}.`,
    };
    this.recordTurn({
      playerId,
      kind: 'exchange',
      words: [],
      totalScore: 0,
      message: this.lastMove.message,
    });
    this.completeTurnCycle();
    this.markChanged();
    return null;
  }

  setBoardLayout(playerId: string, layout: BoardLayoutType): string | null {
    if (!this.players.has(playerId)) return 'Unknown player.';
    if (!this.canChangeBoardLayout()) return 'Board layout can only change before the first turn.';
    if (this.boardLayout === layout) return null;
    this.boardLayout = layout;
    this.markChanged();
    return null;
  }

  resetGame(playerId: string): { ok: true; evictedPlayers: Player[] } | { ok: false; reason: string } {
    const resetPlayer = this.players.get(playerId);
    if (!resetPlayer) return { ok: false, reason: 'Unknown player.' };

    const evictedPlayers = [...this.players.values()].filter((player) => player.id !== playerId);

    this.board.clear();
    this.bag = shuffle(createBag());
    this.gameEnded = false;
    this.finalTurnsRemaining = null;
    this.teamScore = 0;
    this.turnHistory = [];
    this.nextTurnNumber = 1;
    this.lastMove = null;
    this.turnOrder = [playerId];
    this.currentTurnIndex = 0;

    for (const evictedPlayer of evictedPlayers) {
      this.players.delete(evictedPlayer.id);
    }

    resetPlayer.rack = [];
    this.drawRack(resetPlayer);

    this.markChanged();
    return { ok: true, evictedPlayers };
  }

  sendState(socket: WebSocket): void {
    send(socket, { type: 'game_state', state: this.snapshot() });
  }

  broadcastState(): void {
    const state = this.snapshot();
    for (const player of this.players.values()) {
      send(player.socket, { type: 'game_state', state });
    }
  }

  private currentPlayerId(): string | null {
    if (this.gameEnded || this.turnOrder.length === 0) return null;
    return this.turnOrder[this.currentTurnIndex] ?? this.turnOrder[0] ?? null;
  }

  private advanceTurn(): void {
    if (this.turnOrder.length === 0) {
      this.currentTurnIndex = 0;
      return;
    }
    this.currentTurnIndex = (this.currentTurnIndex + 1) % this.turnOrder.length;
  }

  private completeTurnCycle(): void {
    const bagJustEmptied = this.bag.length === 0 && this.finalTurnsRemaining === null;

    if (bagJustEmptied) {
      this.finalTurnsRemaining = this.turnOrder.length;
    } else if (this.finalTurnsRemaining !== null) {
      this.finalTurnsRemaining = Math.max(0, this.finalTurnsRemaining - 1);
      if (this.finalTurnsRemaining === 0) {
        this.gameEnded = true;
        return;
      }
    }

    this.advanceTurn();
  }

  snapshot(): GameState {
    return {
      roomId: this.id,
      board: {
        name: 'board',
        tiles: [...this.board.values()].sort(sortTiles),
      },
      players: [...this.players.values()].map((player): PlayerPublicState => ({
        id: player.id,
        connected: player.connected,
        rack: {
          name: 'hand',
          tiles: [...player.rack].sort(sortTiles),
        },
      })),
      currentPlayerId: this.currentPlayerId(),
      gameEnded: this.gameEnded,
      finalTurnsRemaining: this.finalTurnsRemaining,
      boardLayout: this.boardLayout,
      canChangeBoardLayout: this.canChangeBoardLayout(),
      teamScore: this.teamScore,
      remainingTiles: this.bag.length,
      lastMove: this.lastMove,
      turnHistory: this.turnHistory,
    };
  }

  assignments(): Array<{ playerId: string; sessionId: string }> {
    return [...this.players.values()].map((player) => ({
      playerId: player.id,
      sessionId: player.sessionId,
    }));
  }

  toPersistedState(): PersistedRoomState {
    return {
      id: this.id,
      board: [...this.board.values()].sort(sortTiles),
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        sessionId: player.sessionId,
        rack: [...player.rack].sort(sortTiles),
      })),
      turnOrder: [...this.turnOrder],
      currentTurnIndex: this.currentTurnIndex,
      bag: [...this.bag],
      gameEnded: this.gameEnded,
      finalTurnsRemaining: this.finalTurnsRemaining,
      boardLayout: this.boardLayout,
      nextTileNumber: this.nextTileNumber,
      teamScore: this.teamScore,
      lastMove: this.lastMove,
      turnHistory: [...this.turnHistory],
      nextTurnNumber: this.nextTurnNumber,
      updatedAt: new Date().toISOString(),
    };
  }

  static fromPersistedState(
    state: PersistedRoomState,
    onChange: (() => void) | null = null,
  ): GameRoom {
    const room = new GameRoom(state.id, onChange);
    room.board = new Map(state.board.map((tile) => [coordKey(tile.col, tile.row), tile]));
    room.players = new Map(
      state.players.map((player) => [player.id, {
        id: player.id,
        sessionId: player.sessionId,
        socket: null,
        rack: [...player.rack].sort(sortTiles),
        connected: false,
      }]),
    );
    room.turnOrder = state.turnOrder.filter((playerId) => room.players.has(playerId));
    if (room.turnOrder.length === 0) {
      room.turnOrder = [...room.players.keys()];
    }
    room.currentTurnIndex = room.turnOrder.length === 0
      ? 0
      : Math.max(0, Math.min(room.turnOrder.length - 1, state.currentTurnIndex));
    room.bag = [...state.bag];
    room.gameEnded = state.gameEnded ?? false;
    room.finalTurnsRemaining = state.finalTurnsRemaining ?? null;
    room.boardLayout = state.boardLayout ?? 'scrabble';
    room.nextTileNumber = state.nextTileNumber;
    room.teamScore = state.teamScore;
    room.lastMove = state.lastMove;
    room.turnHistory = [...state.turnHistory];
    room.nextTurnNumber = state.nextTurnNumber;
    return room;
  }

  private drawRack(player: Player): void {
    while (player.rack.length < RACK_SIZE && this.bag.length > 0) {
      player.rack.push(...this.drawTiles(1));
    }
    this.reindexRack(player);
  }

  private drawTiles(count: number): LetterTileState[] {
    const tiles: LetterTileState[] = [];
    for (let index = 0; index < count; index += 1) {
      const letter = this.bag.pop();
      if (!letter) break;
      tiles.push({
        id: `tile-${this.nextTileNumber}`,
        letter,
        col: 0,
        row: 0,
      });
      this.nextTileNumber += 1;
    }
    return tiles;
  }

  private reindexRack(player: Player): void {
    player.rack = player.rack.map((tile, index) => ({
      ...tile,
      col: index,
      row: 0,
    }));
  }

  private recordTurn(entry: Omit<TurnHistoryEntryState, 'turn'>): void {
    this.turnHistory.unshift({
      turn: this.nextTurnNumber,
      ...entry,
    });
    this.nextTurnNumber += 1;
  }

  private markChanged(): void {
    this.onChange?.();
  }

  private canChangeBoardLayout(): boolean {
    return this.board.size === 0 && this.turnHistory.every((entry) => entry.kind === 'reset');
  }

  private returnRackToBag(player: Player): void {
    this.bag.push(...player.rack.map((tile) => tile.letter));
    shuffleInPlace(this.bag);
    player.rack = [];
  }
}

function getRoom(roomId: string): GameRoom {
  const existingRoom = rooms.get(roomId);
  if (existingRoom) return existingRoom;

  const room = new GameRoom(roomId, persistRooms);
  rooms.set(roomId, room);
  persistRooms();
  return room;
}

function joinRoom(socket: LiveSocket, roomId: string, requestedSessionId?: string): void {
  const normalisedRoomId = normaliseRoomId(roomId);
  if (!normalisedRoomId) {
    send(socket, { type: 'error', msg: 'Room names can use letters, numbers, underscores, and dashes only.' });
    return;
  }

  const reconnectPlayer = requestedSessionId
    ? reconnectExistingPlayer(socket, requestedSessionId, normalisedRoomId)
    : null;
  if (reconnectPlayer) return;

  const room = getRoom(normalisedRoomId);
  if (!room.hasOpenSeat()) {
    send(socket, { type: 'error', msg: 'Room is full. Each room supports 2 players.' });
    return;
  }

  leaveAssignedRoom(socket);
  const sessionId = randomUUID();
  const player = room.addPlayer(socket, sessionId);
  sessionAssignments.set(sessionId, { roomId: room.id, playerId: player.id });
  socketAssignments.set(socket, { room, playerId: player.id });
  send(socket, { type: 'player_id', playerId: player.id, sessionId, roomId: room.id });
  room.broadcastState();
}

function leaveAssignedRoom(socket: WebSocket): void {
  const assignment = socketAssignments.get(socket);
  if (!assignment) return;

  socketAssignments.delete(socket);
  assignment.room.disconnectPlayer(assignment.playerId);
}

function send(socket: WebSocket | null | undefined, msg: ServerMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function rejectTurn(socket: WebSocket, _room: GameRoom, reason: string): void {
  send(socket, { type: 'turn_rejected', reason });
  void _room;
}

function handleMessage(socket: LiveSocket, msg: ClientMessage): void {
  if (msg.type === 'join_room') {
    joinRoom(socket, msg.roomId);
    return;
  }

  const assignment = socketAssignments.get(socket);
  if (!assignment) {
    send(socket, { type: 'error', msg: 'Join a room before sending game actions.' });
    return;
  }

  const { room } = assignment;
  switch (msg.type) {
    case 'play_turn': {
      const reason = room.playTurn(msg.playerId, msg.boardState, msg.handState);
      if (reason) {
        rejectTurn(socket, room, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'preview_turn': {
      send(socket, {
        type: 'move_preview',
        preview: room.previewTurn(msg.playerId, msg.boardState, msg.handState),
        requestId: msg.requestId,
      });
      break;
    }
    case 'pass_turn': {
      const reason = room.passTurn(msg.playerId);
      if (reason) {
        rejectTurn(socket, room, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'exchange_tiles': {
      const reason = room.exchangeTiles(msg.playerId, msg.tileIds);
      if (reason) {
        rejectTurn(socket, room, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'set_board_layout': {
      const reason = room.setBoardLayout(msg.playerId, msg.layout);
      if (reason) {
        rejectTurn(socket, room, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'reset_game': {
      const result = room.resetGame(msg.playerId);
      if (!result.ok) {
        rejectTurn(socket, room, result.reason);
      } else {
        for (const evictedPlayer of result.evictedPlayers) {
          sessionAssignments.delete(evictedPlayer.sessionId);
          if (evictedPlayer.socket) {
            socketAssignments.delete(evictedPlayer.socket);
            send(evictedPlayer.socket, {
              type: 'removed_from_room',
              roomId: room.id,
              msg: 'The room was reset. Rejoin to keep playing.',
            });
          }
        }
        room.broadcastState();
      }
      break;
    }
  }
}

export function createBag(): Letter[] {
  const letters: Letter[] = [];
  for (const [letter, count] of Object.entries(TILE_DISTRIBUTION) as [Letter, number][]) {
    for (let index = 0; index < count; index += 1) {
      letters.push(letter);
    }
  }
  return letters;
}

function shuffle<T>(items: T[]): T[] {
  return shuffleInPlace([...items]);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function sortTiles(a: LetterTileState, b: LetterTileState): number {
  return a.row - b.row || a.col - b.col || a.id.localeCompare(b.id);
}

function validateSubmittedRack(
  playerRack: LetterTileState[],
  handState: TileHolderState,
  playedIds: Set<string>,
): string | null {
  const rackIds = new Set(playerRack.map((tile) => tile.id));
  const handIds = new Set<string>();

  for (const tile of handState.tiles) {
    if (playedIds.has(tile.id)) {
      return 'Played tiles cannot also remain in your rack.';
    }
    if (!rackIds.has(tile.id)) {
      return 'The submitted hand contains a tile that is not in your rack.';
    }
    if (handIds.has(tile.id)) {
      return 'The submitted hand contains a duplicate tile id.';
    }
    handIds.add(tile.id);
  }

  for (const rackId of rackIds) {
    if (!playedIds.has(rackId) && !handIds.has(rackId)) {
      return 'The submitted hand is missing an unplayed rack tile.';
    }
  }

  return null;
}

function buildWordScores(words: MovePreviewState['words']): TurnWordScoreState[] {
  return words.map((word) => ({
    kind: word.kind,
    word: word.word,
    score: word.score,
    letters: word.letters,
    letterSubtotal: word.letterSubtotal,
    wordMultiplier: word.wordMultiplier,
    wordBonuses: word.wordBonuses,
  }));
}

function persistRooms(): void {
  savePersistedRooms([...rooms.values()].map((room) => room.toPersistedState()));
}

function restoreRooms(): void {
  for (const persistedRoom of loadPersistedRooms()) {
    const room = GameRoom.fromPersistedState(persistedRoom, persistRooms);
    rooms.set(room.id, room);
    for (const assignment of room.assignments()) {
      sessionAssignments.set(assignment.sessionId, { roomId: room.id, playerId: assignment.playerId });
    }
  }
}

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  const liveSocket = socket as LiveSocket;
  liveSocket.isAlive = true;
  liveSocket.on('pong', () => {
    liveSocket.isAlive = true;
  });

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const requestedRoomId = requestUrl.searchParams.get('room') ?? DEFAULT_ROOM_ID;
  const requestedSessionId = requestUrl.searchParams.get('session') ?? undefined;
  joinRoom(liveSocket, requestedRoomId, requestedSessionId);

  liveSocket.on('message', (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(liveSocket, { type: 'error', msg: 'Could not parse client message.' });
      return;
    }

    if (!isClientMessage(msg)) {
      send(liveSocket, { type: 'error', msg: 'Client message is missing required fields.' });
      return;
    }

    handleMessage(liveSocket, msg);
  });

  liveSocket.on('close', () => {
    leaveAssignedRoom(liveSocket);
  });
});

server.on('upgrade', (request, socket, head) => {
  const { pathname } = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (webSocket) => {
    wss.emit('connection', webSocket, request);
  });
});

server.on('clientError', (_error, socket) => {
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    const liveSocket = socket as LiveSocket;
    if (!liveSocket.isAlive) {
      liveSocket.terminate();
      continue;
    }
    liveSocket.isAlive = false;
    liveSocket.ping();
  }
}, heartbeatIntervalMs);
heartbeat.unref();

export function startServer(): void {
  if (rooms.size === 0) {
    restoreRooms();
  }
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  server.listen(PORT, HOST, () => {
    console.log(`Loaded ${dictionary.words.size} dictionary words from ${dictionary.source}.`);
    console.log(`Server listening on http://${HOST}:${PORT}`);
  });
}

function handleHttpRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      rooms: rooms.size,
      dictionaryWords: dictionary.words.size,
    });
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end();
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (requestUrl.pathname === '/ws') {
    response.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Use a WebSocket connection for /ws.');
    return;
  }

  const target = staticFilePath(requestUrl.pathname);
  if (!target) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not found.');
    return;
  }

  const stat = statSync(target);
  response.writeHead(200, {
    'Content-Type': contentType(target),
    'Content-Length': stat.size,
    'Cache-Control': target.includes(`${sep}assets${sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(target).pipe(response);
}

function staticFilePath(pathname: string): string | null {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requestPath = decodedPathname === '/' ? '/index.html' : decodedPathname;
  const directPath = resolve(DIST_DIR, `.${requestPath}`);
  if (!isPathInside(directPath, DIST_DIR)) return null;

  if (existsSync(directPath) && statSync(directPath).isFile()) {
    return directPath;
  }

  if (requestPath.startsWith('/assets/')) {
    return null;
  }

  const indexPath = join(DIST_DIR, 'index.html');
  return existsSync(indexPath) ? indexPath : null;
}

function isPathInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function normaliseRoomId(roomId: string): string | null {
  const trimmedRoomId = roomId.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmedRoomId)) return null;
  return trimmedRoomId;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'join_room':
      return typeof value.roomId === 'string';
    case 'play_turn':
      return (
        typeof value.playerId === 'string' &&
        isTileHolderState(value.handState) &&
        isTileHolderState(value.boardState)
      );
    case 'preview_turn':
      return (
        typeof value.playerId === 'string' &&
        Number.isInteger(value.requestId) &&
        isTileHolderState(value.handState) &&
        isTileHolderState(value.boardState)
      );
    case 'pass_turn':
      return typeof value.playerId === 'string';
    case 'exchange_tiles':
      return (
        typeof value.playerId === 'string' &&
        Array.isArray(value.tileIds) &&
        value.tileIds.length <= RACK_SIZE &&
        value.tileIds.every((tileId) => typeof tileId === 'string')
      );
    case 'set_board_layout':
      return (
        typeof value.playerId === 'string' &&
        isBoardLayoutType(value.layout)
      );
    case 'reset_game':
      return typeof value.playerId === 'string';
    default:
      return false;
  }
}

function isTileHolderState(value: unknown): value is TileHolderState {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    Array.isArray(value.tiles) &&
    value.tiles.length <= BOARD_COLS * BOARD_ROWS &&
    value.tiles.every(isTileState)
  );
}

function isTileState(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (typeof value.letter === 'string' || value.letter === null) &&
    Number.isInteger(value.col) &&
    Number.isInteger(value.row)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`);
  clearInterval(heartbeat);
  for (const client of wss.clients) {
    client.close(1001, 'Server shutting down.');
  }
  wss.close();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => {
    process.exit(1);
  }, 5000).unref();
}

function reconnectExistingPlayer(socket: LiveSocket, sessionId: string, requestedRoomId: string): Player | null {
  const assignment = sessionAssignments.get(sessionId);
  if (!assignment) return null;
  if (assignment.roomId !== requestedRoomId) return null;

  const room = rooms.get(assignment.roomId);
  const player = room?.reconnectPlayer(assignment.playerId, socket);
  if (!room || !player) {
    sessionAssignments.delete(sessionId);
    return null;
  }

  socketAssignments.set(socket, { room, playerId: player.id });
  send(socket, { type: 'player_id', playerId: player.id, sessionId: player.sessionId, roomId: room.id });
  room.broadcastState();
  return player;
}

if (isMainModule) {
  startServer();
}
