import { GRID, APP_WIDTH, TILE_SIZE } from './constants.ts'
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts'
import type {
  GameState,
  MovePreviewState,
  PlayerPublicState,
  TileState,
  TurnHistoryEntryState,
  WordBuildKind,
} from '../shared/states.ts'
import { Actions } from './actions.ts'
import { Board } from './board.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'
import { Hand } from './hand.ts'
import { premiumSquareAt, premiumSquareLabel } from '../shared/boardBonuses.ts'
import { readSessionCookie, writeSessionCookie } from './sessionCookie.ts'
import { Tile } from './tile.ts'
import { makeDraggable } from './draggable.ts'
import { clearPlayerId, setPlayerId, getPlayerId, hasPlayerId } from './clientState.ts'

const reconnectBaseDelayMs = 400;
const reconnectMaxDelayMs = 8000;
const APP_SHELL_WIDTH = `${parseInt(APP_WIDTH, 10) + 304}px`;
const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PREVIEW_DEBOUNCE_MS = 120;
const DEFAULT_ROOM_ID = 'main';

let socket: WebSocket;
let reconnectAttempts = 0;
let latestGameState: GameState | null = null;
let waitingForServer = false;
let statusScoreCard: HTMLDivElement;
let statusScoreValue: HTMLDivElement;
let statusScoreMeta: HTMLDivElement;
let statusScoreDelta: HTMLDivElement;
let roomInput: HTMLInputElement;
let roomCurrentValue: HTMLSpanElement;
let roomPlayers: HTMLDivElement;
let historySummary: HTMLSpanElement;
let historyList: HTMLDivElement;
let previewLayer: HTMLDivElement;
let playButton: HTMLButtonElement | null = null;
let passButton: HTMLButtonElement | null = null;
let exchangeButton: HTMLButtonElement | null = null;
let shuffleButton: HTMLButtonElement | null = null;
let recallButton: HTMLButtonElement | null = null;
let resetButton: HTMLButtonElement | null = null;
let selectedExchangeIds = new Set<string>();
let confirmModal: HTMLDivElement;
let confirmTitle: HTMLHeadingElement;
let confirmBody: HTMLParagraphElement;
let confirmConfirmButton: HTMLButtonElement;
let confirmCancelButton: HTMLButtonElement;
let pendingConfirmAction: (() => void) | null = null;
let previewTimerId: number | null = null;
let latestPreviewRequestId = 0;
let scoreAnimationFrameId: number | null = null;
let scoreFeedbackTimerId: number | null = null;

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

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('Missing #app');
}
const app = appRoot as HTMLDivElement;
app.style.width = `min(calc(100vw - 28px), ${APP_SHELL_WIDTH})`;
const initialSession = readSessionCookie();
const initialRoomId = initialSession.roomId ?? DEFAULT_ROOM_ID;

const headerContainer = document.querySelector('.container') as HTMLDivElement | null;
if (headerContainer) {
  headerContainer.style.width = `min(calc(100vw - 28px), ${APP_SHELL_WIDTH})`;
}
const header = document.querySelector('.header') as HTMLDivElement | null;

const roomBar = document.createElement('div');
roomBar.classList.add('room-bar');
const roomMeta = document.createElement('div');
roomMeta.classList.add('room-bar__meta');
const roomLabel = document.createElement('span');
roomLabel.classList.add('room-bar__label');
roomLabel.textContent = 'Room';
roomCurrentValue = document.createElement('span');
roomCurrentValue.classList.add('room-bar__current');
roomCurrentValue.textContent = initialRoomId;
roomPlayers = document.createElement('div');
roomPlayers.classList.add('room-bar__players');
roomMeta.append(roomLabel, roomCurrentValue, roomPlayers);
const roomControls = document.createElement('div');
roomControls.classList.add('room-bar__controls');
roomInput = document.createElement('input');
roomInput.classList.add('room-input');
roomInput.type = 'text';
roomInput.maxLength = 64;
roomInput.autocomplete = 'off';
roomInput.spellcheck = false;
roomInput.placeholder = 'room name';
roomInput.value = initialRoomId;
const roomJoinButton = document.createElement('button');
roomJoinButton.classList.add('room-button');
roomJoinButton.type = 'button';
roomJoinButton.textContent = 'Join';
const roomNewButton = document.createElement('button');
roomNewButton.classList.add('room-button', 'room-button--secondary');
roomNewButton.type = 'button';
roomNewButton.textContent = 'New room';
resetButton = document.createElement('button');
resetButton.classList.add('room-button', 'room-button--reset', 'header-reset-button');
resetButton.id = 'reset-button';
resetButton.type = 'button';
resetButton.textContent = 'Reset';
roomControls.append(roomInput, roomJoinButton, roomNewButton);
roomBar.append(roomMeta, roomControls);
app.appendChild(roomBar);

if (header) {
  const headerActions = document.createElement('div');
  headerActions.classList.add('header-actions');
  headerActions.appendChild(resetButton);
  header.appendChild(headerActions);
}

statusScoreCard = document.createElement('div');
statusScoreCard.classList.add('status-score');
const statusScoreLabel = document.createElement('div');
statusScoreLabel.classList.add('status-score__label');
statusScoreLabel.textContent = 'Team score';
statusScoreValue = document.createElement('div');
statusScoreValue.classList.add('status-score__value');
statusScoreValue.textContent = '0';
statusScoreMeta = document.createElement('div');
statusScoreMeta.classList.add('status-score__meta');
statusScoreMeta.textContent = '0 tiles left in bag';
statusScoreDelta = document.createElement('div');
statusScoreDelta.classList.add('status-score__delta');
statusScoreDelta.setAttribute('aria-hidden', 'true');
statusScoreCard.append(statusScoreLabel, statusScoreValue, statusScoreMeta, statusScoreDelta);

const mainLayout = document.createElement('div');
mainLayout.classList.add('main-layout');
app.appendChild(mainLayout);

const boardArea = document.createElement('div');
boardArea.classList.add('board-area');
mainLayout.appendChild(boardArea);

const sideColumn = document.createElement('aside');
sideColumn.classList.add('side-column');
sideColumn.append(statusScoreCard);
mainLayout.appendChild(sideColumn);

const boardScroller = document.createElement('div');
boardScroller.classList.add('board-scroller');
boardArea.appendChild(boardScroller);

const boardColumn = document.createElement('div');
boardColumn.classList.add('board-column');
boardColumn.style.width = APP_WIDTH;
boardScroller.appendChild(boardColumn);

const historyPanel = document.createElement('aside');
historyPanel.classList.add('history-panel');
const historyHeader = document.createElement('div');
historyHeader.classList.add('history-panel__header');
const historyTitle = document.createElement('h2');
historyTitle.textContent = 'Turn history';
historySummary = document.createElement('span');
historySummary.classList.add('history-panel__count');
historySummary.textContent = 'No turns yet';
historyHeader.append(historyTitle, historySummary);
historyList = document.createElement('div');
historyList.classList.add('history-list');
historyPanel.append(historyHeader, historyList);
sideColumn.appendChild(historyPanel);

let board = new Board(GRID, boardColumn);

let bottomBar = document.createElement('div');
bottomBar.classList.add('bottom-bar')
boardArea.appendChild(bottomBar);

let hand = new Hand(bottomBar);

const buttonLabels = ['recall', 'shuffle', 'play', 'exchange', 'pass'];
new Actions(bottomBar, buttonLabels);

function syncHistoryPanelHeight(): void {
  const boardAreaHeight = Math.ceil(boardArea.getBoundingClientRect().height);
  if (boardAreaHeight > 0) {
    sideColumn.style.setProperty('--side-column-max-height', `${boardAreaHeight}px`);
  }
}

if ('ResizeObserver' in window) {
  const historyPanelHeightObserver = new ResizeObserver(() => {
    syncHistoryPanelHeight();
  });
  historyPanelHeightObserver.observe(boardArea);
}

window.addEventListener('resize', syncHistoryPanelHeight);
window.requestAnimationFrame(syncHistoryPanelHeight);

confirmModal = document.createElement('div');
confirmModal.classList.add('modal-backdrop');
confirmModal.hidden = true;
confirmModal.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <h2 id="confirm-title"></h2>
    <p id="confirm-body"></p>
    <div class="modal-actions">
      <button type="button" id="confirm-cancel-button" class="action-button action-button--secondary">cancel</button>
      <button type="button" id="confirm-confirm-button" class="action-button">confirm</button>
    </div>
  </div>
`;
document.body.appendChild(confirmModal);
confirmTitle = document.getElementById('confirm-title') as HTMLHeadingElement;
confirmBody = document.getElementById('confirm-body') as HTMLParagraphElement;
confirmConfirmButton = document.getElementById('confirm-confirm-button') as HTMLButtonElement;
confirmCancelButton = document.getElementById('confirm-cancel-button') as HTMLButtonElement;

shuffleButton = document.getElementById('shuffle-button') as HTMLButtonElement | null;
if (shuffleButton) {
  shuffleButton.addEventListener('click', () => {
    clearMovePreview();
    board.recallHand(hand);
    hand.shuffleHand();
  });
}

recallButton = document.getElementById('recall-button') as HTMLButtonElement | null;
if (recallButton) {
  recallButton.addEventListener('click', () => {
    clearMovePreview();
    board.recallHand(hand);
  })
}

playButton = document.getElementById('play-button') as HTMLButtonElement | null;
if (playButton) {
  playButton.addEventListener('click', () => {
    if (!hasPendingBoardTiles()) {
      setStatus('Play at least one tile before submitting a turn.', 'error');
      return;
    }
    showConfirmationModal({
      title: 'Play turn?',
      body: 'Submit the tiles currently on the board.',
      confirmLabel: 'play',
      confirmTone: 'play',
      onConfirm: submitPlayTurn,
    });
  })
}

passButton = document.getElementById('pass-button') as HTMLButtonElement | null;
if (passButton) {
  passButton.addEventListener('click', () => {
    if (!requirePlayerId()) return;
    showConfirmationModal({
      title: 'Pass turn?',
      body: 'This ends your turn without playing a word.',
      confirmLabel: 'pass',
      confirmTone: 'pass',
      onConfirm: () => {
        const playerId = requirePlayerId();
        if (!playerId) return;
        sendMessageToServer({ type: 'pass_turn', playerId });
      },
    });
  });
}

exchangeButton = document.getElementById('exchange-button') as HTMLButtonElement | null;
if (exchangeButton) {
  exchangeButton.addEventListener('click', () => {
    if (!requirePlayerId()) return;
    const tileIds = selectedHandTileIds();
    if (tileIds.length === 0) {
      setStatus('Select rack tiles to exchange.', 'error');
      return;
    }
    showConfirmationModal({
      title: 'Exchange tiles?',
      body: `Exchange ${tileIds.length} selected tile${tileIds.length === 1 ? '' : 's'} for new ones from the bag.`,
      confirmLabel: 'exchange',
      confirmTone: 'exchange',
      onConfirm: () => {
        const playerId = requirePlayerId();
        if (!playerId) return;
        sendMessageToServer({
          type: 'exchange_tiles',
          playerId,
          tileIds,
        });
      },
    });
  });
}

resetButton = document.getElementById('reset-button') as HTMLButtonElement | null;
if (resetButton) {
  resetButton.addEventListener('click', () => {
    if (!requirePlayerId()) return;
    showConfirmationModal({
      title: 'Reset game?',
      body: 'This clears the board, keeps you in the room, and removes the other player until they rejoin.',
      confirmLabel: 'reset',
      confirmTone: 'reset',
      onConfirm: () => {
        const playerId = requirePlayerId();
        if (!playerId) return;
        sendMessageToServer({ type: 'reset_game', playerId });
      },
    });
  });
}

confirmCancelButton.addEventListener('click', hideConfirmModal);
confirmConfirmButton.addEventListener('click', () => {
  const action = pendingConfirmAction;
  hideConfirmModal();
  action?.();
});

roomJoinButton.addEventListener('click', () => {
  requestRoomJoin(roomInput.value);
});

roomNewButton.addEventListener('click', () => {
  const nextRoomId = generateRoomId();
  roomInput.value = nextRoomId;
  requestRoomJoin(nextRoomId);
});

roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    requestRoomJoin(roomInput.value);
  }
});

confirmModal.addEventListener('click', (event) => {
  if (event.target === confirmModal) {
    hideConfirmModal();
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !confirmModal.hidden) {
    hideConfirmModal();
  }
});

//
// make background tiles
//

for (let row = 0; row < board.grid.rows; row++) {
  for (let col = 0; col < board.grid.cols; col++) {
    const bgTile = new Tile(col, row, board, true);
    const premiumSquare = premiumSquareAt(col, row);
    if (premiumSquare !== 'normal') {
      bgTile.el.classList.add('premium-square', `premium-square--${premiumSquare}`);
      bgTile.el.setAttribute(
        'data-premium-label',
        col === Math.floor(board.grid.cols / 2) && row === Math.floor(board.grid.rows / 2)
          ? '★'
          : premiumSquareLabel(premiumSquare),
      );
    }
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

previewLayer = document.createElement('div');
previewLayer.classList.add('preview-layer');
board.el.appendChild(previewLayer);

updateActionButtons();
renderTurnHistory([]);
renderRoomPlayers(null, null);

function syncGameState(state: GameState): void {
  clearMovePreview();
  const previousState = latestGameState;
  latestGameState = state;
  writeSessionCookie({ roomId: state.roomId });
  syncRoomUi(state.roomId);
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
        tile.dragAbortCallback = makeDraggable(tile, hand, board, scheduleMovePreview);
        attachRackSelection(tile);
      } else {
        tile.disableDrag?.();
      }
      hand.addTile(tile);
    }
  }

  updateStatusFromState(state, player, previousState);
  renderRoomPlayers(state, player);
  updateActionButtons();
}

function clearJoinedRoomState(roomId: string, message: string): void {
  hideConfirmModal();
  clearMovePreview();
  stopScoreAnimation();
  hideScoreGain();
  latestGameState = null;
  selectedExchangeIds = new Set();
  clearPlayerId();
  app.classList.remove('app--waiting-turn');
  writeSessionCookie({
    roomId,
    playerId: undefined,
    sessionId: undefined,
  });
  syncRoomUi(roomId);
  board.clearTiles();
  hand.clearTiles();
  renderRoomPlayers(null, null);
  renderTurnHistory([]);
  statusScoreValue.textContent = '0';
  statusScoreMeta.textContent = 'Rejoin to keep playing';
  setStatus(message);
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

function updateStatusFromState(
  state: GameState,
  player: PlayerPublicState | null,
  previousState: GameState | null,
): void {
  const isMyTurn = state.currentPlayerId === player?.id;
  syncScoreFeedback(previousState, state);
  const bagLabel = `${state.remainingTiles} tile${state.remainingTiles === 1 ? '' : 's'} left in bag`;
  statusScoreMeta.textContent = state.lastMove?.score
    ? `+${state.lastMove.score} last turn / ${bagLabel}`
    : bagLabel;
  app.classList.toggle('app--waiting-turn', !isMyTurn);
  renderTurnHistory(state.turnHistory);
}

function syncScoreFeedback(previousState: GameState | null, state: GameState): void {
  const sameRoom = previousState?.roomId === state.roomId;
  const previousScore = sameRoom ? previousState.teamScore : null;
  const scoreGain = previousScore === null ? 0 : state.teamScore - previousScore;

  if (scoreGain > 0) {
    animateScoreValue(previousScore ?? state.teamScore, state.teamScore);
    showScoreGain(scoreGain);
    return;
  }

  stopScoreAnimation();
  hideScoreGain();
  statusScoreValue.textContent = state.teamScore.toString();
}

function animateScoreValue(fromScore: number, toScore: number): void {
  stopScoreAnimation();

  const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (prefersReducedMotion || fromScore >= toScore) {
    statusScoreValue.textContent = toScore.toString();
    return;
  }

  const startTime = performance.now();
  const durationMs = Math.min(720, Math.max(320, (toScore - fromScore) * 45));

  const tick = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = 1 - (1 - progress) ** 3;
    const currentScore = Math.round(fromScore + (toScore - fromScore) * eased);
    statusScoreValue.textContent = currentScore.toString();
    if (progress < 1) {
      scoreAnimationFrameId = window.requestAnimationFrame(tick);
      return;
    }

    scoreAnimationFrameId = null;
    statusScoreValue.textContent = toScore.toString();
  };

  scoreAnimationFrameId = window.requestAnimationFrame(tick);
}

function stopScoreAnimation(): void {
  if (scoreAnimationFrameId !== null) {
    window.cancelAnimationFrame(scoreAnimationFrameId);
    scoreAnimationFrameId = null;
  }
}

function showScoreGain(scoreGain: number): void {
  if (scoreFeedbackTimerId !== null) {
    window.clearTimeout(scoreFeedbackTimerId);
    scoreFeedbackTimerId = null;
  }

  statusScoreDelta.textContent = `+${scoreGain}`;
  statusScoreCard.classList.remove('status-score--pulse');
  statusScoreDelta.classList.remove('status-score__delta--visible');
  void statusScoreCard.offsetWidth;
  statusScoreCard.classList.add('status-score--pulse');
  statusScoreDelta.classList.add('status-score__delta--visible');

  scoreFeedbackTimerId = window.setTimeout(() => {
    statusScoreCard.classList.remove('status-score--pulse');
    statusScoreDelta.classList.remove('status-score__delta--visible');
    scoreFeedbackTimerId = null;
  }, 1100);
}

function hideScoreGain(): void {
  if (scoreFeedbackTimerId !== null) {
    window.clearTimeout(scoreFeedbackTimerId);
    scoreFeedbackTimerId = null;
  }
  statusScoreCard.classList.remove('status-score--pulse');
  statusScoreDelta.classList.remove('status-score__delta--visible');
  statusScoreDelta.textContent = '';
}

function updateActionButtons(): void {
  const player = latestGameState ? currentPlayer(latestGameState) : null;
  const isMyTurn = Boolean(player && latestGameState?.currentPlayerId === player.id);
  const baseDisabled = waitingForServer || !isMyTurn || !socketIsOpen();
  const resetDisabled = waitingForServer || !player || !socketIsOpen();

  for (const button of [playButton, passButton, shuffleButton, recallButton]) {
    if (button) button.disabled = baseDisabled;
  }

  if (resetButton) {
    resetButton.disabled = resetDisabled;
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

function scheduleMovePreview(): void {
  latestPreviewRequestId += 1;
  const requestId = latestPreviewRequestId;
  clearMovePreviewMarks();

  if (previewTimerId !== null) {
    window.clearTimeout(previewTimerId);
  }

  previewTimerId = window.setTimeout(() => {
    previewTimerId = null;
    requestMovePreview(requestId);
  }, PREVIEW_DEBOUNCE_MS);
}

function requestMovePreview(requestId: number): void {
  if (!latestGameState || !hasPlayerId() || !socketIsOpen()) {
    clearMovePreview();
    return;
  }

  const player = currentPlayer(latestGameState);
  if (!player || latestGameState.currentPlayerId !== player.id) {
    clearMovePreview();
    return;
  }

  if (!hasPendingBoardTiles()) {
    clearMovePreview();
    return;
  }

  socket.send(JSON.stringify({
    type: 'preview_turn',
    playerId: getPlayerId(),
    handState: hand.getHandState(),
    boardState: board.getBoardState(),
    requestId,
  } satisfies ClientMessage));
}

function applyMovePreview(preview: MovePreviewState): void {
  clearMovePreviewMarks();

  if (!preview.valid || preview.words.length === 0) {
    previewLayer.replaceChildren();
    return;
  }

  const highlightedCoords = new Set(
    preview.words.flatMap((word) => word.cells.map((cell) => `${cell.col}:${cell.row}`)),
  );

  for (const tile of board.tiles) {
    if (highlightedCoords.has(`${tile.col}:${tile.row}`)) {
      tile.el.classList.add('preview-valid');
    }
  }

  const badgeSlotCounts = new Map<string, number>();
  const badges = preview.words.map((word) => {
    const badge = document.createElement('div');
    badge.classList.add('preview-score-badge');
    badge.textContent = `${word.score}`;
    const cellCoords = word.cells.map((cell) => gridCoordsToTileHolderCoords(cell.col, cell.row, board));
    const minX = Math.min(...cellCoords.map((coords) => coords.x));
    const maxX = Math.max(...cellCoords.map((coords) => coords.x));
    const maxY = Math.max(...cellCoords.map((coords) => coords.y));
    const centerX = (minX + maxX + TILE_SIZE) / 2;
    const bottomY = maxY + TILE_SIZE;
    const badgeKey = `${Math.round(centerX)}:${Math.round(bottomY)}`;
    const badgeIndex = badgeSlotCounts.get(badgeKey) ?? 0;
    badgeSlotCounts.set(badgeKey, badgeIndex + 1);
    badge.style.left = `${centerX}px`;
    badge.style.top = `${bottomY + 8 + badgeIndex * 22}px`;
    return badge;
  });

  previewLayer.replaceChildren(...badges);
}

function clearMovePreview(): void {
  latestPreviewRequestId += 1;
  if (previewTimerId !== null) {
    window.clearTimeout(previewTimerId);
    previewTimerId = null;
  }
  clearMovePreviewMarks();
}

function clearMovePreviewMarks(): void {
  previewLayer.replaceChildren();
  for (const tile of board.tiles) {
    tile.el.classList.remove('preview-valid');
  }
}

function renderRoomPlayers(state: GameState | null, player: PlayerPublicState | null): void {
  const partner = state ? partnerPlayer(state, player) : null;

  const slots: Array<{ label: string; player: PlayerPublicState | null }> = player
    ? [
      { label: 'You', player },
      { label: 'Partner', player: partner },
    ]
    : [
      { label: 'Seat 1', player: state?.players[0] ?? null },
      { label: 'Seat 2', player: state?.players[1] ?? null },
    ];

  const slotEls = slots.map((slot) => {
    const chip = document.createElement('div');
    chip.classList.add('room-player');

    const label = document.createElement('span');
    label.classList.add('room-player__label');
    label.textContent = slot.label;

    const value = document.createElement('strong');
    value.classList.add('room-player__value');

    const stateText = document.createElement('span');
    stateText.classList.add('room-player__state');

    if (slot.player) {
      chip.classList.toggle('room-player--self', slot.player.id === player?.id);
      value.textContent = shortId(slot.player.id);
      stateText.textContent = slot.player.connected ? 'connected' : 'away';
    } else {
      chip.classList.add('room-player--empty');
      value.textContent = 'open';
      stateText.textContent = 'waiting';
    }

    chip.append(label, value, stateText);
    return chip;
  });

  roomPlayers.replaceChildren(...slotEls);
}

function renderTurnHistory(entries: TurnHistoryEntryState[]): void {
  historySummary.textContent = entries.length === 0
    ? 'No turns yet'
    : `${entries.length} turn${entries.length === 1 ? '' : 's'}`;

  if (entries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.classList.add('history-empty');
    emptyState.textContent = 'Played turns will show up here with per-word scores.';
    historyList.replaceChildren(emptyState);
    return;
  }

  const entryCards = entries.map((entry) => {
    const card = document.createElement('article');
    card.classList.add('history-entry', `history-entry--${entry.kind}`);

    const topRow = document.createElement('div');
    topRow.classList.add('history-entry__top');

    const meta = document.createElement('div');
    meta.classList.add('history-entry__meta');
    meta.textContent = `Turn ${entry.turn} - ${shortId(entry.playerId)}`;

    const total = document.createElement('div');
    total.classList.add('history-entry__total');
    total.textContent = `${entry.totalScore} pt${entry.totalScore === 1 ? '' : 's'}`;

    topRow.append(meta, total);
    card.appendChild(topRow);

    if (entry.words.length > 0) {
      const wordRows = document.createElement('div');
      wordRows.classList.add('history-entry__words');

      for (const wordScore of entry.words) {
        const row = document.createElement('div');
        row.classList.add('history-entry__word');

        const wordMeta = document.createElement('div');
        wordMeta.classList.add('history-entry__word-meta');

        const word = document.createElement('span');
        word.classList.add('history-entry__word-label');
        word.textContent = wordScore.word;

        const kind = document.createElement('span');
        kind.classList.add('history-entry__word-kind', `history-entry__word-kind--${wordScore.kind}`);
        kind.textContent = wordKindLabel(wordScore.kind);

        const score = document.createElement('span');
        score.classList.add('history-entry__word-score');
        score.textContent = `${wordScore.score} pt${wordScore.score === 1 ? '' : 's'}`;

        wordMeta.append(word, kind);
        row.append(wordMeta, score);
        wordRows.appendChild(row);
      }

      card.appendChild(wordRows);
    } else {
      const message = document.createElement('div');
      message.classList.add('history-entry__message');
      message.textContent = entry.message;
      card.appendChild(message);
    }

    return card;
  });

  historyList.replaceChildren(...entryCards);
}

function wordKindLabel(kind: WordBuildKind): string {
  switch (kind) {
    case 'extension':
      return 'extend';
    case 'hook':
      return 'hook';
    case 'fresh':
      return 'fresh';
  }
}

function requestRoomJoin(candidateRoomId: string): void {
  const roomId = candidateRoomId.trim();
  if (!ROOM_ID_PATTERN.test(roomId)) {
    setStatus('Room names can use letters, numbers, underscores, and dashes only.', 'error');
    return;
  }
  if (latestGameState?.roomId === roomId) {
    setStatus(`Already in room ${roomId}.`);
    return;
  }

  clearPlayerId();
  clearMovePreview();
  syncRoomUi(roomId);
  writeSessionCookie({ roomId });
  setStatus(`Joining room ${roomId}.`);
  if (!socketIsOpen()) {
    return;
  }
  sendMessageToServer({ type: 'join_room', roomId });
}

function generateRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function setStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
  void message;
  if (statusScoreCard) {
    statusScoreCard.classList.toggle('status-score--error', tone === 'error');
    if (tone === 'error') {
      flashElement(statusScoreCard, 'status-score--shake');
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

function syncRoomUi(roomId: string): void {
  roomCurrentValue.textContent = roomId;
  if (document.activeElement !== roomInput) {
    roomInput.value = roomId;
  }
}

function requirePlayerId(): string | null {
  if (!hasPlayerId()) {
    setStatus('Waiting for a player id.');
    return null;
  }
  return getPlayerId();
}

function hasPendingBoardTiles(): boolean {
  return board.tiles.some((tile) => !tile.isPlayed);
}

function partnerPlayer(state: GameState, player: PlayerPublicState | null): PlayerPublicState | null {
  if (!player) return null;
  return state.players.find((candidate) => candidate.id !== player.id) ?? null;
}

function submitPlayTurn(): void {
  const playerId = requirePlayerId();
  if (!playerId) return;
  clearMovePreview();
  sendMessageToServer({
    type: 'play_turn',
    playerId,
    handState: hand.getHandState(),
    boardState: board.getBoardState(),
  });
}

function connectSocket(): void {
  socket = new WebSocket(webSocketUrl());

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
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
    switch (msg.type) {
      case 'player_id':
        setPlayerId(msg.playerId);
        syncRoomUi(msg.roomId);
        writeSessionCookie({
          playerId: msg.playerId,
          roomId: msg.roomId,
          sessionId: msg.sessionId,
        });
        break;
      case 'game_state':
        waitingForServer = false;
        syncGameState(msg.state);
        break;
      case 'move_preview':
        if (msg.requestId === latestPreviewRequestId) {
          applyMovePreview(msg.preview);
        }
        break;
      case 'removed_from_room':
        waitingForServer = false;
        clearJoinedRoomState(msg.roomId, msg.msg);
        break;
      case 'turn_rejected':
        waitingForServer = false;
        setStatus(msg.reason, 'error');
        updateActionButtons();
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
  const { roomId, sessionId } = readSessionCookie();
  const query = new URLSearchParams();
  if (roomId) query.set('room', roomId);
  if (sessionId) query.set('session', sessionId);

  if (configuredUrl) {
    const url = new URL(configuredUrl, window.location.href);
    query.forEach((value, key) => url.searchParams.set(key, value));
    return url.toString();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const isViteDevServer = ['5173', '4173'].includes(window.location.port);
  const baseUrl = isViteDevServer
    ? `${protocol}//${window.location.hostname}:8080/ws`
    : `${protocol}//${window.location.host}/ws`;
  const url = new URL(baseUrl);
  query.forEach((value, key) => url.searchParams.set(key, value));
  return url.toString();
}

function showConfirmModal(): void {
  confirmModal.hidden = false;
}

function showConfirmationModal({
  title,
  body,
  confirmLabel,
  confirmTone,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: 'play' | 'pass' | 'exchange' | 'reset';
  onConfirm: () => void;
}): void {
  confirmTitle.textContent = title;
  confirmBody.textContent = body;
  confirmConfirmButton.textContent = confirmLabel;
  confirmConfirmButton.className = 'action-button';
  confirmConfirmButton.classList.add(`action-button--${confirmTone}`);
  pendingConfirmAction = onConfirm;
  showConfirmModal();
  confirmCancelButton.focus();
}

function hideConfirmModal(): void {
  confirmModal.hidden = true;
  pendingConfirmAction = null;
  confirmConfirmButton.className = 'action-button';
}
