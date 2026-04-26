import { GRID, APP_WIDTH } from './constants.ts'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import type { GameState, PlayerPublicState, TileHolderState, TileState } from '../shared/states.ts'
import { Actions } from './actions.ts'
import { Board } from './board.ts'
import { Hand } from './hand.ts'
import { Tile } from './tile.ts'
import { makeDraggable } from './draggable.ts'
import { setPlayerId, getPlayerId, hasPlayerId } from './clientState.ts'; // kinda like globals

const reconnectBaseDelayMs = 400;
const reconnectMaxDelayMs = 8000;

let socket: WebSocket;
let reconnectAttempts = 0;
let latestGameState: GameState | null = null;
let waitingForServer = false;
let statusBar: HTMLDivElement;
let statusMessage: HTMLDivElement;
let statusStats: HTMLDivElement;
let moveBar: HTMLDivElement;
let playButton: HTMLButtonElement | null = null;
let passButton: HTMLButtonElement | null = null;
let exchangeButton: HTMLButtonElement | null = null;
let shuffleButton: HTMLButtonElement | null = null;
let recallButton: HTMLButtonElement | null = null;
let selectedExchangeIds = new Set<string>();

connectSocket();

function sendMessageToServer(message: ClientMessage): void {
  if (!socketIsOpen()) {
    setStatus('Socket is not open yet.');
    return;
  }

  waitingForServer = true;
  updateActionButtons();
  socket.send(JSON.stringify(message));
}

function sendTurnToServer(handState: TileHolderState, boardState: TileHolderState): void {
  if (!hasPlayerId()) {
    setStatus('Waiting for a player id.');
    return;
  }

  sendMessageToServer({
    type: 'play_turn',
    playerId: getPlayerId(),
    handState: handState,
    boardState: boardState,
  });
}

const app = document.getElementById('app')
if (!app) {
  throw new Error('Missing #app');
}
app.style.width = APP_WIDTH;

let board = new Board(GRID, app);

statusBar = document.createElement('div');
statusBar.classList.add('status-bar');
statusMessage = document.createElement('div');
statusMessage.classList.add('status-message');
statusMessage.textContent = 'Connecting to multiplayer server.';
statusStats = document.createElement('div');
statusStats.classList.add('status-stats');
statusBar.append(statusMessage, statusStats);
app.insertBefore(statusBar, board.el);

moveBar = document.createElement('div');
moveBar.classList.add('move-bar');
moveBar.textContent = '';
app.insertBefore(moveBar, board.el.nextSibling);

let bottomBar = document.createElement('div');
bottomBar.classList.add('bottom-bar')
app.appendChild(bottomBar);

let hand = new Hand(bottomBar);

const buttonLabels = ['recall', 'shuffle', 'exchange', 'pass', 'play'];
new Actions(buttonLabels.length, 'full', bottomBar, buttonLabels);

shuffleButton = document.getElementById('shuffle-button') as HTMLButtonElement | null;
if (shuffleButton) {
  shuffleButton.addEventListener('click', () => {
    board.recallHand(hand);
    hand.shuffleHand();
  });
}

recallButton = document.getElementById('recall-button') as HTMLButtonElement | null;
if (recallButton) {
  recallButton.addEventListener('click', () => {
    board.recallHand(hand);
  })
}

playButton = document.getElementById('play-button') as HTMLButtonElement | null;
if (playButton) {
  playButton.addEventListener('click', () => {
    const boardState = board.getBoardState();
    const handState = hand.getHandState();
    sendTurnToServer(handState, boardState);
  })
}

passButton = document.getElementById('pass-button') as HTMLButtonElement | null;
if (passButton) {
  passButton.addEventListener('click', () => {
    if (!hasPlayerId()) {
      setStatus('Waiting for a player id.');
      return;
    }
    sendMessageToServer({ type: 'pass_turn', playerId: getPlayerId() });
  });
}

exchangeButton = document.getElementById('exchange-button') as HTMLButtonElement | null;
if (exchangeButton) {
  exchangeButton.addEventListener('click', () => {
    if (!hasPlayerId()) {
      setStatus('Waiting for a player id.');
      return;
    }
    const tileIds = selectedHandTileIds();
    if (tileIds.length === 0) {
      setStatus('Select rack tiles to exchange.', 'error');
      return;
    }
    sendMessageToServer({
      type: 'exchange_tiles',
      playerId: getPlayerId(),
      tileIds,
    });
  });
}

//
// make background tiles
//

for (let row = 0; row < board.grid.rows; row++) {
  for (let col = 0; col < board.grid.cols; col++) {
    const bgTile = new Tile(col, row, board, true);
    if (col === Math.floor(board.grid.cols / 2) && row === Math.floor(board.grid.rows / 2)) {
      bgTile.el.classList.add('center-tile');
    }
    board.el.appendChild(bgTile.el);
  }
}

for (let col = 0; col < hand.grid.cols; col++) {
  const bgTile = new Tile(col, 0, hand, true);
  hand.el.appendChild(bgTile.el);
}

updateActionButtons();

function syncGameState(state: GameState): void {
  latestGameState = state;
  selectedExchangeIds = new Set();
  const player = currentPlayer(state);
  const isMyTurn = Boolean(player && state.currentPlayerId === player.id);

  board.clearTiles();
  for (const tileState of state.board.tiles) {
    const tile = createTile(tileState, board, true);
    if (!tile) continue;
    tile.disableDrag?.();
    board.addTile(tile);
  }

  hand.clearTiles();
  if (player) {
    for (const tileState of player.rack.tiles) {
      const tile = createTile(tileState, hand, false);
      if (!tile) continue;
      if (isMyTurn) {
        tile.dragAbortCallback = makeDraggable(tile, hand, board);
        attachRackSelection(tile);
      } else {
        tile.disableDrag?.();
      }
      hand.addTile(tile);
    }
  }

  updateStatusFromState(state, player);
  updateActionButtons();
}

function createTile(tileState: TileState, tileHolder: Hand | Board, played: boolean): Tile | null {
  if (!tileState.letter) return null;
  return new Tile(tileState.col, tileState.row, tileHolder, false, {
    id: tileState.id,
    letter: tileState.letter,
    played,
  });
}

function currentPlayer(state: GameState): PlayerPublicState | null {
  if (!hasPlayerId()) return null;
  const playerId = getPlayerId();
  return state.players.find((player) => player.id === playerId) ?? null;
}

function updateStatusFromState(state: GameState, player: PlayerPublicState | null): void {
  const isMyTurn = state.currentPlayerId === player?.id;
  const currentTurn = isMyTurn ? 'your turn' : shortId(state.currentPlayerId);
  const playerCount = state.players.length === 1 ? '1 player' : `${state.players.length} players`;
  const dictionary = dictionaryLabel(state);
  renderStats([
    ['Players', playerCount],
    ['Turn', currentTurn],
    ['Score', String(state.teamScore)],
    ['Bag', String(state.remainingTiles)],
    ['Words', dictionary],
  ]);
  setStatus(isMyTurn ? 'Your turn.' : `Waiting on ${currentTurn}.`);

  if (state.lastMove) {
    moveBar.textContent = `${shortId(state.lastMove.playerId)}: ${state.lastMove.message}`;
  } else {
    moveBar.textContent = `First word must cross ${state.rules.centerCol},${state.rules.centerRow}.`;
  }
  flashElement(moveBar, 'move-bar--pulse');
}

function updateActionButtons(): void {
  const player = latestGameState ? currentPlayer(latestGameState) : null;
  const isMyTurn = Boolean(player && latestGameState?.currentPlayerId === player.id);
  const baseDisabled = waitingForServer || !isMyTurn || !socketIsOpen();

  for (const button of [playButton, passButton, shuffleButton, recallButton]) {
    if (button) button.disabled = baseDisabled;
  }

  if (exchangeButton) {
    const selectedCount = selectedHandTileIds().length;
    exchangeButton.textContent = selectedCount > 0 ? `exchange ${selectedCount}` : 'exchange';
    exchangeButton.disabled = baseDisabled || selectedCount === 0;
  }
}

function attachRackSelection(tile: Tile): void {
  tile.el.addEventListener('click', (event) => {
    if (tile.tileHolder !== hand || !latestGameState) return;
    const player = currentPlayer(latestGameState);
    if (latestGameState.currentPlayerId !== player?.id) return;

    if (selectedExchangeIds.has(tile.id)) {
      selectedExchangeIds.delete(tile.id);
      tile.el.classList.remove('selected-tile');
    } else {
      selectedExchangeIds.add(tile.id);
      tile.el.classList.add('selected-tile');
    }
    updateActionButtons();
    event.stopPropagation();
  });
}

function selectedHandTileIds(): string[] {
  const handTileIds = new Set(hand.tiles.map((tile) => tile.id));
  return [...selectedExchangeIds].filter((tileId) => handTileIds.has(tileId));
}

function renderStats(entries: [string, string][]): void {
  const chips = entries.map(([label, value]) => {
    const chip = document.createElement('div');
    chip.classList.add('status-chip');
    const labelEl = document.createElement('span');
    labelEl.classList.add('status-chip__label');
    labelEl.textContent = label;
    const valueEl = document.createElement('strong');
    valueEl.textContent = value;
    chip.append(labelEl, valueEl);
    return chip;
  });
  statusStats.replaceChildren(...chips);
}

function dictionaryLabel(state: GameState): string {
  if (state.rules.dictionary === 'permissive') return 'permissive';
  if (state.rules.dictionary === 'system') return `${state.rules.dictionaryWordCount.toLocaleString()} system`;
  if (state.rules.dictionary === 'inline') return `${state.rules.dictionaryWordCount.toLocaleString()} inline`;
  return `${state.rules.dictionaryWordCount.toLocaleString()} file`;
}

function setStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
  if (statusMessage) {
    statusMessage.textContent = message;
  }
  if (statusBar) {
    statusBar.classList.toggle('status-bar--error', tone === 'error');
    if (tone === 'error') {
      flashElement(statusBar, 'status-bar--shake');
    }
  }
}

function flashElement(element: HTMLElement, className: string): void {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function shortId(playerId: string | null | undefined): string {
  if (!playerId) return 'none';
  return playerId.slice(0, 6);
}

function connectSocket(): void {
  socket = new WebSocket(webSocketUrl());

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    console.log('Connected to server');
    setStatus('Connected. Waiting for room state.');
    updateActionButtons();
  });

  socket.addEventListener('close', () => {
    waitingForServer = false;
    setStatus('Disconnected. Reconnecting.');
    updateActionButtons();
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    waitingForServer = false;
    setStatus('Connection error. Reconnecting.', 'error');
    updateActionButtons();
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(event.data) as ServerMessage;
    } catch {
      setStatus('Received an unreadable server message.', 'error');
      return;
    }
    console.log(msg);

    switch (msg.type) {
      case 'player_id':
        console.log(`Assigned player id: ${msg.playerId}`)
        setPlayerId(msg.playerId);
        break;
      case 'game_state':
        waitingForServer = false;
        syncGameState(msg.state);
        break;
      case 'turn_rejected':
        waitingForServer = false;
        setStatus(msg.reason, 'error');
        updateActionButtons();
        break;
      case 'board_is_valid':
        break;
      case 'room_created':
        setStatus(`Created room ${msg.roomId}.`);
        break;
      case 'error':
        waitingForServer = false;
        setStatus(msg.msg, 'error');
        updateActionButtons();
        break;
    }
  });
}

function scheduleReconnect(): void {
  reconnectAttempts += 1;
  const delay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** (reconnectAttempts - 1));
  window.setTimeout(() => {
    if (!socketIsOpen()) {
      connectSocket();
    }
  }, delay);
}

function socketIsOpen(): boolean {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function webSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_ADJACENCY_WS_URL as string | undefined;
  if (configuredUrl) return configuredUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isViteDevServer = ['5173', '4173'].includes(window.location.port);
  if (isViteDevServer) {
    return `${protocol}//${window.location.hostname}:8080/ws`;
  }
  return `${protocol}//${window.location.host}/ws`;
}
