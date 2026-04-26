import { GRID, APP_WIDTH, BOARD_HEIGHT_PX, BOARD_WIDTH_PX, TILE_SIZE } from './constants.ts'
import type { ClientMessage } from '../shared/protocol.ts'
import type {
  GameState,
  MovePreviewState,
  PlayerPublicState,
  TileState,
  TurnWordScoreState,
  TurnHistoryEntryState,
  WordBuildKind,
} from '../shared/states.ts'
import { Actions } from './actions.ts'
import { Board } from './board.ts'
import { createBoardZoomController } from './boardZoom.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'
import { Hand } from './hand.ts'
import { premiumSquareAt, premiumSquareLabel, type BoardLayoutType } from '../shared/boardBonuses.ts'
import { clearSessionCookie, readSessionCookie, writeSessionCookie } from './sessionCookie.ts'
import { Tile } from './tile.ts'
import { makeDraggable } from './draggable.ts'
import {
  clearClientState,
  clearPlayerId,
  getClientState,
  getPlayerId,
  hasPlayerId,
  hydrateClientState,
  setPlayerId,
} from './clientState.ts'
import { createGame, fetchAccountOverview, loginAccount } from './accountApi.ts'
import {
  describeGameSummary,
  gameIdFromState,
  gameSummaryFromState,
  playerAccountName,
  playerSeat,
  shortGameId,
  type GameSummary,
} from './accountModels.ts'
import { resolveWebSocketUrl } from './network.ts'

const reconnectBaseDelayMs = 400;
const reconnectMaxDelayMs = 8000;
const APP_SHELL_WIDTH = `${parseInt(APP_WIDTH, 10) + 304}px`;
const ACCOUNT_NAME_MAX_LENGTH = 64;
const PREVIEW_DEBOUNCE_MS = 120;

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimerId: number | null = null;
let socketGeneration = 0;
let latestGameState: GameState | null = null;
let waitingForServer = false;
let accountRequestInFlight = false;
let statusScoreCard: HTMLDivElement;
let statusScoreValue: HTMLDivElement;
let statusScoreMeta: HTMLDivElement;
let statusScoreDelta: HTMLDivElement;
let accountInput: HTMLInputElement;
let accountCurrentValue: HTMLSpanElement;
let accountGames: HTMLDivElement;
let accountPrimaryButton: HTMLButtonElement;
let accountSecondaryButton: HTMLButtonElement;
let statusNoticeValue: HTMLElement;
let historySummary: HTMLSpanElement;
let historyList: HTMLDivElement;
let previewLayer: HTMLDivElement;
let optionsButton: HTMLButtonElement | null = null;
let optionsMenu!: HTMLDivElement;
let gameOverPrompt: HTMLDivElement | null = null;
let playButton: HTMLButtonElement | null = null;
let passButton: HTMLButtonElement | null = null;
let exchangeButton: HTMLButtonElement | null = null;
let shuffleButton: HTMLButtonElement | null = null;
let recallButton: HTMLButtonElement | null = null;
let resetButton: HTMLButtonElement | null = null;
let scrabbleLayoutButton!: HTMLButtonElement;
let wordsWithFriendsLayoutButton!: HTMLButtonElement;
let nytCrossplayLayoutButton!: HTMLButtonElement;
let selectedExchangeIds = new Set<string>();
let currentBoardLayout: BoardLayoutType = 'scrabble';
const boardBackgroundTiles: Tile[] = [];
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

function sendMessageToServer(message: ClientMessage): void {
  if (!socket || !socketIsOpen()) {
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
hydrateClientState({
  account: initialSession.accountId && initialSession.accountName
    ? { id: initialSession.accountId, name: initialSession.accountName }
    : null,
  currentGameId: initialSession.currentGameId ?? null,
  playerId: initialSession.playerId ?? null,
  sessionToken: initialSession.sessionToken ?? null,
});

const headerContainer = document.querySelector('.container') as HTMLDivElement | null;
if (headerContainer) {
  headerContainer.style.width = `min(calc(100vw - 28px), ${APP_SHELL_WIDTH})`;
}
const header = document.querySelector('.header') as HTMLDivElement | null;

const accountBar = document.createElement('div');
accountBar.classList.add('room-bar');
const accountMeta = document.createElement('div');
accountMeta.classList.add('room-bar__meta');
const accountIdentity = document.createElement('div');
accountIdentity.classList.add('room-bar__room');
const accountLabel = document.createElement('span');
accountLabel.classList.add('room-bar__label');
accountLabel.textContent = 'Account';
accountCurrentValue = document.createElement('span');
accountCurrentValue.classList.add('room-bar__current');
accountGames = document.createElement('div');
accountGames.classList.add('room-bar__players');
const statusNotice = document.createElement('div');
statusNotice.classList.add('room-player', 'room-player--empty');
const statusNoticeLabel = document.createElement('span');
statusNoticeLabel.classList.add('room-player__label');
statusNoticeLabel.textContent = 'Status';
statusNoticeValue = document.createElement('strong');
statusNoticeValue.classList.add('room-player__value');
accountIdentity.append(accountLabel, accountCurrentValue);
statusNotice.append(statusNoticeLabel, statusNoticeValue);
accountMeta.append(accountIdentity, statusNotice, accountGames);
const accountControls = document.createElement('div');
accountControls.classList.add('room-bar__controls');
accountInput = document.createElement('input');
accountInput.classList.add('room-input');
accountInput.type = 'text';
accountInput.maxLength = ACCOUNT_NAME_MAX_LENGTH;
accountInput.autocomplete = 'off';
accountInput.spellcheck = false;
accountPrimaryButton = document.createElement('button');
accountPrimaryButton.classList.add('room-button');
accountPrimaryButton.type = 'button';
accountSecondaryButton = document.createElement('button');
accountSecondaryButton.classList.add('room-button', 'room-button--secondary');
accountSecondaryButton.type = 'button';
resetButton = document.createElement('button');
resetButton.classList.add('room-button', 'room-button--reset');
resetButton.id = 'reset-button';
resetButton.type = 'button';
resetButton.textContent = 'Reset';
accountControls.append(accountInput, accountPrimaryButton, accountSecondaryButton);
accountBar.append(accountMeta, accountControls);
app.appendChild(accountBar);

if (header) {
  const headerActions = document.createElement('div');
  headerActions.classList.add('header-actions');
  optionsButton = document.createElement('button');
  optionsButton.classList.add('room-button', 'header-options-button');
  optionsButton.type = 'button';
  optionsButton.textContent = 'Options';

  optionsMenu = document.createElement('div');
  optionsMenu.classList.add('options-menu');
  optionsMenu.hidden = true;

  const layoutSection = document.createElement('div');
  layoutSection.classList.add('options-menu__section');

  const layoutLabel = document.createElement('div');
  layoutLabel.classList.add('options-menu__label');
  layoutLabel.textContent = 'Board';

  const layoutButtons = document.createElement('div');
  layoutButtons.classList.add('options-menu__layout-buttons');

  scrabbleLayoutButton = document.createElement('button');
  scrabbleLayoutButton.classList.add('options-layout-button');
  scrabbleLayoutButton.type = 'button';
  scrabbleLayoutButton.textContent = 'Scrabble-like';

  wordsWithFriendsLayoutButton = document.createElement('button');
  wordsWithFriendsLayoutButton.classList.add('options-layout-button');
  wordsWithFriendsLayoutButton.type = 'button';
  wordsWithFriendsLayoutButton.textContent = 'WWF-like';

  nytCrossplayLayoutButton = document.createElement('button');
  nytCrossplayLayoutButton.classList.add('options-layout-button');
  nytCrossplayLayoutButton.type = 'button';
  nytCrossplayLayoutButton.textContent = 'NYT crossplay-like';

  layoutButtons.append(scrabbleLayoutButton, wordsWithFriendsLayoutButton, nytCrossplayLayoutButton);
  layoutSection.append(layoutLabel, layoutButtons);

  const actionsSection = document.createElement('div');
  actionsSection.classList.add('options-menu__section', 'options-menu__section--actions');
  actionsSection.appendChild(resetButton);

  optionsMenu.append(layoutSection, actionsSection);
  gameOverPrompt = document.createElement('div');
  gameOverPrompt.classList.add('game-over-prompt');
  gameOverPrompt.hidden = true;
  gameOverPrompt.setAttribute('aria-hidden', 'true');
  gameOverPrompt.innerHTML = `
    <span class="game-over-prompt__arrow">↑</span>
    <span class="game-over-prompt__text">Reset to play again</span>
  `;

  headerActions.append(optionsButton, optionsMenu, gameOverPrompt);
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
statusScoreMeta.textContent = 'Choose a game to start';
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

const boardZoomSurface = document.createElement('div');
boardZoomSurface.classList.add('board-zoom-surface');
boardScroller.appendChild(boardZoomSurface);

const boardColumn = document.createElement('div');
boardColumn.classList.add('board-column');
boardColumn.style.width = APP_WIDTH;
boardColumn.style.height = `${BOARD_HEIGHT_PX}px`;
boardZoomSurface.appendChild(boardColumn);

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
createBoardZoomController({
  board,
  scroller: boardScroller,
  surface: boardZoomSurface,
  zoomTarget: boardColumn,
  baseWidth: BOARD_WIDTH_PX,
  baseHeight: BOARD_HEIGHT_PX,
});

let bottomBar = document.createElement('div');
bottomBar.classList.add('bottom-bar')
boardArea.appendChild(bottomBar);

let hand = new Hand(bottomBar);

const buttonLabels = ['recall', 'shuffle', 'play', 'exchange', 'pass'];
new Actions(bottomBar, buttonLabels);

function syncHistoryPanelHeight(): void {
  const boardAreaHeight = Math.ceil(boardArea.getBoundingClientRect().height);
  if (boardAreaHeight > 0) {
    sideColumn.style.setProperty('--side-column-height', `${boardAreaHeight}px`);
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
    submitPlayTurn();
  })
}

passButton = document.getElementById('pass-button') as HTMLButtonElement | null;
if (passButton) {
  passButton.addEventListener('click', () => {
    if (!latestGameState || !currentPlayer(latestGameState)) return;
    sendMessageToServer({ type: 'pass_turn' });
  });
}

exchangeButton = document.getElementById('exchange-button') as HTMLButtonElement | null;
if (exchangeButton) {
  exchangeButton.addEventListener('click', () => {
    if (!latestGameState || !currentPlayer(latestGameState)) return;
    const tileIds = selectedHandTileIds();
    if (tileIds.length === 0) {
      setStatus('Select rack tiles to exchange.', 'error');
      return;
    }
    sendMessageToServer({
      type: 'exchange_tiles',
      tileIds,
    });
  });
}

resetButton = document.getElementById('reset-button') as HTMLButtonElement | null;
if (resetButton) {
  resetButton.addEventListener('click', () => {
    hideOptionsMenu();
    if (!latestGameState || !currentPlayer(latestGameState)) return;
    showConfirmationModal({
      title: 'Reset game?',
      body: 'This clears the board, keeps you in the game, and removes the other player until they rejoin.',
      confirmLabel: 'reset',
      confirmTone: 'reset',
      onConfirm: () => {
        if (!latestGameState || !currentPlayer(latestGameState)) return;
        sendMessageToServer({ type: 'reset_game' });
      },
    });
  });
}

scrabbleLayoutButton.addEventListener('click', () => {
  requestBoardLayout('scrabble');
});

wordsWithFriendsLayoutButton.addEventListener('click', () => {
  requestBoardLayout('words-with-friends');
});

nytCrossplayLayoutButton.addEventListener('click', () => {
  requestBoardLayout('nyt-crossplay');
});

if (optionsButton) {
  optionsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    optionsMenu.hidden = !optionsMenu.hidden;
  });
}

confirmCancelButton.addEventListener('click', hideConfirmModal);
confirmConfirmButton.addEventListener('click', () => {
  const action = pendingConfirmAction;
  hideConfirmModal();
  action?.();
});

accountPrimaryButton.addEventListener('click', () => {
  void handleAccountPrimaryAction();
});

accountSecondaryButton.addEventListener('click', () => {
  void handleAccountSecondaryAction();
});

accountInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void handleAccountPrimaryAction();
  }
});

confirmModal.addEventListener('click', (event) => {
  if (event.target === confirmModal) {
    hideConfirmModal();
  }
});

document.addEventListener('click', (event) => {
  if (!optionsButton || optionsMenu.hidden) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (optionsMenu.contains(target) || optionsButton.contains(target)) return;
  hideOptionsMenu();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !confirmModal.hidden) {
    hideConfirmModal();
    return;
  }
  if (event.key === 'Escape' && !optionsMenu.hidden) {
    hideOptionsMenu();
  }
});

//
// make background tiles
//

for (let row = 0; row < board.grid.rows; row++) {
  for (let col = 0; col < board.grid.cols; col++) {
    const bgTile = new Tile(col, row, board, true);
    boardBackgroundTiles.push(bgTile);
    board.el.appendChild(bgTile.el);
  }
}
renderBoardBackground(currentBoardLayout);

for (let col = 0; col < hand.grid.cols; col++) {
  const bgTile = new Tile(col, 0, hand, true);
  hand.el.appendChild(bgTile.el);
}

previewLayer = document.createElement('div');
previewLayer.classList.add('preview-layer');
board.el.appendChild(previewLayer);

updateActionButtons();
renderTurnHistory([]);
syncAccountUi();
void restoreAccountSession();

function syncGameState(state: GameState): void {
  clearMovePreview();
  const previousState = latestGameState;
  latestGameState = state;
  currentBoardLayout = state.boardLayout;
  const liveSummary = gameSummaryFromState(state);
  if (liveSummary) {
    updateStoredGameSummary(liveSummary);
    if (getClientState().currentGameId !== liveSummary.gameId) {
      hydrateClientState({ currentGameId: liveSummary.gameId });
    }
  }
  renderBoardBackground(state.boardLayout);
  selectedExchangeIds = new Set();
  const player = currentPlayer(state);
  if (player) {
    setPlayerId(player.id);
  } else {
    clearPlayerId();
  }
  persistSessionCookie();
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
  renderAccountGames();
  updateActionButtons();
}

function clearCurrentGameState(message: string, clearSelection = false): void {
  hideConfirmModal();
  hideOptionsMenu();
  clearMovePreview();
  stopScoreAnimation();
  hideScoreGain();
  latestGameState = null;
  currentBoardLayout = 'scrabble';
  renderBoardBackground(currentBoardLayout);
  selectedExchangeIds = new Set();
  clearPlayerId();
  if (clearSelection) {
    hydrateClientState({ currentGameId: null });
  }
  persistSessionCookie();
  if (!getClientState().currentGameId) {
    disconnectSocket();
  }
  app.classList.remove('app--waiting-turn');
  app.classList.remove('app--game-ended');
  syncGameOverPrompt(false);
  board.clearTiles();
  hand.clearTiles();
  renderTurnHistory([]);
  statusScoreValue.textContent = '0';
  statusScoreMeta.textContent = getClientState().currentGameId ? 'Waiting for game state' : 'Choose a game to start';
  renderAccountGames();
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
  const { account } = getClientState();
  if (account) {
    const accountPlayer = state.players.find((player) => player.accountId === account.id);
    if (accountPlayer) return accountPlayer;
  }
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
  if (state.gameEnded) {
    statusScoreMeta.textContent = `Game over / ${bagLabel}`;
  } else if (state.finalTurnsRemaining !== null) {
    const turnLabel = `${state.finalTurnsRemaining} final turn${state.finalTurnsRemaining === 1 ? '' : 's'} left`;
    statusScoreMeta.textContent = state.lastMove?.score
      ? `+${state.lastMove.score} last turn / ${turnLabel}`
      : `${turnLabel} / ${bagLabel}`;
  } else {
    statusScoreMeta.textContent = state.lastMove?.score
      ? `+${state.lastMove.score} last turn / ${bagLabel}`
      : bagLabel;
  }
  app.classList.toggle('app--waiting-turn', !state.gameEnded && !isMyTurn);
  app.classList.toggle('app--game-ended', state.gameEnded);
  syncGameOverPrompt(state.gameEnded);
  renderTurnHistory(state.turnHistory);
}

function syncGameOverPrompt(gameEnded: boolean): void {
  if (!gameOverPrompt) return;
  gameOverPrompt.hidden = !gameEnded;
}

function syncScoreFeedback(previousState: GameState | null, state: GameState): void {
  const previousGameId = gameIdFromState(previousState);
  const currentGameId = gameIdFromState(state);
  const previousScore = previousGameId && previousGameId === currentGameId ? previousState?.teamScore ?? null : null;
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

  updateOptionsMenuState(player, resetDisabled);
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
  const activeSocket = socket;
  if (!latestGameState || !activeSocket || !socketIsOpen()) {
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

  activeSocket.send(JSON.stringify({
    type: 'preview_turn',
    handState: hand.getHandState(),
    boardState: board.getBoardState(),
    requestId,
  } satisfies ClientMessage));
}

function applyMovePreview(preview: MovePreviewState): void {
  clearMovePreviewMarks();

  if (preview.words.length === 0) {
    previewLayer.replaceChildren();
    return;
  }

  if (preview.valid) {
    const highlightedCoords = new Set(
      preview.words.flatMap((word) => word.cells.map((cell) => `${cell.col}:${cell.row}`)),
    );

    for (const tile of board.tiles) {
      if (highlightedCoords.has(`${tile.col}:${tile.row}`)) {
        tile.el.classList.add('preview-valid');
      }
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
    const minY = Math.min(...cellCoords.map((coords) => coords.y));
    const maxY = Math.max(...cellCoords.map((coords) => coords.y));
    const centerX = (minX + maxX + TILE_SIZE) / 2;
    const bottomY = maxY + TILE_SIZE;
    const previewHeight = previewLayer.clientHeight || board.el.clientHeight;
    const badgeHeight = 18;
    const badgeGap = 5;
    const badgeStep = 20;
    const belowTop = bottomY + badgeGap;
    const needsAbove = belowTop + badgeHeight > previewHeight;
    const lane = needsAbove ? 'above' : 'below';
    const anchorY = needsAbove ? minY : bottomY;
    const badgeKey = `${lane}:${Math.round(centerX)}:${Math.round(anchorY)}`;
    const badgeIndex = badgeSlotCounts.get(badgeKey) ?? 0;
    badgeSlotCounts.set(badgeKey, badgeIndex + 1);
    badge.style.left = `${centerX}px`;
    if (needsAbove) {
      const aboveTop = minY - badgeGap - badgeHeight - badgeIndex * badgeStep;
      badge.style.top = `${Math.max(0, aboveTop)}px`;
    } else {
      badge.style.top = `${belowTop + badgeIndex * badgeStep}px`;
    }
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

function syncAccountUi(): void {
  const { account, sessionToken } = getClientState();
  const isAuthenticated = Boolean(account && sessionToken);
  accountCurrentValue.textContent = account?.name ?? 'Sign in';
  accountInput.placeholder = isAuthenticated ? 'opponent account' : 'account name';
  accountPrimaryButton.textContent = isAuthenticated ? 'New game' : 'Continue';
  accountSecondaryButton.textContent = isAuthenticated ? 'Sign out' : 'Clear';
  accountPrimaryButton.disabled = accountRequestInFlight;
  accountSecondaryButton.disabled = accountRequestInFlight;
  renderAccountGames();
}

function renderAccountGames(): void {
  const { account, currentGameId, games } = getClientState();
  if (games.length === 0) {
    accountGames.replaceChildren(renderEmptyGameChip(account ? 'No games yet' : 'No active session'));
    return;
  }

  const chips = games.map((game, index) => {
    const isSelected = currentGameId === game.gameId;
    const liveSummary = isSelected && latestGameState && gameIdFromState(latestGameState) === game.gameId
      ? gameSummaryFromState(latestGameState) ?? game
      : game;
    const summary = describeGameSummary(liveSummary, account?.name ?? null);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.classList.add('room-player');
    chip.style.cursor = 'pointer';
    chip.style.textAlign = 'left';
    chip.disabled = accountRequestInFlight;
    if (isSelected) {
      chip.classList.add('room-player--self');
      chip.setAttribute('aria-pressed', 'true');
    } else {
      chip.setAttribute('aria-pressed', 'false');
    }

    const label = document.createElement('span');
    label.classList.add('room-player__label');
    label.textContent = isSelected ? 'Current game' : `Game ${index + 1}`;

    const value = document.createElement('strong');
    value.classList.add('room-player__value');
    value.textContent = summary.title;

    const stateText = document.createElement('span');
    stateText.classList.add('room-player__state');
    stateText.textContent = isSelected ? selectedGameStatusText(liveSummary) : summary.status;

    chip.append(label, value, stateText);
    chip.addEventListener('click', () => {
      void selectGame(game.gameId);
    });
    return chip;
  });

  accountGames.replaceChildren(...chips);
}

function renderEmptyGameChip(message: string): HTMLDivElement {
  const chip = document.createElement('div');
  chip.classList.add('room-player', 'room-player--empty');

  const label = document.createElement('span');
  label.classList.add('room-player__label');
  label.textContent = 'Games';

  const value = document.createElement('strong');
  value.classList.add('room-player__value');
  value.textContent = message;

  chip.append(label, value);
  return chip;
}

function selectedGameStatusText(summary: GameSummary): string {
  const player = latestGameState ? currentPlayer(latestGameState) : null;
  const seatLabel = player ? `seat ${playerSeat(player) ?? 1}` : null;
  if (summary.gameEnded) {
    return seatLabel ? `${seatLabel} / finished` : 'finished';
  }
  if (!socketIsOpen()) {
    return seatLabel ? `${seatLabel} / reconnecting` : 'reconnecting';
  }
  if (latestGameState) {
    if (player && latestGameState.currentPlayerId === player.id) {
      return seatLabel ? `${seatLabel} / your turn` : 'your turn';
    }
  }
  return seatLabel ? `${seatLabel} / live` : 'live';
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
    meta.textContent = `Turn ${entry.turn} - ${entry.playerName || historyPlayerLabel(entry.playerId)}`;

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
        row.tabIndex = 0;
        row.classList.add('history-entry__word--interactive');

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
        row.appendChild(renderHistoryWordBreakdown(wordScore));
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

function renderHistoryWordBreakdown(wordScore: TurnWordScoreState): HTMLDivElement {
  const breakdown = document.createElement('div');
  breakdown.classList.add('history-word-breakdown');

  const title = document.createElement('div');
  title.classList.add('history-word-breakdown__title');
  title.textContent = historyWordFormula(wordScore);
  breakdown.appendChild(title);

  const bonusNote = historyWordBonusNote(wordScore);
  if (bonusNote) {
    const note = document.createElement('div');
    note.classList.add('history-word-breakdown__note');
    note.textContent = bonusNote;
    breakdown.appendChild(note);
  }
  return breakdown;
}

function historyWordFormula(wordScore: TurnWordScoreState): string {
  const terms = wordScore.letters.map((letterScore) => historyFormulaTerm(letterScore));
  const base = `${wordScore.word} = (${terms.join(' + ')})`;
  return wordScore.wordMultiplier > 1 ? `${base} x ${wordScore.wordMultiplier}` : base;
}

function historyFormulaTerm(letterScore: TurnWordScoreState['letters'][number]): string {
  if (
    letterScore.isNewTile &&
    letterScore.appliedMultiplier > 1 &&
    (letterScore.premium === 'double-letter' || letterScore.premium === 'triple-letter')
  ) {
    return `${letterScore.appliedMultiplier}x${letterScore.baseScore}`;
  }
  return `${letterScore.baseScore}`;
}

function historyWordBonusNote(wordScore: TurnWordScoreState): string {
  const notes: string[] = [];

  if (wordScore.wordBonuses.length > 0) {
    const bonusLetters = wordScore.wordBonuses.map((bonus) => (
      letterAtPosition(wordScore, bonus.col, bonus.row)
    ));
    notes.push(`word bonus on ${bonusLetters.join(', ')}`);
  }

  const doubleLetterBonuses = historyLetterBonusNotes(wordScore, 'double-letter');
  if (doubleLetterBonuses.length > 0) {
    notes.push(`double letter on ${doubleLetterBonuses.join(', ')}`);
  }

  const tripleLetterBonuses = historyLetterBonusNotes(wordScore, 'triple-letter');
  if (tripleLetterBonuses.length > 0) {
    notes.push(`triple letter on ${tripleLetterBonuses.join(', ')}`);
  }

  return notes.join('; ');
}

function historyLetterBonusNotes(
  wordScore: TurnWordScoreState,
  premium: 'double-letter' | 'triple-letter',
): string[] {
  return wordScore.letters
    .filter((letterScore) => letterScore.isNewTile && letterScore.premium === premium)
    .map((letterScore) => `"${letterScore.letter}"`);
}

function letterAtPosition(wordScore: TurnWordScoreState, col: number, row: number): string {
  const letter = wordScore.letters.find((candidate) => candidate.col === col && candidate.row === row)?.letter;
  return letter ? `"${letter}"` : formatCellPosition(col, row);
}

function formatCellPosition(col: number, row: number): string {
  return `(${col},${row})`;
}

async function handleAccountPrimaryAction(): Promise<void> {
  const inputValue = accountInput.value.trim();
  const { account, sessionToken } = getClientState();

  if (account && sessionToken) {
    if (inputValue.length === 0) {
      setStatus('Enter another account name to create a game.', 'error');
      return;
    }
    if (inputValue.toLowerCase() === account.name.toLowerCase()) {
      setStatus('Choose another account for the new game.', 'error');
      return;
    }
    await createGameWithOpponent(inputValue);
    return;
  }

  if (inputValue.length === 0) {
    setStatus('Enter an account name.', 'error');
    return;
  }

  await loginOrCreateAccountByName(inputValue);
}

function handleAccountSecondaryAction(): void {
  if (getClientState().account) {
    signOut();
    return;
  }

  accountInput.value = '';
  setStatus('Enter an account name to start.');
}

async function loginOrCreateAccountByName(accountName: string): Promise<void> {
  accountRequestInFlight = true;
  syncAccountUi();
  setStatus(`Signing in as ${accountName}...`);

  try {
    const previousState = getClientState();
    const result = await loginAccount(accountName);
    const preferredGameId = previousState.account?.id === result.account.id
      ? previousState.currentGameId
      : null;
    const selectedGameId = applyAuthenticatedSession({
      account: result.account,
      sessionToken: result.sessionToken,
      games: result.games,
      preferredGameId,
    });

    accountInput.value = '';
    if (selectedGameId) {
      selectGame(selectedGameId);
    } else {
      clearCurrentGameState(
        result.games.length > 0 ? 'Select a game or create a new one.' : 'Create a game to start playing.',
      );
    }
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

async function createGameWithOpponent(opponentName: string): Promise<void> {
  const { account, sessionToken } = getClientState();
  if (!account || !sessionToken) {
    setStatus('Sign in before creating a game.', 'error');
    return;
  }

  accountRequestInFlight = true;
  syncAccountUi();
  setStatus(`Creating a game with ${opponentName}...`);

  try {
    const result = await createGame(sessionToken, opponentName);
    hydrateClientState({ games: result.games });
    persistSessionCookie();
    accountInput.value = '';
    syncAccountUi();
    selectGame(result.game.gameId);
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

async function restoreAccountSession(): Promise<void> {
  const { currentGameId, sessionToken } = getClientState();
  if (!sessionToken) {
    clearCurrentGameState('Enter an account name to start.');
    return;
  }

  accountRequestInFlight = true;
  syncAccountUi();
  setStatus('Restoring account session...');

  try {
    const overview = await fetchAccountOverview(sessionToken);
    const selectedGameId = applyAuthenticatedSession({
      account: overview.account,
      sessionToken,
      games: overview.games,
      preferredGameId: currentGameId,
    });
    if (selectedGameId) {
      selectGame(selectedGameId);
    } else {
      clearCurrentGameState(
        overview.games.length > 0 ? 'Select a game or create a new one.' : 'Create a game to start playing.',
      );
    }
  } catch {
    clearClientState();
    clearCurrentGameState('Session expired. Sign in again.', true);
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

function applyAuthenticatedSession({
  account,
  sessionToken,
  games,
  preferredGameId,
}: {
  account: NonNullable<ReturnType<typeof getClientState>['account']>;
  sessionToken: string;
  games: GameSummary[];
  preferredGameId: string | null;
}): string | null {
  const selectedGameId = chooseSelectedGameId(preferredGameId, games);
  hydrateClientState({
    account,
    currentGameId: selectedGameId,
    games,
    sessionToken,
  });
  persistSessionCookie();
  syncAccountUi();
  return selectedGameId;
}

function chooseSelectedGameId(preferredGameId: string | null, games: GameSummary[]): string | null {
  if (!preferredGameId) return null;
  return games.some((game) => game.gameId === preferredGameId) ? preferredGameId : null;
}

function selectGame(gameId: string): void {
  const { currentGameId, games } = getClientState();
  if (!games.some((game) => game.gameId === gameId)) {
    setStatus('That game is not in your account overview.', 'error');
    return;
  }

  const alreadyLive = currentGameId === gameId &&
    latestGameState !== null &&
    gameIdFromState(latestGameState) === gameId &&
    (socketIsOpen() || socket?.readyState === WebSocket.CONNECTING);
  if (alreadyLive) {
    setStatus(`Already connected to game ${shortGameId(gameId)}.`);
    return;
  }

  waitingForServer = false;
  hydrateClientState({ currentGameId: gameId });
  persistSessionCookie();
  syncAccountUi();
  clearCurrentGameState(`Connecting to game ${shortGameId(gameId)}.`);
  ensureGameSocket(true);
}

function signOut(): void {
  accountRequestInFlight = false;
  disconnectSocket();
  clearClientState();
  accountInput.value = '';
  clearCurrentGameState('Signed out.', true);
  syncAccountUi();
}

function updateStoredGameSummary(summary: GameSummary): void {
  const { games } = getClientState();
  const nextGames = [...games];
  const existingIndex = nextGames.findIndex((game) => game.gameId === summary.gameId);
  if (existingIndex === -1) {
    nextGames.unshift(summary);
  } else {
    nextGames[existingIndex] = summary;
  }
  hydrateClientState({ games: nextGames });
}

function persistSessionCookie(): void {
  const { account, currentGameId, playerId, sessionToken } = getClientState();
  if (!account || !sessionToken) {
    clearSessionCookie();
    return;
  }

  writeSessionCookie({
    accountId: account.id,
    accountName: account.name,
    currentGameId: currentGameId ?? undefined,
    playerId: playerId ?? undefined,
    sessionToken,
  });
}

function setStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
  statusNoticeValue.textContent = message;
  if (statusScoreCard) {
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

function historyPlayerLabel(playerId: string): string {
  const player = latestGameState?.players.find((candidate) => candidate.id === playerId);
  return player ? playerAccountName(player) ?? shortId(player.id) : shortId(playerId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : 'Something went wrong.';
}

function disconnectSocket(): void {
  clearReconnectTimer();
  socketGeneration += 1;
  if (!socket) return;
  socket.close();
  socket = null;
}

function clearReconnectTimer(): void {
  if (reconnectTimerId !== null) {
    window.clearTimeout(reconnectTimerId);
    reconnectTimerId = null;
  }
}

function renderBoardBackground(layout: BoardLayoutType): void {
  for (const tile of boardBackgroundTiles) {
    const { col, row } = tile;
    const premiumSquare = premiumSquareAt(layout, col, row);
    tile.el.classList.remove(
      'premium-square',
      'premium-square--double-letter',
      'premium-square--triple-letter',
      'premium-square--double-word',
      'premium-square--triple-word',
      'center-tile',
      'center-tile--nyt',
    );
    if (premiumSquare !== 'normal') {
      tile.el.classList.add('premium-square', `premium-square--${premiumSquare}`);
      tile.el.setAttribute('data-premium-label', premiumSquareLabel(premiumSquare));
    } else {
      tile.el.removeAttribute('data-premium-label');
    }

    if (col === Math.floor(board.grid.cols / 2) && row === Math.floor(board.grid.rows / 2)) {
      tile.el.classList.add('center-tile');
      if (layout === 'nyt-crossplay') {
        tile.el.classList.add('center-tile--nyt');
        tile.el.setAttribute('data-premium-label', '✦');
      } else {
        tile.el.setAttribute('data-premium-label', '★');
      }
    }
  }
}

function hideOptionsMenu(): void {
  optionsMenu.hidden = true;
}

function updateOptionsMenuState(player: PlayerPublicState | null, resetDisabled: boolean): void {
  const canChangeLayout = Boolean(
    player &&
    latestGameState?.canChangeBoardLayout &&
    socketIsOpen() &&
    !waitingForServer,
  );
  setBoardLayoutButtonState(scrabbleLayoutButton, currentBoardLayout === 'scrabble', !canChangeLayout);
  setBoardLayoutButtonState(
    wordsWithFriendsLayoutButton,
    currentBoardLayout === 'words-with-friends',
    !canChangeLayout,
  );
  setBoardLayoutButtonState(
    nytCrossplayLayoutButton,
    currentBoardLayout === 'nyt-crossplay',
    !canChangeLayout,
  );
  if (resetButton) {
    resetButton.disabled = resetDisabled;
  }
}

function setBoardLayoutButtonState(
  button: HTMLButtonElement,
  active: boolean,
  disabled: boolean,
): void {
  button.classList.toggle('options-layout-button--active', active);
  button.disabled = disabled;
}

function hasPendingBoardTiles(): boolean {
  return board.tiles.some((tile) => !tile.isPlayed);
}

function submitPlayTurn(): void {
  if (!latestGameState || !currentPlayer(latestGameState)) return;
  clearMovePreview();
  sendMessageToServer({
    type: 'play_turn',
    handState: hand.getHandState(),
    boardState: board.getBoardState(),
  });
}

function requestBoardLayout(layout: BoardLayoutType): void {
  if (!latestGameState || currentBoardLayout === layout) {
    hideOptionsMenu();
    return;
  }
  if (!currentPlayer(latestGameState)) return;
  sendMessageToServer({
    type: 'set_board_layout',
    layout,
  });
  hideOptionsMenu();
}

function ensureGameSocket(forceReconnect = false): void {
  const target = currentSocketTarget();
  if (!target) {
    waitingForServer = false;
    disconnectSocket();
    updateActionButtons();
    return;
  }

  if (
    !forceReconnect &&
    socket &&
    socketMatchesTarget(socket, target) &&
    (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  disconnectSocket();
  const generation = ++socketGeneration;
  socket = new WebSocket(webSocketUrl(target.sessionToken, target.gameId));

  socket.addEventListener('open', () => {
    if (generation !== socketGeneration) return;
    reconnectAttempts = 0;
    setStatus(`Connected to game ${shortGameId(target.gameId)}. Waiting for game state.`);
    updateActionButtons();
  });

  socket.addEventListener('close', () => {
    if (generation !== socketGeneration) return;
    socket = null;
    waitingForServer = false;
    updateActionButtons();
    if (shouldReconnectTo(target)) {
      setStatus('Disconnected. Reconnecting.');
      scheduleReconnect();
    }
  });

  socket.addEventListener('error', () => {
    if (generation !== socketGeneration) return;
    waitingForServer = false;
    setStatus('Connection error. Reconnecting.', 'error');
    updateActionButtons();
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    if (generation !== socketGeneration) return;

    let msg: unknown;
    try {
      msg = JSON.parse(event.data);
    } catch {
      setStatus('Received an unreadable server message.', 'error');
      return;
    }

    handleServerMessage(msg);
  });
}

function scheduleReconnect(): void {
  clearReconnectTimer();
  reconnectAttempts += 1;
  const delay = Math.min(reconnectMaxDelayMs, reconnectBaseDelayMs * 2 ** (reconnectAttempts - 1));
  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    ensureGameSocket(true);
  }, delay);
}

function socketIsOpen(): boolean {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
}

function webSocketUrl(sessionToken: string, gameId: string): string {
  const query = new URLSearchParams();
  query.set('session', sessionToken);
  query.set('game', gameId);
  return resolveWebSocketUrl('/ws', query);
}

function currentSocketTarget(): { sessionToken: string; gameId: string } | null {
  const { currentGameId, sessionToken } = getClientState();
  return currentGameId && sessionToken ? { sessionToken, gameId: currentGameId } : null;
}

function socketMatchesTarget(
  candidateSocket: WebSocket,
  target: { sessionToken: string; gameId: string },
): boolean {
  const socketUrl = new URL(candidateSocket.url);
  return socketUrl.searchParams.get('session') === target.sessionToken &&
    socketUrl.searchParams.get('game') === target.gameId;
}

function shouldReconnectTo(target: { sessionToken: string; gameId: string }): boolean {
  const desiredTarget = currentSocketTarget();
  return Boolean(
    desiredTarget &&
    desiredTarget.sessionToken === target.sessionToken &&
    desiredTarget.gameId === target.gameId,
  );
}

function handleServerMessage(message: unknown): void {
  if (!isRecord(message) || typeof message.type !== 'string') {
    setStatus('Received a malformed server message.', 'error');
    return;
  }

  switch (message.type) {
    case 'game_state': {
      if (!('state' in message)) {
        setStatus('Server state message was missing game data.', 'error');
        return;
      }

      waitingForServer = false;
      syncGameState(message.state as GameState);
      break;
    }
    case 'move_preview': {
      const requestId = readIntegerValue(message.requestId);
      if (requestId === null) return;
      if (requestId === latestPreviewRequestId && 'preview' in message) {
        applyMovePreview(message.preview as MovePreviewState);
      }
      break;
    }
    case 'turn_rejected': {
      waitingForServer = false;
      setStatus(readStringValue(message.reason) ?? 'Turn rejected.', 'error');
      updateActionButtons();
      if (hasPendingBoardTiles()) {
        scheduleMovePreview();
      }
      break;
    }
    case 'error': {
      waitingForServer = false;
      setStatus(readStringValue(message.msg) ?? 'The server returned an error.', 'error');
      updateActionButtons();
      break;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readStringValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readIntegerValue(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
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
