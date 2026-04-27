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
  GameSummaryState,
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
import {
  loadPersistedGames,
  savePersistedGames,
  type PersistedGameState,
} from './database.ts';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST_DIR = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const dictionary = loadDictionary();
const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const rooms = new Map<string, GameRoom>();
type SocketAssignment = {
  room: GameRoom;
  playerId: string | null;
};

const socketAssignments = new Map<WebSocket, SocketAssignment>();
const heartbeatIntervalMs = 30_000;
const isMainModule = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

type Player = {
  id: string;
  claimToken: string;
  name: string;
  seat: number;
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
  private singlePlayer = false;
  private boardLayout: BoardLayoutType = 'scrabble';
  private nextTileNumber = 1;
  private teamScore = 0;
  private lastMove: LastMoveState = null;
  private turnHistory: TurnHistoryEntryState[] = [];
  private nextTurnNumber = 1;
  private createdAt = new Date().toISOString();
  private updatedAt = this.createdAt;
  private readonly onChange: (() => void) | null;

  constructor(id: string, onChange: (() => void) | null = null) {
    this.id = id;
    this.onChange = onChange;
    this.bag = shuffle(createBag());
  }

  claimSeat(
    name: string | null = null,
    seat: number | null = null,
    claimToken: string = randomUUID(),
    socket: LiveSocket | null = null,
  ): Player | null {
    if (this.singlePlayer && this.players.size >= 1) return null;
    const nextSeat = seat ?? this.firstOpenSeat();
    if (nextSeat !== 1 && nextSeat !== 2) return null;
    if (nextSeat === null || this.playerForSeat(nextSeat)) return null;
    const resolvedName = normalizePlayerName(name ?? '') ?? defaultSeatName(nextSeat);

    const player: Player = {
      id: randomUUID(),
      claimToken,
      name: resolvedName,
      seat: nextSeat,
      socket,
      rack: [],
      connected: socket !== null,
    };
    this.drawRack(player);
    this.players.set(player.id, player);
    this.turnOrder.push(player.id);
    this.markChanged();
    return player;
  }

  getPlayer(playerId: string): Player | undefined {
    return this.players.get(playerId);
  }

  getPlayerByClaimToken(claimToken: string): Player | undefined {
    return [...this.players.values()].find((player) => player.claimToken === claimToken);
  }

  reconnectClaim(claimToken: string, socket: LiveSocket): Player | null {
    const player = this.getPlayerByClaimToken(claimToken);
    if (!player) return null;

    if (player.socket && player.socket !== socket) {
      socketAssignments.delete(player.socket);
      player.socket.close(1000, 'Claim resumed in a new tab.');
    }

    player.socket = socket;
    player.connected = true;
    return player;
  }

  updatePlayerName(playerId: string, name: string): string | null {
    const player = this.players.get(playerId);
    if (!player) return 'Unknown player.';
    if (player.name === name) return null;
    player.name = name;
    this.markChanged();
    return null;
  }

  hasOpenSeat(): boolean {
    return !this.singlePlayer && this.players.size < 2;
  }

  isSinglePlayer(): boolean {
    return this.singlePlayer;
  }

  private playerForSeat(seat: number): Player | undefined {
    return [...this.players.values()].find((player) => player.seat === seat);
  }

  private firstOpenSeat(): number | null {
    for (const seat of [1, 2]) {
      if (!this.playerForSeat(seat)) return seat;
    }
    return null;
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
    if (!this.isReadyToPlay()) return 'Waiting for another player to claim the open seat.';
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
      playerName: player.name,
      words: result.words,
      score: result.score,
      message: `Played ${result.words.join(', ')} for ${result.score} points.`,
    };
    this.recordTurn({
      playerId,
      playerName: player.name,
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
    if (!this.isReadyToPlay()) {
      return { valid: false, words: [], totalScore: 0, reason: 'Waiting for another player to claim the open seat.' };
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
    if (!this.isReadyToPlay()) return 'Waiting for another player to claim the open seat.';
    if (this.currentPlayerId() !== playerId) return 'It is not your turn.';

    this.lastMove = {
      playerId,
      playerName: this.players.get(playerId)?.name ?? 'Unknown',
      words: [],
      score: 0,
      message: 'Passed.',
    };
    this.recordTurn({
      playerId,
      playerName: this.players.get(playerId)?.name ?? 'Unknown',
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
    if (!this.isReadyToPlay()) return 'Waiting for another player to claim the open seat.';
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
      playerName: player.name,
      words: [],
      score: 0,
      message: `Exchanged ${uniqueTileIds.length} tile${uniqueTileIds.length === 1 ? '' : 's'}.`,
    };
    this.recordTurn({
      playerId,
      playerName: player.name,
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

  setSinglePlayer(playerId: string, enabled: boolean): string | null {
    if (!this.players.has(playerId)) return 'Unknown player.';
    if (enabled && this.players.size > 1) {
      return 'Single-player mode can only be enabled before a partner joins.';
    }
    if (!this.canChangeSinglePlayer()) {
      return 'Single-player mode can only change before the first turn.';
    }
    if (this.singlePlayer === enabled) return null;
    this.singlePlayer = enabled;
    this.markChanged();
    return null;
  }

  resetGame(playerId: string): { ok: true } | { ok: false; reason: string } {
    const resetPlayer = this.players.get(playerId);
    if (!resetPlayer) return { ok: false, reason: 'Unknown player.' };

    this.board.clear();
    this.bag = shuffle(createBag());
    this.gameEnded = false;
    this.finalTurnsRemaining = null;
    this.teamScore = 0;
    this.turnHistory = [];
    this.nextTurnNumber = 1;
    this.lastMove = null;
    this.turnOrder = [...this.players.values()]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => player.id);
    this.currentTurnIndex = Math.max(0, this.turnOrder.indexOf(playerId));

    for (const player of this.players.values()) {
      player.rack = [];
      this.drawRack(player);
    }

    this.markChanged();
    return { ok: true };
  }

  sendState(socket: WebSocket): void {
    send(socket, { type: 'game_state', state: this.snapshot() });
  }

  broadcastState(): void {
    broadcastRoomState(this);
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

  summary(): GameSummaryState {
    const playersBySeat = [1, 2].map((seat) => this.playerForSeat(seat));
    return {
      gameId: this.id,
      players: playersBySeat.map((player, index) => ({
        id: player?.id ?? null,
        name: player?.name ?? null,
        seat: index + 1,
        connected: player?.connected ?? false,
      })),
      currentPlayerId: this.isReadyToPlay() ? this.currentPlayerId() : null,
      gameEnded: this.gameEnded,
      singlePlayer: this.singlePlayer,
      canChangeSinglePlayer: this.canChangeSinglePlayer(),
      teamScore: this.teamScore,
      updatedAt: this.updatedAt,
    };
  }

  snapshot(): GameState {
    return {
      gameId: this.id,
      board: {
        name: 'board',
        tiles: [...this.board.values()].sort(sortTiles),
      },
      players: [...this.players.values()]
        .sort((left, right) => left.seat - right.seat)
        .map((player): PlayerPublicState => ({
          id: player.id,
          name: player.name,
          seat: player.seat,
          connected: player.connected,
          rack: {
            name: 'hand',
            tiles: [...player.rack].sort(sortTiles),
          },
        })),
      currentPlayerId: this.isReadyToPlay() ? this.currentPlayerId() : null,
      gameEnded: this.gameEnded,
      finalTurnsRemaining: this.finalTurnsRemaining,
      singlePlayer: this.singlePlayer,
      canChangeSinglePlayer: this.canChangeSinglePlayer(),
      boardLayout: this.boardLayout,
      canChangeBoardLayout: this.canChangeBoardLayout(),
      teamScore: this.teamScore,
      remainingTiles: this.bag.length,
      lastMove: this.lastMove,
      turnHistory: this.turnHistory,
    };
  }

  toPersistedState(): PersistedGameState {
    return {
      id: this.id,
      board: [...this.board.values()].sort(sortTiles),
      players: [...this.players.values()].map((player) => ({
        id: player.id,
        claimToken: player.claimToken,
        name: player.name,
        seat: player.seat,
        rack: [...player.rack].sort(sortTiles),
      })),
      turnOrder: [...this.turnOrder],
      currentTurnIndex: this.currentTurnIndex,
      bag: [...this.bag],
      gameEnded: this.gameEnded,
      finalTurnsRemaining: this.finalTurnsRemaining,
      singlePlayer: this.singlePlayer,
      boardLayout: this.boardLayout,
      nextTileNumber: this.nextTileNumber,
      teamScore: this.teamScore,
      lastMove: this.lastMove,
      turnHistory: [...this.turnHistory],
      nextTurnNumber: this.nextTurnNumber,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }

  static fromPersistedState(
    state: PersistedGameState,
    onChange: (() => void) | null = null,
  ): GameRoom {
    const room = new GameRoom(state.id, onChange);
    const persistedBoard = Array.isArray(state.board) ? state.board : [];
    const persistedPlayers = Array.isArray(state.players) ? state.players : [];
    const persistedTurnOrder = Array.isArray(state.turnOrder) ? state.turnOrder : [];

    room.board = new Map(persistedBoard.map((tile) => [coordKey(tile.col, tile.row), tile]));
    room.players = new Map(
      persistedPlayers.map((player) => [player.id, {
        id: player.id,
        claimToken: player.claimToken,
        name: player.name,
        seat: player.seat,
        socket: null,
        rack: [...player.rack].sort(sortTiles),
        connected: false,
      }]),
    );
    room.turnOrder = persistedTurnOrder.filter((playerId) => room.players.has(playerId));
    if (room.turnOrder.length === 0) {
      room.turnOrder = [...room.players.values()]
        .sort((left, right) => left.seat - right.seat)
        .map((player) => player.id);
    }
    const persistedTurnIndex = Number.isInteger(state.currentTurnIndex)
      ? Number(state.currentTurnIndex)
      : 0;
    room.currentTurnIndex = room.turnOrder.length === 0
      ? 0
      : Math.max(0, Math.min(room.turnOrder.length - 1, persistedTurnIndex));
    room.bag = Array.isArray(state.bag) ? [...state.bag] : [];
    room.gameEnded = state.gameEnded ?? false;
    room.finalTurnsRemaining = state.finalTurnsRemaining ?? null;
    room.singlePlayer = state.singlePlayer ?? false;
    room.boardLayout = isBoardLayoutType(state.boardLayout) ? state.boardLayout : 'scrabble';
    room.nextTileNumber = normalizePositiveInteger(state.nextTileNumber, inferNextTileNumber(room));
    room.teamScore = Number.isFinite(state.teamScore) ? state.teamScore : 0;
    room.lastMove = state.lastMove ?? null;
    room.turnHistory = Array.isArray(state.turnHistory) ? [...state.turnHistory] : [];
    room.nextTurnNumber = normalizePositiveInteger(
      state.nextTurnNumber,
      inferNextTurnNumber(room.turnHistory),
    );
    room.createdAt = typeof state.createdAt === 'string' ? state.createdAt : new Date().toISOString();
    room.updatedAt = typeof state.updatedAt === 'string' ? state.updatedAt : room.createdAt;
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
    this.updatedAt = new Date().toISOString();
    this.onChange?.();
  }

  private canChangeBoardLayout(): boolean {
    return this.board.size === 0 && this.turnHistory.every((entry) => entry.kind === 'reset');
  }

  private canChangeSinglePlayer(): boolean {
    return this.board.size === 0 && this.turnHistory.every((entry) => entry.kind === 'reset') && this.players.size <= 1;
  }

  private isReadyToPlay(): boolean {
    return this.singlePlayer || this.players.size >= 2;
  }
}

function getGame(gameId: string): GameRoom | null {
  const normalizedGameId = normalizeGameId(gameId);
  if (!normalizedGameId) return null;
  return rooms.get(normalizedGameId) ?? null;
}

function createGame(name: string | null = null): { game: GameRoom; player: Player } {
  const game = new GameRoom(randomUUID(), persistGames);
  const player = game.claimSeat(name, 1, randomUUID(), null);
  if (!player) {
    throw new Error('Could not claim the first seat for the new game.');
  }
  rooms.set(game.id, game);
  persistGames();
  return { game, player };
}

function attachSocketToGame(socket: LiveSocket, claimToken: string | null, gameId: string): void {
  const game = getGame(gameId);
  if (!game) {
    send(socket, { type: 'error', msg: 'Game not found.' });
    socket.close(1008, 'Unknown game.');
    return;
  }

  leaveAssignedGame(socket);

  const normalizedClaimToken = claimToken?.trim() ?? '';
  if (normalizedClaimToken.length === 0) {
    socketAssignments.set(socket, { room: game, playerId: null });
    game.sendState(socket);
    return;
  }

  const player = game.reconnectClaim(normalizedClaimToken, socket);
  if (!player) {
    send(socket, { type: 'error', msg: 'That claim token does not match a seat in this game.' });
    socket.close(1008, 'Invalid claim token.');
    return;
  }

  socketAssignments.set(socket, { room: game, playerId: player.id });
  game.broadcastState();
}

function leaveAssignedGame(socket: WebSocket): void {
  const assignment = socketAssignments.get(socket);
  if (!assignment) return;

  socketAssignments.delete(socket);
  if (assignment.playerId) {
    assignment.room.disconnectPlayer(assignment.playerId);
  }
}

function send(socket: WebSocket | null | undefined, msg: ServerMessage): void {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function broadcastRoomState(room: GameRoom): void {
  const state = room.snapshot();
  for (const [socket, assignment] of socketAssignments.entries()) {
    if (assignment.room !== room) continue;
    send(socket, { type: 'game_state', state });
  }
}

function rejectTurn(socket: WebSocket, reason: string): void {
  send(socket, { type: 'turn_rejected', reason });
}

function handleMessage(socket: LiveSocket, msg: ClientMessage): void {
  const assignment = socketAssignments.get(socket);
  if (!assignment) {
    send(socket, { type: 'error', msg: 'Select a game before sending moves.' });
    return;
  }

  const { room, playerId } = assignment;
  if (!playerId) {
    rejectTurn(socket, 'Spectators cannot play.');
    return;
  }

  switch (msg.type) {
    case 'play_turn': {
      const reason = room.playTurn(playerId, msg.boardState, msg.handState);
      if (reason) {
        rejectTurn(socket, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'preview_turn': {
      send(socket, {
        type: 'move_preview',
        preview: room.previewTurn(playerId, msg.boardState, msg.handState),
        requestId: msg.requestId,
      });
      break;
    }
    case 'pass_turn': {
      const reason = room.passTurn(playerId);
      if (reason) {
        rejectTurn(socket, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'exchange_tiles': {
      const reason = room.exchangeTiles(playerId, msg.tileIds);
      if (reason) {
        rejectTurn(socket, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'set_board_layout': {
      const reason = room.setBoardLayout(playerId, msg.layout);
      if (reason) {
        rejectTurn(socket, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'set_single_player': {
      const reason = room.setSinglePlayer(playerId, msg.enabled);
      if (reason) {
        rejectTurn(socket, reason);
      } else {
        room.broadcastState();
      }
      break;
    }
    case 'reset_game': {
      const result = room.resetGame(playerId);
      if (!result.ok) {
        rejectTurn(socket, result.reason);
      } else {
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

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function inferNextTileNumber(room: GameRoom): number {
  const tileIds = [
    ...room.snapshot().board.tiles,
    ...room.snapshot().players.flatMap((player) => player.rack.tiles),
  ].map((tile) => tile.id);
  const maxTileNumber = tileIds.reduce((max, tileId) => {
    const match = /^tile-(\d+)$/.exec(tileId);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return maxTileNumber + 1;
}

function inferNextTurnNumber(turnHistory: TurnHistoryEntryState[]): number {
  const maxTurnNumber = turnHistory.reduce((max, entry) => Math.max(max, entry.turn), 0);
  return maxTurnNumber + 1;
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

function persistGames(): void {
  savePersistedGames([...rooms.values()].map((room) => room.toPersistedState()));
}

function restoreGames(): void {
  for (const persistedGame of loadPersistedGames()) {
    const room = GameRoom.fromPersistedState(persistedGame, persistGames);
    rooms.set(room.id, room);
  }
}

wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
  const liveSocket = socket as LiveSocket;
  liveSocket.isAlive = true;
  liveSocket.on('pong', () => {
    liveSocket.isAlive = true;
  });

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const requestedGameId = requestUrl.searchParams.get('game');
  const requestedClaimToken = requestUrl.searchParams.get('claim');
  if (!requestedGameId) {
    send(liveSocket, { type: 'error', msg: 'Missing game id.' });
    liveSocket.close(1008, 'Missing game id.');
    return;
  }
  attachSocketToGame(liveSocket, requestedClaimToken, requestedGameId);

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
    leaveAssignedGame(liveSocket);
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
    restoreGames();
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
      games: rooms.size,
      dictionaryWords: dictionary.words.size,
    });
    return;
  }

  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const gamePathMatch = requestUrl.pathname.match(/^\/api\/games\/([A-Za-z0-9_-]{1,64})$/);
  const gameClaimMatch = requestUrl.pathname.match(/^\/api\/games\/([A-Za-z0-9_-]{1,64})\/claim$/);
  const gamePlayerMatch = requestUrl.pathname.match(/^\/api\/games\/([A-Za-z0-9_-]{1,64})\/player$/);

  if (requestUrl.pathname === '/api/games' && request.method === 'POST') {
    void handleCreateGame(request, response);
    return;
  }

  if (gamePathMatch && request.method === 'GET') {
    handleGameSummary(gamePathMatch[1], response);
    return;
  }

  if (gameClaimMatch && request.method === 'POST') {
    void handleClaimGame(request, response, gameClaimMatch[1]);
    return;
  }

  if (gamePlayerMatch && request.method === 'PATCH') {
    void handleRenamePlayer(request, response, gamePlayerMatch[1]);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST, PATCH' });
    response.end();
    return;
  }

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

async function handleCreateGame(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody(request);
  const name = typeof body.name === 'string' ? body.name : null;

  const { game, player } = createGame(name);
  sendJson(response, 200, {
    game: game.summary(),
    claim: buildClaimResponse(game.id, player),
  });
}

function handleGameSummary(gameId: string, response: ServerResponse): void {
  const game = getGame(gameId);
  if (!game) {
    sendJson(response, 404, { msg: 'Game not found.' });
    return;
  }

  sendJson(response, 200, {
    game: game.summary(),
  });
}

async function handleClaimGame(request: IncomingMessage, response: ServerResponse, gameId: string): Promise<void> {
  const game = getGame(gameId);
  if (!game) {
    sendJson(response, 404, { msg: 'Game not found.' });
    return;
  }

  if (game.isSinglePlayer()) {
    sendJson(response, 409, { msg: 'Single-player mode is enabled for this game.' });
    return;
  }

  if (!game.hasOpenSeat()) {
    sendJson(response, 409, { msg: 'Both seats are already claimed.' });
    return;
  }

  const body = await readJsonBody(request);
  const name = typeof body.name === 'string' ? body.name : null;

  const player = game.claimSeat(name);
  if (!player) {
    sendJson(response, 409, { msg: 'Could not claim an open seat in this game.' });
    return;
  }

  persistGames();
  game.broadcastState();
  sendJson(response, 200, {
    game: game.summary(),
    claim: buildClaimResponse(game.id, player),
  });
}

async function handleRenamePlayer(request: IncomingMessage, response: ServerResponse, gameId: string): Promise<void> {
  const game = getGame(gameId);
  if (!game) {
    sendJson(response, 404, { msg: 'Game not found.' });
    return;
  }

  const body = await readJsonBody(request);
  const claimToken = typeof body.claimToken === 'string' ? body.claimToken.trim() : '';
  if (claimToken.length === 0) {
    sendJson(response, 400, { msg: 'Missing claim token.' });
    return;
  }

  const player = game.getPlayerByClaimToken(claimToken);
  if (!player) {
    sendJson(response, 401, { msg: 'That claim token does not match a seat in this game.' });
    return;
  }

  const name = normalizePlayerName(typeof body.name === 'string' ? body.name : '');
  if (!name) {
    sendJson(response, 400, { msg: 'Names must be 1-24 characters and use letters, numbers, spaces, apostrophes, periods, underscores, or dashes.' });
    return;
  }

  const reason = game.updatePlayerName(player.id, name);
  if (reason) {
    sendJson(response, 400, { msg: reason });
    return;
  }

  game.broadcastState();
  sendJson(response, 200, {
    game: game.summary(),
    claim: buildClaimResponse(game.id, game.getPlayer(player.id) ?? player),
  });
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
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8';
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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) return {};

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePlayerName(name: string): string | null {
  const trimmedName = name.trim();
  if (!/^[A-Za-z0-9 _.'-]{1,24}$/.test(trimmedName)) return null;
  return trimmedName;
}

function defaultSeatName(seat: number): string {
  return `Player ${seat}`;
}

function buildClaimResponse(gameId: string, player: Player): {
  gameId: string;
  claimToken: string;
  playerId: string;
  playerName: string;
  seat: number;
} {
  return {
    gameId,
    claimToken: player.claimToken,
    playerId: player.id,
    playerName: player.name,
    seat: player.seat,
  };
}

function normalizeGameId(gameId: string): string | null {
  const trimmedGameId = gameId.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmedGameId)) return null;
  return trimmedGameId;
}

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;

  switch (value.type) {
    case 'play_turn':
      return (
        isTileHolderState(value.handState) &&
        isTileHolderState(value.boardState)
      );
    case 'preview_turn':
      return (
        Number.isInteger(value.requestId) &&
        isTileHolderState(value.handState) &&
        isTileHolderState(value.boardState)
      );
    case 'pass_turn':
      return true;
    case 'exchange_tiles':
      return (
        Array.isArray(value.tileIds) &&
        value.tileIds.length <= RACK_SIZE &&
        value.tileIds.every((tileId) => typeof tileId === 'string')
      );
    case 'set_board_layout':
      return isBoardLayoutType(value.layout);
    case 'set_single_player':
      return typeof value.enabled === 'boolean';
    case 'reset_game':
      return true;
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

if (isMainModule) {
  startServer();
}
