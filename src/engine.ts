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
import {
  readClaimStore,
  removeStoredClaim,
  upsertStoredClaim,
  type StoredClaim,
} from './claimStore.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'
import {
  readPreferredDisplayName,
  writePreferredDisplayName,
} from './displayNameCookie.ts'
import {
  claimInviteGame,
  createInviteGame,
  fetchGameSummary,
  renameClaimedPlayer,
} from './gameApi.ts'
import {
  type ClaimSession,
  gameIdFromState,
  playerName,
  shortGameId,
  summaryOpponentName,
  type GameSummary,
} from './gameModels.ts'
import { Hand } from './hand.ts'
import { premiumSquareAt, premiumSquareLabel, type BoardLayoutType } from '../shared/boardBonuses.ts'
import {
  DEFAULT_BLANK_TILE_COUNT,
  LETTER_VALUES,
  TILE_DISTRIBUTION,
  type Letter,
} from '../shared/letters.ts'
import { type AreaBonusRule, type WordLengthRule } from '../shared/ruleSets.ts'
import { Tile } from './tile.ts'
import { makeDraggable } from './draggable.ts'
import {
  clearCurrentPlayerId,
  getClientState,
  hydrateClientState,
  setCurrentPlayerId,
} from './clientState.ts'
import { resolveWebSocketUrl } from './network.ts'
import {
  clearTurnNotifications,
  currentTurnNotificationPermission,
  installTurnNotificationAutoClear,
  notifyCurrentPlayerTurn,
  requestTurnNotificationPermission,
  turnNotificationsSupported,
} from './turnNotifications.ts'

const reconnectBaseDelayMs = 400;
const reconnectMaxDelayMs = 8000;
const APP_SHELL_WIDTH = `${parseInt(APP_WIDTH, 10) + 304}px`;
const APP_SHELL_WIDTH_STYLE = `min(calc(100vw - 28px), ${APP_SHELL_WIDTH})`;
const PLAYER_NAME_MAX_LENGTH = 24;
const PREVIEW_DEBOUNCE_MS = 120;
const MOBILE_HAND_MAX_SCALE = 1.42;
const MODAL_ANIMATION_MS = 220;
const THEME_STORAGE_KEY = 'adjacency_theme';
const LIGHT_THEME_COLOR = '#eef4fc';
const DARK_THEME_COLOR = '#151b26';
const mobileLayoutQuery = window.matchMedia('(max-width: 720px)');

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let reconnectTimerId: number | null = null;
let socketGeneration = 0;
let latestGameState: GameState | null = null;
let currentGameSummary: GameSummary | null = null;
let waitingForServer = false;
let accountRequestInFlight = false;
let statusScoreCard: HTMLDivElement;
let statusScoreMain: HTMLDivElement;
let statusScoreValue: HTMLDivElement;
let statusScoreMeta: HTMLDivElement;
let tileBagCard: HTMLButtonElement;
let tileBagValue: HTMLSpanElement;
let statusScoreLatestCard: HTMLDivElement;
let statusScoreLatest: HTMLDivElement;
let statusScoreLatestTrack: HTMLSpanElement;
let statusScoreLatestText: HTMLSpanElement;
let statusScoreLatestTickerCopy: HTMLSpanElement;
let statusScoreSquareIndicator: HTMLSpanElement;
let statusScoreBreakdown: HTMLDivElement;
let statusScoreDelta: HTMLDivElement;
let accountCurrentValue: HTMLSpanElement;
let accountGames: HTMLDivElement;
let mobilePlayersBar: HTMLDivElement;
let mobilePlayersValue: HTMLSpanElement;
let statusNoticeValue: HTMLElement;
let historySummary: HTMLSpanElement;
let historyList: HTMLDivElement;
let previewLayer: HTMLDivElement;
let optionsButton: HTMLButtonElement | null = null;
let headerCopyInviteButton: HTMLButtonElement | null = null;
let headerActions: HTMLDivElement | null = null;
let menuCopyInviteButton!: HTMLButtonElement;
let gamesMenuButton!: HTMLButtonElement;
let optionsMenu!: HTMLDivElement;
let mobileStatusSection!: HTMLDivElement;
let gameOverPrompt: HTMLDivElement | null = null;
let playButton: HTMLButtonElement | null = null;
let passButton: HTMLButtonElement | null = null;
let exchangeButton: HTMLButtonElement | null = null;
let shuffleButton: HTMLButtonElement | null = null;
let recallButton: HTMLButtonElement | null = null;
let newGameMenuButton!: HTMLButtonElement;
let changeDisplayNameMenuButton!: HTMLButtonElement;
let notificationMenuButton!: HTMLButtonElement;
let singlePlayerMenuButton!: HTMLButtonElement;
let scrabbleLayoutButton!: HTMLButtonElement;
let wordsWithFriendsLayoutButton!: HTMLButtonElement;
let nytCrossplayLayoutButton!: HTMLButtonElement;
let standardWordLengthButton!: HTMLButtonElement;
let noTwoLetterWordsButton!: HTMLButtonElement;
let noThreeLetterWordsButton!: HTMLButtonElement;
let noAreaBonusButton!: HTMLButtonElement;
let closedRectangleBonusButton!: HTMLButtonElement;
let darkModeMenuButton!: HTMLButtonElement;
let selectedExchangeIds = new Set<string>();
let currentBoardLayout: BoardLayoutType = 'scrabble';
let currentWordLengthRule: WordLengthRule = 'standard';
let currentAreaBonusRule: AreaBonusRule = 'none';
const boardBackgroundTiles: Tile[] = [];
let nameModal: HTMLDivElement;
let nameModalInput: HTMLInputElement;
let nameModalSaveButton: HTMLButtonElement;
let nameModalCancelButton: HTMLButtonElement;
let gamesModal: HTMLDivElement;
let gamesModalList: HTMLDivElement;
let gamesModalCloseButton: HTMLButtonElement;
let gameDeleteConfirmModal: HTMLDivElement;
let gameDeleteConfirmTitle: HTMLHeadingElement;
let gameDeleteConfirmText: HTMLParagraphElement;
let gameDeleteConfirmCancelButton: HTMLButtonElement;
let gameDeleteConfirmButton: HTMLButtonElement;
let pendingModalDeleteGameId: string | null = null;
let blankTileModal: HTMLDivElement;
let blankTileGrid: HTMLDivElement;
let blankTileCancelButton: HTMLButtonElement;
let tileBagModal: HTMLDivElement;
let tileBagGrid: HTMLDivElement;
let tileBagCount: HTMLSpanElement;
let tileBagCloseButton: HTMLButtonElement;
let pendingBlankTile: Tile | null = null;
let previewTimerId: number | null = null;
let latestPreviewRequestId = 0;
let scoreAnimationFrameId: number | null = null;
let scoreFeedbackTimerId: number | null = null;
const animatedElementHideTimers = new WeakMap<HTMLElement, number>();
let darkModeEnabled = readDarkModePreference();

function sendMessageToServer(message: ClientMessage): void {
  if (!socket || !socketIsOpen()) {
    setStatus('Socket is not open yet.');
    return;
  }

  waitingForServer = true;
  updateActionButtons();
  socket.send(JSON.stringify(message));
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // The game still works without offline shell caching.
    });
  });
}

function readDarkModePreference(): boolean {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  } catch {
    return document.documentElement.classList.contains('theme-dark');
  }
}

function writeDarkModePreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, enabled ? 'dark' : 'light');
  } catch {
    // The visual state can still update for the current session.
  }
}

function setDarkModePreference(enabled: boolean): void {
  darkModeEnabled = enabled;
  writeDarkModePreference(enabled);
  applyThemePreference();
  syncDarkModeButtonState();
}

function applyThemePreference(): void {
  document.documentElement.classList.toggle('theme-dark', darkModeEnabled);
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (themeColor) {
    themeColor.content = darkModeEnabled ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  }
}

function syncDarkModeButtonState(): void {
  if (!darkModeMenuButton) return;
  darkModeMenuButton.textContent = darkModeEnabled ? 'Dark mode on' : 'Dark mode off';
  darkModeMenuButton.classList.toggle('options-layout-button--active', darkModeEnabled);
}

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('Missing #app');
}
applyThemePreference();
registerServiceWorker();
const app = appRoot as HTMLDivElement;
app.style.width = APP_SHELL_WIDTH_STYLE;
const initialStore = readClaimStore();
const initialGameId = currentGameIdFromLocation() ?? initialStore.claims[0]?.gameId ?? null;
const initialClaim = findStoredClaim(initialStore.claims, initialGameId);
if (
  readPreferredDisplayName().length === 0 &&
  initialClaim &&
  !isDefaultSeatName(initialClaim.playerName, initialClaim.seat)
) {
  writePreferredDisplayName(initialClaim.playerName);
}
hydrateClientState({
  claims: initialStore.claims,
  currentClaimToken: initialClaim?.claimToken ?? null,
  currentGameId: initialGameId,
  currentPlayerId: initialClaim?.playerId ?? null,
});

const headerContainer = document.querySelector('.container') as HTMLDivElement | null;
if (headerContainer) {
  headerContainer.style.width = APP_SHELL_WIDTH_STYLE;
}
const header = document.querySelector('.header') as HTMLDivElement | null;

const accountBar = document.createElement('div');
accountBar.classList.add('room-bar');
const accountTop = document.createElement('div');
accountTop.classList.add('room-bar__top');
const accountMeta = document.createElement('div');
accountMeta.classList.add('room-bar__meta');
const accountIdentity = document.createElement('div');
accountIdentity.classList.add('room-bar__room');
const accountLabel = document.createElement('span');
accountLabel.classList.add('room-bar__label');
accountLabel.textContent = 'Game';
accountCurrentValue = document.createElement('span');
accountCurrentValue.classList.add('room-bar__current');
accountGames = document.createElement('div');
accountGames.classList.add('room-bar__players');
const statusNotice = document.createElement('div');
statusNotice.classList.add('room-bar__status');
const statusNoticeLabel = document.createElement('span');
statusNoticeLabel.classList.add('room-bar__status-label');
statusNoticeLabel.textContent = 'Status';
statusNoticeValue = document.createElement('strong');
statusNoticeValue.classList.add('room-bar__status-value');
accountIdentity.append(accountLabel, accountCurrentValue);
statusNotice.append(statusNoticeLabel, statusNoticeValue);
accountMeta.append(accountIdentity, statusNotice);
accountTop.append(accountMeta);
accountBar.append(accountTop, accountGames);
app.appendChild(accountBar);

mobilePlayersBar = document.createElement('div');
mobilePlayersBar.classList.add('mobile-players-bar');
mobilePlayersValue = document.createElement('span');
mobilePlayersValue.classList.add('mobile-players-bar__value');
mobilePlayersValue.textContent = 'Player 1 and Player 2';
mobilePlayersBar.appendChild(mobilePlayersValue);
app.appendChild(mobilePlayersBar);

if (header) {
  headerActions = document.createElement('div');
  headerActions.classList.add('header-actions');
  headerCopyInviteButton = document.createElement('button');
  headerCopyInviteButton.classList.add('room-button', 'room-button--secondary', 'header-copy-button');
  headerCopyInviteButton.type = 'button';
  headerCopyInviteButton.textContent = 'Copy invite';
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
  scrabbleLayoutButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  scrabbleLayoutButton.type = 'button';
  scrabbleLayoutButton.textContent = 'Scrabble-like';

  wordsWithFriendsLayoutButton = document.createElement('button');
  wordsWithFriendsLayoutButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  wordsWithFriendsLayoutButton.type = 'button';
  wordsWithFriendsLayoutButton.textContent = 'WWF-like';

  nytCrossplayLayoutButton = document.createElement('button');
  nytCrossplayLayoutButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  nytCrossplayLayoutButton.type = 'button';
  nytCrossplayLayoutButton.textContent = 'NYT crossplay-like';

  layoutButtons.append(scrabbleLayoutButton, wordsWithFriendsLayoutButton, nytCrossplayLayoutButton);
  layoutSection.append(layoutLabel, layoutButtons);

  const rulesSection = document.createElement('div');
  rulesSection.classList.add('options-menu__section');

  const rulesLabel = document.createElement('div');
  rulesLabel.classList.add('options-menu__label');
  rulesLabel.textContent = 'Word length';

  const rulesButtons = document.createElement('div');
  rulesButtons.classList.add('options-menu__layout-buttons');

  standardWordLengthButton = document.createElement('button');
  standardWordLengthButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  standardWordLengthButton.type = 'button';
  standardWordLengthButton.textContent = 'Standard';

  noTwoLetterWordsButton = document.createElement('button');
  noTwoLetterWordsButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  noTwoLetterWordsButton.type = 'button';
  noTwoLetterWordsButton.textContent = 'No 2-letter words';

  noThreeLetterWordsButton = document.createElement('button');
  noThreeLetterWordsButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  noThreeLetterWordsButton.type = 'button';
  noThreeLetterWordsButton.textContent = 'No 3-letter words';

  rulesButtons.append(standardWordLengthButton, noTwoLetterWordsButton, noThreeLetterWordsButton);
  rulesSection.append(rulesLabel, rulesButtons);

  const areaBonusSection = document.createElement('div');
  areaBonusSection.classList.add('options-menu__section');

  const areaBonusLabel = document.createElement('div');
  areaBonusLabel.classList.add('options-menu__label');
  areaBonusLabel.textContent = 'Area bonus';

  const areaBonusButtons = document.createElement('div');
  areaBonusButtons.classList.add('options-menu__layout-buttons');

  noAreaBonusButton = document.createElement('button');
  noAreaBonusButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  noAreaBonusButton.type = 'button';
  noAreaBonusButton.textContent = 'None';

  closedRectangleBonusButton = document.createElement('button');
  closedRectangleBonusButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  closedRectangleBonusButton.type = 'button';
  closedRectangleBonusButton.textContent = 'Closed rectangles';

  areaBonusButtons.append(noAreaBonusButton, closedRectangleBonusButton);
  areaBonusSection.append(areaBonusLabel, areaBonusButtons);

  const modeSection = document.createElement('div');
  modeSection.classList.add('options-menu__section');

  const modeLabel = document.createElement('div');
  modeLabel.classList.add('options-menu__label');
  modeLabel.textContent = 'Players';

  singlePlayerMenuButton = document.createElement('button');
  singlePlayerMenuButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  singlePlayerMenuButton.type = 'button';
  singlePlayerMenuButton.textContent = 'Single-player';

  modeSection.append(modeLabel, singlePlayerMenuButton);

  const notificationSection = document.createElement('div');
  notificationSection.classList.add('options-menu__section');
  const notificationLabel = document.createElement('div');
  notificationLabel.classList.add('options-menu__label');
  notificationLabel.textContent = 'Notifications';
  notificationMenuButton = document.createElement('button');
  notificationMenuButton.classList.add('options-menu__button');
  notificationMenuButton.type = 'button';
  notificationMenuButton.textContent = 'Enable turn notifications';
  notificationSection.append(notificationLabel, notificationMenuButton);

  const appearanceSection = document.createElement('div');
  appearanceSection.classList.add('options-menu__section');
  const appearanceLabel = document.createElement('div');
  appearanceLabel.classList.add('options-menu__label');
  appearanceLabel.textContent = 'Appearance';
  darkModeMenuButton = document.createElement('button');
  darkModeMenuButton.classList.add('options-menu__button', 'options-menu__button--choice', 'options-layout-button');
  darkModeMenuButton.type = 'button';
  appearanceSection.append(appearanceLabel, darkModeMenuButton);

  const profileSection = document.createElement('div');
  profileSection.classList.add('options-menu__section');
  const profileLabel = document.createElement('div');
  profileLabel.classList.add('options-menu__label');
  profileLabel.textContent = 'Profile';
  changeDisplayNameMenuButton = document.createElement('button');
  changeDisplayNameMenuButton.classList.add('options-menu__button');
  changeDisplayNameMenuButton.type = 'button';
  changeDisplayNameMenuButton.textContent = 'Change display name';
  profileSection.append(profileLabel, changeDisplayNameMenuButton);

  const gameSection = document.createElement('div');
  gameSection.classList.add('options-menu__section');
  const gameLabel = document.createElement('div');
  gameLabel.classList.add('options-menu__label');
  gameLabel.textContent = 'Game';
  menuCopyInviteButton = document.createElement('button');
  menuCopyInviteButton.classList.add('options-menu__button');
  menuCopyInviteButton.type = 'button';
  menuCopyInviteButton.textContent = 'Copy invite';
  gamesMenuButton = document.createElement('button');
  gamesMenuButton.classList.add('options-menu__button');
  gamesMenuButton.type = 'button';
  gamesMenuButton.textContent = 'All games';
  newGameMenuButton = document.createElement('button');
  newGameMenuButton.classList.add('options-menu__button');
  newGameMenuButton.type = 'button';
  newGameMenuButton.textContent = 'New game';
  gameSection.append(gameLabel, newGameMenuButton, gamesMenuButton, menuCopyInviteButton);

  mobileStatusSection = document.createElement('div');
  mobileStatusSection.classList.add('options-menu__section', 'options-menu__section--mobile-panel');

  optionsMenu.append(
    gameSection,
    layoutSection,
    rulesSection,
    areaBonusSection,
    modeSection,
    notificationSection,
    appearanceSection,
    mobileStatusSection,
    profileSection,
  );
  gameOverPrompt = document.createElement('div');
  gameOverPrompt.classList.add('game-over-prompt');
  gameOverPrompt.hidden = true;
  gameOverPrompt.setAttribute('aria-hidden', 'true');
  gameOverPrompt.innerHTML = `
    <span class="game-over-prompt__arrow">↑</span>
    <span class="game-over-prompt__text">New game to play again</span>
  `;

  document.body.appendChild(optionsMenu);
  syncDarkModeButtonState();
  headerActions.append(headerCopyInviteButton, optionsButton, gameOverPrompt);
  header.appendChild(headerActions);
}

statusScoreCard = document.createElement('div');
statusScoreCard.classList.add('status-score');
statusScoreCard.tabIndex = 0;
statusScoreCard.role = 'button';
statusScoreCard.setAttribute('aria-expanded', 'false');
const statusScoreLabel = document.createElement('div');
statusScoreLabel.classList.add('status-score__label');
statusScoreLabel.textContent = 'Team score';
statusScoreMain = document.createElement('div');
statusScoreMain.classList.add('status-score__main');
statusScoreValue = document.createElement('div');
statusScoreValue.classList.add('status-score__value');
statusScoreValue.textContent = '0';
statusScoreMain.append(statusScoreValue);
statusScoreLatestCard = document.createElement('div');
statusScoreLatestCard.classList.add('status-score-latest');
statusScoreLatestCard.tabIndex = 0;
statusScoreLatestCard.role = 'button';
statusScoreLatestCard.setAttribute('aria-expanded', 'false');
statusScoreLatest = document.createElement('div');
statusScoreLatest.classList.add('status-score-latest__text');
statusScoreLatestTrack = document.createElement('span');
statusScoreLatestTrack.classList.add('status-score-latest__ticker');
statusScoreLatestText = document.createElement('span');
statusScoreLatestText.classList.add('status-score-latest__ticker-copy');
statusScoreLatestTickerCopy = document.createElement('span');
statusScoreLatestTickerCopy.classList.add('status-score-latest__ticker-copy', 'status-score-latest__ticker-copy--clone');
statusScoreLatestTickerCopy.setAttribute('aria-hidden', 'true');
statusScoreLatestTrack.append(statusScoreLatestText, statusScoreLatestTickerCopy);
statusScoreLatest.appendChild(statusScoreLatestTrack);
setStatusScoreLatestText('No words yet');
statusScoreSquareIndicator = document.createElement('span');
statusScoreSquareIndicator.classList.add('status-score-latest__square-indicator');
statusScoreSquareIndicator.hidden = true;
statusScoreSquareIndicator.textContent = '□';
statusScoreLatestCard.append(statusScoreLatest, statusScoreSquareIndicator);
statusScoreMeta = document.createElement('div');
statusScoreMeta.classList.add('status-score__meta');
statusScoreMeta.textContent = 'Choose a game to start';
statusScoreDelta = document.createElement('div');
statusScoreDelta.classList.add('status-score__delta');
statusScoreDelta.setAttribute('aria-hidden', 'true');
tileBagCard = document.createElement('button');
tileBagCard.type = 'button';
tileBagCard.classList.add('tile-bag-card');
tileBagCard.setAttribute('aria-haspopup', 'dialog');
tileBagCard.setAttribute('aria-label', 'Tile bag. No game loaded.');
const tileBagLabel = document.createElement('span');
tileBagLabel.classList.add('tile-bag-card__label');
tileBagLabel.textContent = 'Bag';
tileBagValue = document.createElement('span');
tileBagValue.classList.add('tile-bag-card__value');
tileBagValue.textContent = '0';
tileBagCard.append(tileBagLabel, tileBagValue);
statusScoreBreakdown = document.createElement('div');
statusScoreBreakdown.classList.add('status-score__breakdown');
statusScoreBreakdown.hidden = true;
statusScoreCard.append(
  statusScoreLabel,
  statusScoreMain,
  statusScoreMeta,
  statusScoreDelta,
);
statusScoreLatestCard.appendChild(statusScoreBreakdown);

const mainLayout = document.createElement('div');
mainLayout.classList.add('main-layout');
app.appendChild(mainLayout);

const boardArea = document.createElement('div');
boardArea.classList.add('board-area');
mainLayout.appendChild(boardArea);

const sideColumn = document.createElement('aside');
sideColumn.classList.add('side-column');
sideColumn.append(tileBagCard, statusScoreCard, statusScoreLatestCard);
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

window.addEventListener('resize', () => {
  syncHistoryPanelHeight();
  syncMobileLayout();
  syncStatusScoreLatestTicker();
});
window.requestAnimationFrame(syncHistoryPanelHeight);
syncMobileLayout();
mobileLayoutQuery.addEventListener('change', syncMobileLayout);
installTurnNotificationAutoClear();

nameModal = document.createElement('div');
nameModal.classList.add('modal-backdrop');
nameModal.hidden = true;
nameModal.innerHTML = `
  <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="name-modal-title">
    <h2 id="name-modal-title">Set display name</h2>
    <p>This name is shown in your games and reused for future games on this device.</p>
    <div class="modal-form">
      <input type="text" id="name-modal-input" class="room-input modal-input" maxlength="${PLAYER_NAME_MAX_LENGTH}" autocomplete="off" spellcheck="false">
    </div>
    <div class="modal-actions">
      <button type="button" id="name-modal-cancel-button" class="action-button action-button--secondary">cancel</button>
      <button type="button" id="name-modal-save-button" class="action-button">save</button>
    </div>
  </div>
`;
document.body.appendChild(nameModal);
nameModalInput = document.getElementById('name-modal-input') as HTMLInputElement;
nameModalSaveButton = document.getElementById('name-modal-save-button') as HTMLButtonElement;
nameModalCancelButton = document.getElementById('name-modal-cancel-button') as HTMLButtonElement;

gamesModal = document.createElement('div');
gamesModal.classList.add('modal-backdrop');
gamesModal.hidden = true;
gamesModal.innerHTML = `
  <div class="modal-card games-modal-card" role="dialog" aria-modal="true" aria-labelledby="games-modal-title">
    <div class="games-modal-header">
      <h2 id="games-modal-title">Saved Games</h2>
      <button type="button" id="games-modal-close-button" class="action-button action-button--secondary games-modal-close-button">close</button>
    </div>
    <div id="games-modal-list" class="games-modal-list"></div>
  </div>
`;
document.body.appendChild(gamesModal);
gamesModalList = document.getElementById('games-modal-list') as HTMLDivElement;
gamesModalCloseButton = document.getElementById('games-modal-close-button') as HTMLButtonElement;

gameDeleteConfirmModal = document.createElement('div');
gameDeleteConfirmModal.classList.add('modal-backdrop');
gameDeleteConfirmModal.hidden = true;
gameDeleteConfirmModal.innerHTML = `
  <div class="modal-card game-delete-confirm-modal-card" role="dialog" aria-modal="true" aria-labelledby="game-delete-confirm-title" aria-describedby="game-delete-confirm-text">
    <h2 id="game-delete-confirm-title">Remove game?</h2>
    <p id="game-delete-confirm-text">This removes the saved game from this device.</p>
    <div class="modal-actions">
      <button type="button" id="game-delete-confirm-cancel-button" class="action-button action-button--secondary">cancel</button>
      <button type="button" id="game-delete-confirm-button" class="action-button games-modal-item__button games-modal-item__delete-button">remove</button>
    </div>
  </div>
`;
document.body.appendChild(gameDeleteConfirmModal);
gameDeleteConfirmTitle = document.getElementById('game-delete-confirm-title') as HTMLHeadingElement;
gameDeleteConfirmText = document.getElementById('game-delete-confirm-text') as HTMLParagraphElement;
gameDeleteConfirmCancelButton = document.getElementById('game-delete-confirm-cancel-button') as HTMLButtonElement;
gameDeleteConfirmButton = document.getElementById('game-delete-confirm-button') as HTMLButtonElement;

blankTileModal = document.createElement('div');
blankTileModal.classList.add('modal-backdrop');
blankTileModal.hidden = true;
blankTileModal.innerHTML = `
  <div class="modal-card blank-tile-modal-card" role="dialog" aria-modal="true" aria-labelledby="blank-tile-modal-title">
    <h2 id="blank-tile-modal-title">Choose blank letter</h2>
    <div id="blank-tile-grid" class="blank-tile-grid"></div>
    <div class="modal-actions">
      <button type="button" id="blank-tile-cancel-button" class="action-button action-button--secondary">cancel</button>
    </div>
  </div>
`;
document.body.appendChild(blankTileModal);
blankTileGrid = document.getElementById('blank-tile-grid') as HTMLDivElement;
blankTileCancelButton = document.getElementById('blank-tile-cancel-button') as HTMLButtonElement;

for (const letter of Object.keys(LETTER_VALUES) as Letter[]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.classList.add('blank-tile-choice');
  button.textContent = letter;
  button.addEventListener('click', () => {
    chooseBlankTileLetter(letter);
  });
  blankTileGrid.appendChild(button);
}

tileBagModal = document.createElement('div');
tileBagModal.classList.add('modal-backdrop');
tileBagModal.hidden = true;
tileBagModal.innerHTML = `
  <div class="modal-card tile-bag-modal-card" role="dialog" aria-modal="true" aria-labelledby="tile-bag-modal-title">
    <div class="tile-bag-modal-header">
      <div>
        <h2 id="tile-bag-modal-title">Tile bag</h2>
        <p><span id="tile-bag-count">0</span> tiles left.</p>
      </div>
      <button type="button" id="tile-bag-close-button" class="action-button action-button--secondary tile-bag-close-button">close</button>
    </div>
    <div id="tile-bag-grid" class="tile-bag-grid"></div>
  </div>
`;
document.body.appendChild(tileBagModal);
tileBagGrid = document.getElementById('tile-bag-grid') as HTMLDivElement;
tileBagCount = document.getElementById('tile-bag-count') as HTMLSpanElement;
tileBagCloseButton = document.getElementById('tile-bag-close-button') as HTMLButtonElement;

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

scrabbleLayoutButton.addEventListener('click', () => {
  requestBoardLayout('scrabble');
});

wordsWithFriendsLayoutButton.addEventListener('click', () => {
  requestBoardLayout('words-with-friends');
});

nytCrossplayLayoutButton.addEventListener('click', () => {
  requestBoardLayout('nyt-crossplay');
});

standardWordLengthButton.addEventListener('click', () => {
  requestWordLengthRule('standard');
});

noTwoLetterWordsButton.addEventListener('click', () => {
  requestWordLengthRule('no-two-letter-words');
});

noThreeLetterWordsButton.addEventListener('click', () => {
  requestWordLengthRule('no-three-letter-words');
});

noAreaBonusButton.addEventListener('click', () => {
  requestAreaBonusRule('none');
});

closedRectangleBonusButton.addEventListener('click', () => {
  requestAreaBonusRule('closed-rectangle-area');
});

singlePlayerMenuButton.addEventListener('click', () => {
  requestSinglePlayerMode();
});

if (optionsButton) {
  optionsButton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (optionsMenu.hidden || optionsMenu.classList.contains('options-menu--closing')) {
      hideStatusScoreBreakdown();
      showAnimatedElement(optionsMenu, 'options-menu--closing');
    } else {
      hideOptionsMenu();
    }
  });
}

headerCopyInviteButton?.addEventListener('click', () => {
  const { currentGameId } = getClientState();
  if (!currentGameId) return;
  void copyInviteLink(currentGameId);
});

menuCopyInviteButton.addEventListener('click', () => {
  const { currentGameId } = getClientState();
  if (!currentGameId) return;
  hideOptionsMenu();
  void copyInviteLink(currentGameId);
});

gamesMenuButton.addEventListener('click', () => {
  hideOptionsMenu();
  openGamesModal();
});

changeDisplayNameMenuButton.addEventListener('click', () => {
  hideOptionsMenu();
  const activeClaim = currentStoredClaim();
  if (!activeClaim) return;
  openNameModal(activeClaim.playerName);
});

newGameMenuButton.addEventListener('click', () => {
  hideOptionsMenu();
  void createNewGame();
});

notificationMenuButton.addEventListener('click', () => {
  void enableTurnNotifications();
});

darkModeMenuButton.addEventListener('click', () => {
  setDarkModePreference(!darkModeEnabled);
});

nameModalCancelButton.addEventListener('click', hideNameModal);
nameModalSaveButton.addEventListener('click', () => {
  void submitNameModal();
});
nameModalInput.addEventListener('input', syncNameModalUi);
nameModalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void submitNameModal();
  }
});
nameModal.addEventListener('click', (event) => {
  if (event.target === nameModal) {
    hideNameModal();
  }
});
gamesModalCloseButton.addEventListener('click', hideGamesModal);
gamesModal.addEventListener('click', (event) => {
  if (event.target === gamesModal) {
    hideGamesModal();
  }
});
gameDeleteConfirmCancelButton.addEventListener('click', hideGameDeleteConfirmModal);
gameDeleteConfirmModal.addEventListener('click', (event) => {
  if (event.target === gameDeleteConfirmModal) {
    hideGameDeleteConfirmModal();
  }
});
gameDeleteConfirmButton.addEventListener('click', () => {
  if (!pendingModalDeleteGameId) return;
  void deleteSavedGame(pendingModalDeleteGameId);
});
blankTileCancelButton.addEventListener('click', cancelBlankTileChoice);
blankTileModal.addEventListener('click', (event) => {
  if (event.target === blankTileModal) {
    cancelBlankTileChoice();
  }
});
tileBagCard.addEventListener('click', (event) => {
  openTileBagModal();
  event.stopPropagation();
});
tileBagCloseButton.addEventListener('click', hideTileBagModal);
tileBagModal.addEventListener('click', (event) => {
  if (event.target === tileBagModal) {
    hideTileBagModal();
  }
});

statusScoreCard.addEventListener('click', (event) => {
  if (statusScoreBreakdown.contains(event.target as Node)) return;
  toggleStatusScoreBreakdown();
  event.stopPropagation();
});
statusScoreCard.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleStatusScoreBreakdown();
});
statusScoreLatestCard.addEventListener('click', (event) => {
  if (statusScoreBreakdown.contains(event.target as Node)) return;
  toggleStatusScoreBreakdown();
  event.stopPropagation();
});
statusScoreLatestCard.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  toggleStatusScoreBreakdown();
});

document.addEventListener('click', (event) => {
  if (!statusScoreBreakdown.hidden) {
    const target = event.target;
    if (
      target instanceof Node &&
      !statusScoreCard.contains(target) &&
      !statusScoreLatestCard.contains(target)
    ) {
      hideStatusScoreBreakdown();
    }
  }
  if (!optionsButton || optionsMenu.hidden) return;
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (optionsMenu.contains(target) || optionsButton.contains(target)) return;
  hideOptionsMenu();
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !blankTileModal.hidden) {
    cancelBlankTileChoice();
    return;
  }
  if (event.key === 'Escape' && !tileBagModal.hidden) {
    hideTileBagModal();
    return;
  }
  if (event.key === 'Escape' && !gameDeleteConfirmModal.hidden) {
    hideGameDeleteConfirmModal();
    return;
  }
  if (event.key === 'Escape' && !gamesModal.hidden) {
    hideGamesModal();
    return;
  }
  if (event.key === 'Escape' && !nameModal.hidden) {
    hideNameModal();
    return;
  }
  if (event.key === 'Escape' && !optionsMenu.hidden) {
    hideOptionsMenu();
    return;
  }
  if (event.key === 'Escape' && !statusScoreBreakdown.hidden) {
    hideStatusScoreBreakdown();
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
syncTileBagUi(null);
syncAccountUi();
if (initialGameId) {
  void openGame(initialGameId);
} else {
  void createNewGame();
}

function syncGameState(state: GameState): void {
  clearMovePreview();
  const previousState = latestGameState;
  latestGameState = state;
  currentBoardLayout = state.boardLayout;
  currentWordLengthRule = state.wordLengthRule;
  currentAreaBonusRule = state.areaBonusRule;
  currentGameSummary = summaryFromState(state);
  if (currentGameSummary && shouldRefreshStatusFromState()) {
    setStatus(selectedGameStatusText(currentGameSummary));
  }
  if (getClientState().currentGameId !== state.gameId) {
    hydrateClientState({ currentGameId: state.gameId });
  }
  renderBoardBackground(state.boardLayout);
  selectedExchangeIds = new Set();
  const player = currentPlayer(state);
  if (player) {
    setCurrentPlayerId(player.id);
    syncStoredClaimFromState(state, player);
  } else {
    clearCurrentPlayerId();
  }
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
        tile.dragAbortCallback = makeDraggable(
          tile,
          hand,
          board,
          scheduleMovePreview,
          handleTileDrop,
          toggleRackSelection,
        );
      } else {
        tile.disableDrag?.();
      }
      hand.addTile(tile);
    }
  }

  updateStatusFromState(state, player, previousState);
  void notifyTurnFromState(state, player);
  renderAccountGames();
  renderMobilePlayersBar();
  updateActionButtons();
}

function shouldRefreshStatusFromState(): boolean {
  const currentStatus = statusNoticeValue.textContent?.trim() ?? '';
  return currentStatus.length === 0 || [
    'Connected. Syncing game state...',
    'Connection error. Reconnecting.',
    'Disconnected. Reconnecting.',
    'Loading game...',
  ].includes(currentStatus);
}

function clearCurrentGameState(message: string, clearSelection = false): void {
  hideNameModal();
  hideGamesModal();
  hideBlankTileModal();
  hideTileBagModal();
  hideOptionsMenu();
  clearMovePreview();
  stopScoreAnimation();
  hideScoreGain();
  latestGameState = null;
  currentGameSummary = null;
  currentBoardLayout = 'scrabble';
  currentWordLengthRule = 'standard';
  currentAreaBonusRule = 'none';
  renderBoardBackground(currentBoardLayout);
  selectedExchangeIds = new Set();
  clearCurrentPlayerId();
  if (clearSelection) {
    hydrateClientState({ currentClaimToken: null, currentGameId: null, currentPlayerId: null });
  }
  if (!getClientState().currentGameId) {
    disconnectSocket();
  }
  app.classList.remove('app--waiting-turn');
  app.classList.remove('app--game-ended');
  syncGameOverPrompt(false);
  board.clearTiles();
  hand.clearTiles();
  renderTurnHistory([]);
  syncTileBagUi(null);
  statusScoreValue.textContent = '0';
  statusScoreMeta.textContent = getClientState().currentGameId ? 'Waiting for game state' : 'Create or open an invite game';
  resetStatusScoreLatest();
  renderAccountGames();
  renderMobilePlayersBar();
  setStatus(message);
  updateActionButtons();
}

function createTile(tileState: TileState, tileHolder: Hand | Board, played: boolean): Tile | null {
  if (!tileState.letter && !tileState.isBlank) return null;
  return new Tile(tileState.col, tileState.row, tileHolder, false, {
    id: tileState.id,
    letter: tileState.letter,
    isBlank: tileState.isBlank,
    played,
  });
}

function handleTileDrop(tile: Tile, tileHolder: Hand | Board): boolean {
  if (!tile.isBlank) return false;
  if (tileHolder === hand) {
    tile.setBlank();
    hideBlankTileModal();
    return false;
  }
  if (tileHolder === board && tile.letter === null) {
    openBlankTileModal(tile);
    return true;
  }
  return false;
}

function openBlankTileModal(tile: Tile): void {
  pendingBlankTile = tile;
  showModal(blankTileModal);
  window.requestAnimationFrame(() => {
    const firstChoice = blankTileGrid.querySelector('button');
    firstChoice?.focus();
  });
}

function hideBlankTileModal(): void {
  hideModal(blankTileModal);
  pendingBlankTile = null;
}

function chooseBlankTileLetter(letter: Letter): void {
  if (!pendingBlankTile) return;
  pendingBlankTile.setLetter(letter, true);
  pendingBlankTile.animatePlacement();
  hideBlankTileModal();
  scheduleMovePreview();
}

function cancelBlankTileChoice(): void {
  const tile = pendingBlankTile;
  hideBlankTileModal();
  if (!tile) return;
  board.removeTile(tile);
  hand.restoreTiles([tile]);
  scheduleMovePreview();
}

type TileBagCounts = {
  letters: Record<Letter, number>;
  blanks: number;
  total: number;
};

function openTileBagModal(): void {
  renderTileBagModal(latestGameState);
  showModal(tileBagModal);
  window.requestAnimationFrame(() => {
    tileBagCloseButton.focus();
  });
}

function hideTileBagModal(): void {
  hideModal(tileBagModal);
}

function syncTileBagUi(state: GameState | null): void {
  const counts = computeTileBagCounts(state);
  tileBagValue.textContent = String(counts.total);
  tileBagCard.disabled = state === null;
  tileBagCard.setAttribute(
    'aria-label',
    state ? `Tile bag. ${counts.total} tiles left.` : 'Tile bag. No game loaded.',
  );
  if (state && !tileBagModal.hidden) {
    renderTileBagModal(state);
  }
}

function renderTileBagModal(state: GameState | null): void {
  const counts = computeTileBagCounts(state);
  tileBagCount.textContent = String(counts.total);
  const tiles = (Object.keys(LETTER_VALUES) as Letter[]).map((letter) => {
    return renderTileBagChoice(letter, counts.letters[letter]);
  });
  tiles.push(renderTileBagChoice(null, counts.blanks));
  tileBagGrid.replaceChildren(...tiles);
}

function renderTileBagChoice(letter: Letter | null, count: number): HTMLDivElement {
  const choice = document.createElement('div');
  choice.classList.add('tile-bag-choice');
  choice.setAttribute('aria-label', `${letter ?? 'blank'} tile, ${count} left`);
  if (count <= 0) {
    choice.classList.add('tile-bag-choice--empty');
  }

  const countBadge = document.createElement('span');
  countBadge.classList.add('tile-bag-choice__count');
  countBadge.textContent = `x${count}`;

  const label = document.createElement('span');
  label.classList.add('tile-bag-choice__letter');
  label.textContent = letter ?? '?';

  choice.append(countBadge, label);
  return choice;
}

function computeTileBagCounts(state: GameState | null): TileBagCounts {
  const letters = { ...TILE_DISTRIBUTION };
  let blanks = DEFAULT_BLANK_TILE_COUNT;

  if (!state) {
    for (const letter of Object.keys(letters) as Letter[]) {
      letters[letter] = 0;
    }
    return { letters, blanks: 0, total: 0 };
  }

  for (const tile of state.board.tiles) {
    subtractTileFromBagCounts(tile, letters, () => {
      blanks = Math.max(0, blanks - 1);
    });
  }
  for (const player of state.players) {
    for (const tile of player.rack.tiles) {
      subtractTileFromBagCounts(tile, letters, () => {
        blanks = Math.max(0, blanks - 1);
      });
    }
  }

  const total = (Object.keys(letters) as Letter[]).reduce((sum, letter) => sum + letters[letter], blanks);
  return { letters, blanks, total };
}

function subtractTileFromBagCounts(
  tile: TileState,
  letters: Record<Letter, number>,
  subtractBlank: () => void,
): void {
  if (tile.isBlank) {
    subtractBlank();
    return;
  }
  if (tile.letter) {
    letters[tile.letter] = Math.max(0, letters[tile.letter] - 1);
  }
}

function currentPlayer(state: GameState): PlayerPublicState | null {
  const playerId = currentStoredClaim()?.playerId ?? getClientState().currentPlayerId;
  if (!playerId) return null;
  return state.players.find((player) => player.id === playerId) ?? null;
}

function updateStatusFromState(
  state: GameState,
  player: PlayerPublicState | null,
  previousState: GameState | null,
): void {
  const isMyTurn = state.currentPlayerId === player?.id;
  syncScoreFeedback(previousState, state);
  syncStatusScoreLatest(state);
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
  syncTileBagUi(state);
  if (!statusScoreBreakdown.hidden) {
    renderStatusScoreBreakdown(state.turnHistory);
  }
}

async function notifyTurnFromState(
  state: GameState,
  player: PlayerPublicState | null,
): Promise<void> {
  if (!player) {
    await clearTurnNotifications();
    return;
  }

  await notifyCurrentPlayerTurn({
    currentPlayerId: state.currentPlayerId,
    localPlayerId: player.id,
    gameId: state.gameId,
    turnId: state.turnHistory[0]?.turn ?? 0,
    gameEnded: state.gameEnded,
    title: 'Your turn in Adjacency',
    body: 'Your rack is ready.',
    url: `${window.location.origin}${window.location.pathname}?game=${encodeURIComponent(state.gameId)}`,
  });
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
    showScoreGain(scoreGain, state);
    return;
  }

  stopScoreAnimation();
  hideScoreGain();
  statusScoreValue.textContent = state.teamScore.toString();
}

function syncStatusScoreLatest(state: GameState): void {
  const latestPlay = latestPlayHistoryEntry(state);
  statusScoreCard.classList.toggle('status-score--has-latest', latestPlay !== null);
  statusScoreCard.classList.toggle(
    'status-score--has-square',
    Boolean(latestPlay && (latestPlay.rectangleBonuses ?? []).some((bonus) => bonus.width === bonus.height)),
  );
  statusScoreLatestCard.classList.toggle('status-score-latest--has-latest', latestPlay !== null);
  statusScoreLatestCard.classList.toggle(
    'status-score-latest--has-square',
    Boolean(latestPlay && (latestPlay.rectangleBonuses ?? []).length > 0),
  );
  statusScoreCard.setAttribute(
    'aria-label',
    latestPlay
      ? `Team score ${state.teamScore}. Latest play ${latestPlaySummaryLabel(latestPlay)}. Tap for turn history.`
      : `Team score ${state.teamScore}. No words played yet.`,
  );
  statusScoreLatestCard.setAttribute(
    'aria-label',
    latestPlay
      ? `Latest play ${latestPlaySummaryLabel(latestPlay)}. Tap for turn history.`
      : 'No words played yet.',
  );

  if (!latestPlay) {
    resetStatusScoreLatest();
    return;
  }

  const rectangleBonuses = latestPlay.rectangleBonuses ?? [];
  setStatusScoreLatestText(latestPlayFormula(latestPlay));

  const squareBonus = rectangleBonuses.find((bonus) => bonus.width === bonus.height) ?? rectangleBonuses[0];
  statusScoreSquareIndicator.hidden = !squareBonus;
  statusScoreSquareIndicator.textContent = squareBonus ? `+${squareBonus.score}` : '';
  syncStatusScoreLatestTicker();
}

function resetStatusScoreLatest(): void {
  setStatusScoreLatestText('No words yet');
  statusScoreSquareIndicator.hidden = true;
  syncStatusScoreLatestTicker();
  statusScoreCard.classList.remove('status-score--has-latest', 'status-score--has-square', 'status-score--breakdown-open');
  statusScoreLatestCard.classList.remove('status-score-latest--has-latest', 'status-score-latest--has-square');
  statusScoreCard.setAttribute('aria-expanded', 'false');
  statusScoreLatestCard.setAttribute('aria-expanded', 'false');
  statusScoreLatestCard.setAttribute('aria-label', 'No words played yet.');
  statusScoreBreakdown.hidden = true;
  statusScoreBreakdown.replaceChildren();
}

function setStatusScoreLatestText(text: string): void {
  statusScoreLatestText.textContent = text;
  statusScoreLatestTickerCopy.textContent = text;
}

function syncStatusScoreLatestTicker(): void {
  statusScoreLatest.classList.remove('status-score-latest__text--ticker');
  statusScoreLatestTrack.style.removeProperty('--latest-ticker-shift');
  statusScoreLatestTrack.style.removeProperty('--latest-ticker-duration');

  window.requestAnimationFrame(() => {
    const viewportWidth = statusScoreLatest.clientWidth;
    const textWidth = statusScoreLatestText.scrollWidth;
    if (viewportWidth <= 0 || textWidth <= viewportWidth + 2) return;

    const gap = 28;
    const shift = textWidth + gap;
    const duration = Math.max(5.5, Math.min(12, shift / 24));
    statusScoreLatestTrack.style.setProperty('--latest-ticker-shift', `${shift}px`);
    statusScoreLatestTrack.style.setProperty('--latest-ticker-duration', `${duration}s`);
    statusScoreLatest.classList.add('status-score-latest__text--ticker');
  });
}

function latestPlayHistoryEntry(state: GameState): TurnHistoryEntryState | null {
  return state.turnHistory.find((entry) => entry.kind === 'play' && entry.words.length > 0) ?? null;
}

function latestPlayFormula(entry: TurnHistoryEntryState): string {
  const words = entry.words.map((wordScore) => wordScore.word).join(' + ');
  const wordScore = entry.words.reduce((total, wordScore) => total + wordScore.score, 0);
  return `${words} = ${wordScore}`;
}

function latestPlaySummaryLabel(entry: TurnHistoryEntryState): string {
  const rectangleBonuses = entry.rectangleBonuses ?? [];
  const words = `${latestPlayFormula(entry)} (${entry.words.map((wordScore) => wordKindLabel(wordScore.kind)).join(', ')})`;
  const area = rectangleBonuses.length > 0
    ? `, ${rectangleBonuses.length} area bonus${rectangleBonuses.length === 1 ? '' : 'es'}`
    : '';
  return `${words}${area}`;
}

function toggleStatusScoreBreakdown(): void {
  if (!latestGameState) return;
  if (optionsMenuIsOpen()) {
    hideStatusScoreBreakdown();
    return;
  }
  if (statusScoreBreakdown.hidden) {
    renderStatusScoreBreakdown(latestGameState.turnHistory);
    statusScoreBreakdown.hidden = false;
    statusScoreCard.classList.add('status-score--breakdown-open');
    statusScoreCard.setAttribute('aria-expanded', 'true');
    statusScoreLatestCard.setAttribute('aria-expanded', 'true');
  } else {
    hideStatusScoreBreakdown();
  }
}

function hideStatusScoreBreakdown(): void {
  statusScoreBreakdown.hidden = true;
  statusScoreCard.classList.remove('status-score--breakdown-open');
  statusScoreCard.setAttribute('aria-expanded', 'false');
  statusScoreLatestCard.setAttribute('aria-expanded', 'false');
}

function optionsMenuIsOpen(): boolean {
  return typeof optionsMenu !== 'undefined' &&
    !optionsMenu.hidden &&
    !optionsMenu.classList.contains('options-menu--closing');
}

function renderStatusScoreBreakdown(entries: TurnHistoryEntryState[]): void {
  const panel = document.createElement('section');
  panel.classList.add('history-panel', 'history-panel--score-popover');

  const header = document.createElement('div');
  header.classList.add('history-panel__header');

  const title = document.createElement('h2');
  title.textContent = 'Turn history';

  const count = document.createElement('span');
  count.classList.add('history-panel__count');

  const list = document.createElement('div');
  list.classList.add('history-list');

  header.append(title, count);
  panel.append(header, list);
  renderTurnHistoryInto(entries, count, list);
  statusScoreBreakdown.replaceChildren(panel);
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

function showScoreGain(scoreGain: number, state: GameState): void {
  if (scoreFeedbackTimerId !== null) {
    window.clearTimeout(scoreFeedbackTimerId);
    scoreFeedbackTimerId = null;
  }

  showScoreBurst(scoreGain, state);
  statusScoreCard.classList.remove('status-score--pulse');
  boardScroller.classList.remove('board-scroller--score-feedback');
  void statusScoreCard.offsetWidth;
  statusScoreCard.classList.add('status-score--pulse');
  boardScroller.classList.add('board-scroller--score-feedback');

  scoreFeedbackTimerId = window.setTimeout(() => {
    statusScoreCard.classList.remove('status-score--pulse');
    boardScroller.classList.remove('board-scroller--score-feedback');
    scoreFeedbackTimerId = null;
  }, 1100);
}

function showScoreBurst(scoreGain: number, state: GameState): void {
  const startPoint = scoreBurstStartPoint(state);
  const scoreRect = statusScoreCard.getBoundingClientRect();
  const targetPoint = {
    x: scoreRect.left + scoreRect.width / 2,
    y: scoreRect.top + scoreRect.height / 2,
  };

  document.querySelectorAll('.score-burst').forEach((element) => element.remove());

  const burst = document.createElement('div');
  burst.classList.add('score-burst');
  burst.textContent = `+${scoreGain}`;
  burst.style.left = `${startPoint.x}px`;
  burst.style.top = `${startPoint.y}px`;
  burst.style.setProperty('--score-burst-dx', `${targetPoint.x - startPoint.x}px`);
  burst.style.setProperty('--score-burst-dy', `${targetPoint.y - startPoint.y}px`);
  document.body.appendChild(burst);

  burst.addEventListener('animationend', () => {
    burst.remove();
  }, { once: true });
}

function scoreBurstStartPoint(state: GameState): { x: number; y: number } {
  const latestPlay = latestPlayHistoryEntry(state);
  const boardRect = board.el.getBoundingClientRect();
  const scrollerRect = boardScroller.getBoundingClientRect();
  const fallback = {
    x: scrollerRect.left + scrollerRect.width / 2,
    y: scrollerRect.top + scrollerRect.height / 2,
  };
  if (!latestPlay || latestPlay.words.length === 0 || boardRect.width <= 0 || board.el.offsetWidth <= 0) {
    return fallback;
  }

  const anchor = latestPlayScoreAnchor(latestPlay);
  if (!anchor) return fallback;

  const anchorCoords = gridCoordsToTileHolderCoords(anchor.col, anchor.row, board);
  const scale = boardRect.width / board.el.offsetWidth;
  const rawX = boardRect.left + (anchorCoords.x + TILE_SIZE) * scale;
  const rawY = boardRect.top + (anchorCoords.y + TILE_SIZE) * scale;
  const padding = 18;
  return {
    x: Math.max(scrollerRect.left + padding, Math.min(scrollerRect.right - padding, rawX)),
    y: Math.max(scrollerRect.top + padding, Math.min(scrollerRect.bottom - padding, rawY)),
  };
}

function latestPlayScoreAnchor(entry: TurnHistoryEntryState): { col: number; row: number } | null {
  const cells = entry.words.flatMap((word) => word.letters.map((letter) => ({
    col: letter.col,
    row: letter.row,
  })));
  if (cells.length === 0) return null;

  if (entry.words.length > 1) {
    const intersections = turnWordIntersections(entry.words);
    const tIntersection = intersections.find((cell) => (
      entry.words.some((word) => turnWordContainsCell(word, cell) && !turnWordCellIsEndpoint(word, cell))
    ));
    if (tIntersection) {
      const verticalWord = entry.words
        .filter((word) => turnWordOrientation(word) === 'vertical' && turnWordContainsCell(word, tIntersection))
        .sort((a, b) => bottomRightCell(b.letters).row - bottomRightCell(a.letters).row)[0];
      if (verticalWord) return bottomRightCell(verticalWord.letters);
    }

    if (intersections.length > 0) return bottomRightCell(intersections);
  }

  return bottomRightCell(cells);
}

function turnWordIntersections(words: TurnWordScoreState[]): { col: number; row: number }[] {
  const counts = new Map<string, { col: number; row: number }>();
  const seenByWord = words.map((word) => new Set(word.letters.map((cell) => `${cell.col}:${cell.row}`)));
  for (const word of words) {
    for (const cell of word.letters) {
      const key = `${cell.col}:${cell.row}`;
      const count = seenByWord.filter((seen) => seen.has(key)).length;
      if (count > 1) {
        counts.set(key, { col: cell.col, row: cell.row });
      }
    }
  }
  return [...counts.values()];
}

function turnWordOrientation(word: TurnWordScoreState): 'horizontal' | 'vertical' | 'single' {
  const cols = new Set(word.letters.map((cell) => cell.col));
  const rows = new Set(word.letters.map((cell) => cell.row));
  if (cols.size === 1 && rows.size > 1) return 'vertical';
  if (rows.size === 1 && cols.size > 1) return 'horizontal';
  return 'single';
}

function turnWordContainsCell(word: TurnWordScoreState, cell: { col: number; row: number }): boolean {
  return word.letters.some((candidate) => candidate.col === cell.col && candidate.row === cell.row);
}

function turnWordCellIsEndpoint(word: TurnWordScoreState, cell: { col: number; row: number }): boolean {
  const first = word.letters[0];
  const last = word.letters[word.letters.length - 1];
  if (!first || !last) return false;
  return (
    (first.col === cell.col && first.row === cell.row) ||
    (last.col === cell.col && last.row === cell.row)
  );
}

function hideScoreGain(): void {
  if (scoreFeedbackTimerId !== null) {
    window.clearTimeout(scoreFeedbackTimerId);
    scoreFeedbackTimerId = null;
  }
  statusScoreCard.classList.remove('status-score--pulse');
  statusScoreDelta.classList.remove('status-score__delta--visible');
  boardScroller.classList.remove('board-scroller--score-feedback');
  document.querySelectorAll('.score-burst').forEach((element) => element.remove());
  statusScoreDelta.textContent = '';
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
    setActionButtonLabel(exchangeButton, selectedCount > 0 ? `exchange ${selectedCount}` : 'exchange');
    exchangeButton.disabled = baseDisabled || selectedCount === 0;
  }

  updateHeaderActions();
  updateOptionsMenuState(player);
}

function setActionButtonLabel(button: HTMLButtonElement, label: string): void {
  const text = button.querySelector('.action-button__text');
  if (text) {
    text.textContent = label;
    button.title = label;
    return;
  }
  button.textContent = label;
}

function toggleRackSelection(tile: Tile): void {
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

  const badgeWord = preview.words.length > 1
    ? preview.words.find((word) => word.kind === 'fresh') ?? preview.words[0]
    : preview.words[0];
  const badgeScore = preview.words.length > 1
    ? preview.totalScore
    : (preview.rectangleBonuses ?? []).length > 0
      ? preview.totalScore
      : badgeWord.score;

  const badge = (() => {
    const badge = document.createElement('div');
    badge.classList.add('preview-score-badge');
    if (preview.valid) {
      badge.classList.add('preview-score-badge--valid');
    }
    badge.textContent = `${badgeScore}`;
    const anchor = previewScoreAnchor(preview) ?? badgeWord.anchor;
    const anchorCoords = gridCoordsToTileHolderCoords(anchor.col, anchor.row, board);
    const badgeSize = 20;
    const cornerX = anchorCoords.x + TILE_SIZE;
    const cornerY = anchorCoords.y + TILE_SIZE;
    const previewWidth = previewLayer.clientWidth || board.el.clientWidth;
    const previewHeight = previewLayer.clientHeight || board.el.clientHeight;
    badge.style.left = `${Math.max(badgeSize / 2, Math.min(previewWidth - badgeSize / 2, cornerX))}px`;
    badge.style.top = `${Math.max(badgeSize / 2, Math.min(previewHeight - badgeSize / 2, cornerY))}px`;
    return badge;
  })();

  previewLayer.replaceChildren(badge);
}

function previewScoreAnchor(preview: MovePreviewState): MovePreviewState['words'][number]['anchor'] | null {
  if (preview.words.length === 0) return null;
  if (preview.words.length === 1) return bottomRightCell(preview.words[0].cells);

  const intersections = previewWordIntersections(preview.words);
  const tIntersection = intersections.find((cell) => (
    preview.words.some((word) => wordContainsCell(word, cell) && !wordCellIsEndpoint(word, cell))
  ));
  if (tIntersection) {
    const verticalWord = preview.words
      .filter((word) => previewWordOrientation(word) === 'vertical' && wordContainsCell(word, tIntersection))
      .sort((a, b) => bottomRightCell(b.cells).row - bottomRightCell(a.cells).row)[0];
    if (verticalWord) return bottomRightCell(verticalWord.cells);
  }

  return bottomRightCell(preview.words.flatMap((word) => word.cells));
}

function previewWordIntersections(words: MovePreviewState['words']): MovePreviewState['words'][number]['cells'] {
  const counts = new Map<string, MovePreviewState['words'][number]['cells'][number]>();
  const seenByWord = words.map((word) => new Set(word.cells.map((cell) => `${cell.col}:${cell.row}`)));
  for (const word of words) {
    for (const cell of word.cells) {
      const key = `${cell.col}:${cell.row}`;
      const count = seenByWord.filter((seen) => seen.has(key)).length;
      if (count > 1) {
        counts.set(key, cell);
      }
    }
  }
  return [...counts.values()];
}

function previewWordOrientation(word: MovePreviewState['words'][number]): 'horizontal' | 'vertical' | 'single' {
  const cols = new Set(word.cells.map((cell) => cell.col));
  const rows = new Set(word.cells.map((cell) => cell.row));
  if (cols.size === 1 && rows.size > 1) return 'vertical';
  if (rows.size === 1 && cols.size > 1) return 'horizontal';
  return 'single';
}

function wordContainsCell(
  word: MovePreviewState['words'][number],
  cell: MovePreviewState['words'][number]['cells'][number],
): boolean {
  return word.cells.some((candidate) => candidate.col === cell.col && candidate.row === cell.row);
}

function wordCellIsEndpoint(
  word: MovePreviewState['words'][number],
  cell: MovePreviewState['words'][number]['cells'][number],
): boolean {
  const first = word.cells[0];
  const last = word.cells[word.cells.length - 1];
  return (
    (first.col === cell.col && first.row === cell.row) ||
    (last.col === cell.col && last.row === cell.row)
  );
}

function bottomRightCell<T extends { col: number; row: number }>(cells: T[]): T {
  return cells.reduce((anchor, cell) => {
    if (cell.row > anchor.row) return cell;
    if (cell.row === anchor.row && cell.col > anchor.col) return cell;
    return anchor;
  });
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
  const { currentGameId } = getClientState();

  accountCurrentValue.textContent = currentGameId
    ? `Game ${shortGameId(currentGameId)}`
    : 'No game selected';
  accountCurrentValue.title = currentDisplayedSummary()?.gameId ?? currentGameId ?? '';

  renderAccountGames();
  renderMobilePlayersBar();
  if (gamesModal && !gamesModal.hidden) {
    renderGamesModal();
  }
  syncNameModalUi();
  updateHeaderActions();
}

function renderAccountGames(): void {
  const { claims, currentGameId, currentPlayerId } = getClientState();
  const displaySummary = currentDisplayedSummary();
  if (currentGameId && displaySummary) {
    const activePlayerId = currentStoredClaim()?.playerId ?? currentPlayerId;
    const chips = displaySummary.players.map((player) => {
      const isSelf = Boolean(player.id && activePlayerId === player.id);
      const chip = document.createElement('div');
      chip.classList.add('room-player');
      if (isSelf) {
        chip.classList.add('room-player--self');
      }

      const label = document.createElement('span');
      label.classList.add('room-player__label');
      label.textContent = `Seat ${player.seat}`;

      const value = document.createElement('strong');
      value.classList.add('room-player__value');
      value.textContent = player.name ?? (displaySummary.singlePlayer ? 'Solo only' : 'Waiting');

      const stateText = document.createElement('span');
      stateText.classList.add('room-player__state');
      stateText.textContent = player.id
        ? (player.connected ? 'connected' : 'away')
        : (displaySummary.singlePlayer ? 'closed' : 'open');

      chip.append(label, value, stateText);
      return chip;
    });

    accountGames.replaceChildren(...chips);
    return;
  }

  if (claims.length === 0) {
    accountGames.replaceChildren(renderEmptyGameChip('Create a game to get a shareable invite link'));
    return;
  }

  const chips = claims.map((claim, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.classList.add('room-player');
    chip.style.cursor = 'pointer';
    chip.style.textAlign = 'left';
    chip.disabled = accountRequestInFlight;
    if (currentGameId === claim.gameId) {
      chip.classList.add('room-player--self');
      chip.setAttribute('aria-pressed', 'true');
    } else {
      chip.setAttribute('aria-pressed', 'false');
    }

    const label = document.createElement('span');
    label.classList.add('room-player__label');
    label.textContent = index === 0 ? 'Latest game' : `Game ${index + 1}`;

    const value = document.createElement('strong');
    value.classList.add('room-player__value');
    value.textContent = claim.opponentName ?? `Game ${shortGameId(claim.gameId)}`;

    const stateText = document.createElement('span');
    stateText.classList.add('room-player__state');
    stateText.textContent = `seat ${claim.seat}`;

    chip.append(label, value, stateText);
    chip.addEventListener('click', () => {
      void openGame(claim.gameId);
    });
    return chip;
  });

  accountGames.replaceChildren(...chips);
}

function renderMobilePlayersBar(): void {
  const summary = currentDisplayedSummary();
  if (!summary) {
    mobilePlayersValue.textContent = 'Player 1 and Player 2';
    return;
  }

  if (summary.singlePlayer) {
    const soloPlayer = summary.players.find((player) => player.id !== null) ?? summary.players[0];
    mobilePlayersValue.textContent = `${soloPlayer.name ?? `Player ${soloPlayer.seat}`} and nobody`;
    return;
  }

  if (summary.players.some((player) => player.id === null)) {
    mobilePlayersValue.textContent = 'Waiting for another player...';
    return;
  }

  const playerNames = summary.players.map((player) => (
    player.name ?? `Player ${player.seat}`
  ));
  mobilePlayersValue.textContent = playerNames.join(' and ');
}

function renderEmptyGameChip(message: string): HTMLDivElement {
  const chip = document.createElement('div');
  chip.classList.add('room-player', 'room-player--empty');

  const label = document.createElement('span');
  label.classList.add('room-player__label');
  label.textContent = 'Invite games';

  const value = document.createElement('strong');
  value.classList.add('room-player__value');
  value.textContent = message;

  chip.append(label, value);
  return chip;
}

function currentDisplayedSummary(): GameSummary | null {
  if (latestGameState && getClientState().currentGameId === gameIdFromState(latestGameState)) {
    return summaryFromState(latestGameState);
  }
  return currentGameSummary;
}

function summaryFromState(state: GameState): GameSummary {
  return {
    gameId: state.gameId,
    players: [1, 2].map((seat) => {
      const player = state.players.find((candidate) => candidate.seat === seat) ?? null;
      return {
        id: player?.id ?? null,
        name: player?.name ?? null,
        seat,
        connected: player?.connected ?? false,
      };
    }),
    currentPlayerId: state.currentPlayerId,
    gameEnded: state.gameEnded,
    singlePlayer: state.singlePlayer,
    canChangeSinglePlayer: state.canChangeSinglePlayer,
    wordLengthRule: state.wordLengthRule,
    canChangeWordLengthRule: state.canChangeWordLengthRule,
    areaBonusRule: state.areaBonusRule,
    canChangeAreaBonusRule: state.canChangeAreaBonusRule,
    teamScore: state.teamScore,
    updatedAt: new Date().toISOString(),
  };
}

function selectedGameStatusText(summary: GameSummary): string {
  const { currentClaimToken } = getClientState();
  const currentPlayers = summary.players.filter((player) => player.id !== null);
  if (summary.gameEnded) return 'Finished';
  if (summary.singlePlayer) {
    if (!currentClaimToken) return 'Spectating';
    if (!socketIsOpen()) return 'Reconnecting';
    return 'Solo';
  }
  if (currentPlayers.length < 2) return currentClaimToken ? 'Waiting for partner' : 'Open seat available';
  if (!currentClaimToken) return 'Spectating';
  if (!socketIsOpen()) return 'Reconnecting';
  return 'Connected';
}

function renderTurnHistory(entries: TurnHistoryEntryState[]): void {
  renderTurnHistoryInto(entries, historySummary, historyList);
}

function renderTurnHistoryInto(
  entries: TurnHistoryEntryState[],
  summaryElement: HTMLElement,
  listElement: HTMLElement,
): void {
  summaryElement.textContent = entries.length === 0
    ? 'No turns yet'
    : `${entries.length} turn${entries.length === 1 ? '' : 's'}`;

  if (entries.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.classList.add('history-empty');
    emptyState.textContent = 'Played turns will show up here with per-word scores.';
    listElement.replaceChildren(emptyState);
    return;
  }

  listElement.replaceChildren(...entries.map((entry) => renderTurnHistoryEntry(entry)));
}

function renderTurnHistoryEntry(entry: TurnHistoryEntryState): HTMLElement {
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

  const rectangleBonuses = entry.rectangleBonuses ?? [];
  if (rectangleBonuses.length > 0) {
    const bonusRows = document.createElement('div');
    bonusRows.classList.add('history-entry__area-bonuses');
    for (const rectangleBonus of rectangleBonuses) {
      bonusRows.appendChild(renderHistoryRectangleBonus(rectangleBonus));
    }
    card.appendChild(bonusRows);
  }

  return card;
}

function renderHistoryRectangleBonus(
  bonus: TurnHistoryEntryState['rectangleBonuses'][number],
): HTMLDivElement {
  const row = document.createElement('div');
  row.classList.add('history-entry__area-bonus');

  const label = document.createElement('span');
  label.classList.add('history-entry__area-bonus-label');
  label.textContent = bonus.width === bonus.height
    ? `Closed square ${bonus.width}x${bonus.height}`
    : `Closed rectangle ${bonus.width}x${bonus.height}`;

  const score = document.createElement('span');
  score.classList.add('history-entry__area-bonus-score');
  score.textContent = `+${bonus.score} pt${bonus.score === 1 ? '' : 's'}`;

  const detail = document.createElement('span');
  detail.classList.add('history-entry__area-bonus-detail');
  detail.textContent = `area ${bonus.area}`;

  row.append(label, detail, score);
  return row;
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

function renderHistoryWordBreakdown(wordScore: TurnWordScoreState, isStatic = false): HTMLDivElement {
  const breakdown = document.createElement('div');
  breakdown.classList.add('history-word-breakdown');
  if (isStatic) {
    breakdown.classList.add('history-word-breakdown--static');
  }

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

function openNameModal(initialName: string): void {
  nameModalInput.value = initialName;
  syncNameModalUi();
  showModal(nameModal);
  window.requestAnimationFrame(() => {
    nameModalInput.focus();
    nameModalInput.select();
  });
}

function hideNameModal(): void {
  hideModal(nameModal);
}

function openGamesModal(): void {
  renderGamesModal();
  showModal(gamesModal);
}

function hideGamesModal(): void {
  if (gamesModal) {
    hideGameDeleteConfirmModal();
    hideModal(gamesModal);
  }
}

function openGameDeleteConfirmModal(claim: StoredClaim): void {
  pendingModalDeleteGameId = claim.gameId;
  const title = claim.opponentName ?? `Game ${shortGameId(claim.gameId)}`;
  gameDeleteConfirmTitle.textContent = 'Remove game?';
  gameDeleteConfirmText.textContent = `Remove ${title} from saved games on this device?`;
  showModal(gameDeleteConfirmModal);
  window.requestAnimationFrame(() => {
    gameDeleteConfirmButton.focus();
  });
}

function hideGameDeleteConfirmModal(): void {
  if (!gameDeleteConfirmModal) return;
  pendingModalDeleteGameId = null;
  hideModal(gameDeleteConfirmModal);
}

function showModal(modal: HTMLElement): void {
  showAnimatedElement(modal, 'modal-backdrop--closing');
}

function hideModal(modal: HTMLElement): void {
  hideAnimatedElement(modal, 'modal-backdrop--closing', MODAL_ANIMATION_MS);
}

function showAnimatedElement(element: HTMLElement, closingClass: string): void {
  const hideTimer = animatedElementHideTimers.get(element);
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    animatedElementHideTimers.delete(element);
  }
  element.classList.remove(closingClass);
  element.hidden = false;
}

function hideAnimatedElement(element: HTMLElement, closingClass: string, durationMs: number): void {
  if (element.hidden) return;
  const existingTimer = animatedElementHideTimers.get(element);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }
  element.classList.add(closingClass);
  const hideTimer = window.setTimeout(() => {
    element.hidden = true;
    element.classList.remove(closingClass);
    animatedElementHideTimers.delete(element);
  }, durationMs);
  animatedElementHideTimers.set(element, hideTimer);
}

function renderGamesModal(): void {
  const { claims, currentGameId } = getClientState();

  if (claims.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.classList.add('games-modal-empty');
    emptyState.textContent = 'No saved games on this device.';
    gamesModalList.replaceChildren(emptyState);
    return;
  }

  const items = claims.map((claim, index) => renderGamesModalItem(claim, index, currentGameId));
  gamesModalList.replaceChildren(...items);
}

function renderGamesModalItem(
  claim: StoredClaim,
  index: number,
  currentGameId: string | null,
): HTMLDivElement {
  const isCurrentGame = claim.gameId === currentGameId;
  const item = document.createElement('div');
  item.classList.add('games-modal-item');
  if (isCurrentGame) {
    item.classList.add('games-modal-item--active');
  }

  const details = document.createElement('div');
  details.classList.add('games-modal-item__details');

  const title = document.createElement('strong');
  title.classList.add('games-modal-item__title');
  title.textContent = claim.opponentName ?? `Game ${shortGameId(claim.gameId)}`;

  const meta = document.createElement('span');
  meta.classList.add('games-modal-item__meta');
  const position = index === 0 ? 'Latest' : `Game ${index + 1}`;
  meta.textContent = `${position} - seat ${claim.seat} - ${formatStoredClaimDate(claim.updatedAt)}`;

  const player = document.createElement('span');
  player.classList.add('games-modal-item__player');
  player.textContent = claim.playerName;

  details.append(title, meta, player);

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.classList.add('action-button', 'games-modal-item__button');
  openButton.textContent = isCurrentGame ? 'current' : 'open';
  openButton.disabled = accountRequestInFlight || isCurrentGame;
  openButton.addEventListener('click', () => {
    hideGamesModal();
    void openGame(claim.gameId);
  });

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.classList.add(
    'action-button',
    'games-modal-item__button',
    'games-modal-item__icon-button',
    'games-modal-item__delete-button',
  );
  deleteButton.title = 'Remove game';
  deleteButton.setAttribute('aria-label', `Remove ${title.textContent ?? 'game'}`);
  deleteButton.disabled = accountRequestInFlight;
  deleteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    openGameDeleteConfirmModal(claim);
  });

  item.append(details, openButton, deleteButton);
  return item;
}

function formatStoredClaimDate(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

async function deleteSavedGame(gameId: string): Promise<void> {
  pendingModalDeleteGameId = null;
  const wasCurrentGame = getClientState().currentGameId === gameId;
  const shouldKeepGamesModalOpen = !gamesModal.hidden;
  hideModal(gameDeleteConfirmModal);
  const nextStore = removeStoredClaim(gameId);

  hydrateClientState({
    claims: nextStore.claims,
    ...(wasCurrentGame
      ? { currentClaimToken: null, currentGameId: null, currentPlayerId: null }
      : {}),
  });

  if (!wasCurrentGame) {
    syncAccountUi();
    renderGamesModal();
    setStatus('Game deleted from this device.');
    return;
  }

  disconnectSocket();
  const nextClaim = nextStore.claims[0] ?? null;
  if (nextClaim) {
    await openGame(nextClaim.gameId);
  } else {
    await createNewGame();
  }
  if (shouldKeepGamesModalOpen) {
    openGamesModal();
  } else {
    renderGamesModal();
  }
  setStatus('Game deleted from this device.');
}

function syncNameModalUi(): void {
  const activeClaim = currentStoredClaim();
  const currentName = activeClaim?.playerName ?? '';
  const nameDraft = nameModalInput.value.trim();
  nameModalInput.disabled = accountRequestInFlight;
  nameModalSaveButton.disabled = accountRequestInFlight
    || !activeClaim
    || nameDraft.length === 0
    || nameDraft === currentName;
}

async function submitNameModal(): Promise<void> {
  const playerNameInput = nameModalInput.value.trim();
  if (playerNameInput.length === 0) {
    setStatus('Enter a display name.', 'error');
    return;
  }

  const didRename = await renameCurrentPlayer(playerNameInput);
  if (didRename) {
    hideNameModal();
  }
}

function preferredDisplayName(): string | null {
  const name = readPreferredDisplayName();
  return name.length > 0 ? name : null;
}

async function createNewGame(): Promise<void> {
  accountRequestInFlight = true;
  syncAccountUi();
  setStatus('Creating a new game...');

  try {
    const result = await createInviteGame(preferredDisplayName());
    setLocationGameId(result.game.gameId);
    clearCurrentGameState(`Game ${shortGameId(result.game.gameId)} ready.`);
    rememberClaim(result.claim, result.game);
    currentGameSummary = result.game;
    hydrateClientState({ currentGameId: result.game.gameId });
    syncAccountUi();
    ensureGameSocket(true);
  } catch (error) {
    setStatus(errorMessage(error), 'error');
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

async function claimCurrentGame(silentConflict = false): Promise<boolean> {
  const { currentGameId } = getClientState();
  if (!currentGameId) return false;

  accountRequestInFlight = true;
  syncAccountUi();
  setStatus('Claiming the open seat...');

  try {
    const result = await claimInviteGame(currentGameId, preferredDisplayName());
    rememberClaim(result.claim, result.game);
    currentGameSummary = result.game;
    setStatus('Seat claimed.');
    syncAccountUi();
    ensureGameSocket(true);
    return true;
  } catch (error) {
    const message = errorMessage(error);
    if (!silentConflict || !/already claimed|open seat/i.test(message)) {
      setStatus(message, 'error');
    }
    return false;
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

async function renameCurrentPlayer(playerNameInput: string): Promise<boolean> {
  const { currentClaimToken, currentGameId } = getClientState();
  if (!currentGameId || !currentClaimToken) return false;

  accountRequestInFlight = true;
  syncAccountUi();
  setStatus('Saving display name...');

  try {
    const result = await renameClaimedPlayer(currentGameId, currentClaimToken, playerNameInput);
    rememberClaim(result.claim, result.game);
    writePreferredDisplayName(result.claim.playerName);
    currentGameSummary = result.game;
    setStatus('Display name saved.');
    syncAccountUi();
    if (latestGameState && latestGameState.gameId === result.game.gameId) {
      syncGameState({
        ...latestGameState,
        players: latestGameState.players.map((player) => (
          player.id === result.claim.playerId
            ? { ...player, name: result.claim.playerName }
            : player
        )),
      });
    }
    return true;
  } catch (error) {
    setStatus(errorMessage(error), 'error');
    return false;
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

async function enableTurnNotifications(): Promise<void> {
  if (!turnNotificationsSupported()) {
    setStatus('Turn notifications are not supported in this browser.', 'error');
    updateActionButtons();
    return;
  }

  const permission = await requestTurnNotificationPermission();
  if (permission === 'granted') {
    setStatus('Turn notifications enabled.');
  } else if (permission === 'denied') {
    setStatus('Turn notifications are blocked in browser settings.', 'error');
  } else {
    setStatus('Turn notifications were not enabled.', 'error');
  }
  updateActionButtons();
}

async function openGame(gameId: string): Promise<void> {
  const activeClaim = findStoredClaim(getClientState().claims, gameId);
  hydrateClientState({
    currentClaimToken: activeClaim?.claimToken ?? null,
    currentGameId: gameId,
    currentPlayerId: activeClaim?.playerId ?? null,
  });
  setLocationGameId(gameId);
  clearCurrentGameState('Loading game...');
  const nextSocketTarget = currentSocketTarget();
  if (
    !activeClaim ||
    (socket && nextSocketTarget && !socketMatchesTarget(socket, nextSocketTarget))
  ) {
    disconnectSocket();
  }
  syncAccountUi();
  await loadCurrentGameSummary(gameId);
  if (
    !activeClaim &&
    currentGameSummary &&
    !currentGameSummary.singlePlayer &&
    currentGameSummary.players.some((player) => player.id === null)
  ) {
    await claimCurrentGame(true);
  }
  ensureGameSocket();
}

async function loadCurrentGameSummary(gameId: string): Promise<void> {
  accountRequestInFlight = true;
  syncAccountUi();

  try {
    const result = await fetchGameSummary(gameId);
    currentGameSummary = result.game;
    syncAccountUi();
    setStatus(selectedGameStatusText(result.game));
  } catch (error) {
    currentGameSummary = null;
    hydrateClientState({
      currentClaimToken: null,
      currentGameId: null,
      currentPlayerId: null,
    });
    setLocationGameId(null);
    clearCurrentGameState(errorMessage(error), true);
  } finally {
    accountRequestInFlight = false;
    syncAccountUi();
    updateActionButtons();
  }
}

function rememberClaim(claim: ClaimSession, summary: GameSummary): void {
  const nextStore = upsertStoredClaim({
    gameId: claim.gameId,
    claimToken: claim.claimToken,
    playerId: claim.playerId,
    playerName: claim.playerName,
    seat: claim.seat,
    opponentName: summaryOpponentName(summary, claim.playerId),
    updatedAt: summary.updatedAt || new Date().toISOString(),
  });
  hydrateClientState({
    claims: nextStore.claims,
    currentClaimToken: claim.claimToken,
    currentGameId: claim.gameId,
    currentPlayerId: claim.playerId,
  });
}

function syncStoredClaimFromState(state: GameState, player: PlayerPublicState): void {
  const activeClaim = currentStoredClaim();
  if (!activeClaim) return;

  const summary = summaryFromState(state);
  const nextStore = upsertStoredClaim({
    ...activeClaim,
    opponentName: summaryOpponentName(summary, player.id),
    playerId: player.id,
    playerName: player.name,
    updatedAt: summary.updatedAt || new Date().toISOString(),
  });
  hydrateClientState({
    claims: nextStore.claims,
    currentPlayerId: player.id,
  });
}

function currentStoredClaim(): StoredClaim | null {
  const { currentClaimToken, currentGameId } = getClientState();
  if (!currentGameId || !currentClaimToken) return null;
  const claim = findStoredClaim(getClientState().claims, currentGameId);
  if (!claim || claim.claimToken !== currentClaimToken) return null;
  return claim;
}

function setLocationGameId(gameId: string | null): void {
  const url = new URL(window.location.href);
  if (gameId) {
    url.searchParams.set('game', gameId);
  } else {
    url.searchParams.delete('game');
  }
  window.history.replaceState({}, '', url);
}

function currentGameIdFromLocation(): string | null {
  const gameId = new URL(window.location.href).searchParams.get('game');
  return gameId && gameId.length > 0 ? gameId : null;
}

function findStoredClaim(claims: readonly StoredClaim[], gameId: string | null): StoredClaim | null {
  if (!gameId) return null;
  return claims.find((claim) => claim.gameId === gameId) ?? null;
}

function isDefaultSeatName(name: string, seat: number): boolean {
  return name === `Player ${seat}`;
}

async function copyInviteLink(gameId: string): Promise<void> {
  const inviteLink = new URL(window.location.href);
  inviteLink.searchParams.set('game', gameId);
  try {
    await navigator.clipboard.writeText(inviteLink.toString());
    setStatus('Invite link copied.');
  } catch {
    setStatus(inviteLink.toString());
  }
}

function setStatus(message: string, tone: 'normal' | 'error' = 'normal'): void {
  statusNoticeValue.textContent = message;
  statusNoticeValue.setAttribute('title', message);
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
  return player ? playerName(player) : shortId(playerId);
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
  hideAnimatedElement(optionsMenu, 'options-menu--closing', MODAL_ANIMATION_MS);
}

function updateHeaderActions(): void {
  const { currentGameId } = getClientState();
  const canCopyInvite = Boolean(currentGameId && !accountRequestInFlight);
  if (headerCopyInviteButton) {
    headerCopyInviteButton.hidden = !currentGameId;
    headerCopyInviteButton.disabled = !canCopyInvite;
  }
  if (menuCopyInviteButton) {
    menuCopyInviteButton.disabled = !canCopyInvite;
  }
}

function updateOptionsMenuState(player: PlayerPublicState | null): void {
  const singlePlayerEnabled = latestGameState?.singlePlayer ?? currentGameSummary?.singlePlayer ?? false;
  const canChangeLayout = Boolean(
    player &&
    latestGameState?.canChangeBoardLayout &&
    socketIsOpen() &&
    !waitingForServer,
  );
  const canChangeSinglePlayer = Boolean(
    player &&
    latestGameState?.canChangeSinglePlayer &&
    socketIsOpen() &&
    !waitingForServer,
  );
  const canChangeWordLengthRule = Boolean(
    player &&
    latestGameState?.canChangeWordLengthRule &&
    socketIsOpen() &&
    !waitingForServer,
  );
  const canChangeAreaBonusRule = Boolean(
    player &&
    latestGameState?.canChangeAreaBonusRule &&
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
  setBoardLayoutButtonState(
    standardWordLengthButton,
    currentWordLengthRule === 'standard',
    !canChangeWordLengthRule,
  );
  setBoardLayoutButtonState(
    noTwoLetterWordsButton,
    currentWordLengthRule === 'no-two-letter-words',
    !canChangeWordLengthRule,
  );
  setBoardLayoutButtonState(
    noThreeLetterWordsButton,
    currentWordLengthRule === 'no-three-letter-words',
    !canChangeWordLengthRule,
  );
  setBoardLayoutButtonState(
    noAreaBonusButton,
    currentAreaBonusRule === 'none',
    !canChangeAreaBonusRule,
  );
  setBoardLayoutButtonState(
    closedRectangleBonusButton,
    currentAreaBonusRule === 'closed-rectangle-area',
    !canChangeAreaBonusRule,
  );
  setBoardLayoutButtonState(singlePlayerMenuButton, singlePlayerEnabled, !canChangeSinglePlayer);
  syncNotificationButtonState();
  syncDarkModeButtonState();
  changeDisplayNameMenuButton.disabled = accountRequestInFlight || waitingForServer || !currentStoredClaim();
  gamesMenuButton.disabled = accountRequestInFlight;
  newGameMenuButton.disabled = accountRequestInFlight;
}

function syncNotificationButtonState(): void {
  if (!notificationMenuButton) return;

  const permission = currentTurnNotificationPermission();
  if (permission === 'unsupported') {
    notificationMenuButton.textContent = 'Notifications unavailable';
    notificationMenuButton.disabled = true;
    return;
  }
  if (permission === 'granted') {
    notificationMenuButton.textContent = 'Turn notifications on';
    notificationMenuButton.disabled = true;
    return;
  }
  if (permission === 'denied') {
    notificationMenuButton.textContent = 'Notifications blocked';
    notificationMenuButton.disabled = true;
    return;
  }

  notificationMenuButton.textContent = 'Enable turn notifications';
  notificationMenuButton.disabled = accountRequestInFlight;
}

function syncMobileLayout(): void {
  if (mobileLayoutQuery.matches) {
    app.style.width = '100%';
    if (headerContainer) {
      headerContainer.style.width = '100%';
    }
    if (header && statusScoreCard.parentElement !== header) {
      header.insertBefore(statusScoreCard, headerActions);
    }
    if (header && tileBagCard.parentElement !== header) {
      header.insertBefore(tileBagCard, statusScoreCard);
    }
    if (header && statusScoreLatestCard.parentElement !== header) {
      header.insertBefore(statusScoreLatestCard, headerActions);
    }
    syncHandScale(mobileHandScale());
    app.classList.add('app--mobile-shell');
    return;
  }

  if (tileBagCard.parentElement !== sideColumn) {
    sideColumn.prepend(tileBagCard);
  }
  if (statusScoreCard.parentElement !== sideColumn) {
    tileBagCard.insertAdjacentElement('afterend', statusScoreCard);
  }
  if (statusScoreLatestCard.parentElement !== sideColumn) {
    statusScoreCard.insertAdjacentElement('afterend', statusScoreLatestCard);
  }
  if (historyPanel.parentElement !== sideColumn) {
    sideColumn.appendChild(historyPanel);
  }
  app.style.width = APP_SHELL_WIDTH_STYLE;
  if (headerContainer) {
    headerContainer.style.width = APP_SHELL_WIDTH_STYLE;
  }
  syncHandScale(1);
  app.classList.remove('app--mobile-shell');
  syncHistoryPanelHeight();
}

function mobileHandScale(): number {
  const handWidth = hand.el.offsetWidth || hand.el.getBoundingClientRect().width;
  if (handWidth <= 0) return 1;
  const availableWidth = Math.max(0, window.innerWidth - 24);
  return Math.max(1, Math.min(MOBILE_HAND_MAX_SCALE, availableWidth / handWidth));
}

function syncHandScale(nextScale: number): void {
  hand.zoom = nextScale;
  hand.el.style.transform = nextScale === 1 ? '' : `scale(${nextScale})`;
  hand.el.style.marginTop = nextScale === 1 ? '' : `${Math.round((hand.el.offsetHeight * (nextScale - 1)) / 2)}px`;
  hand.el.style.marginBottom = hand.el.style.marginTop;
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

function requestWordLengthRule(rule: WordLengthRule): void {
  if (!latestGameState || currentWordLengthRule === rule) {
    hideOptionsMenu();
    return;
  }
  if (!currentPlayer(latestGameState)) return;
  sendMessageToServer({
    type: 'set_word_length_rule',
    rule,
  });
  hideOptionsMenu();
}

function requestAreaBonusRule(rule: AreaBonusRule): void {
  if (!latestGameState || currentAreaBonusRule === rule) {
    hideOptionsMenu();
    return;
  }
  if (!currentPlayer(latestGameState)) return;
  sendMessageToServer({
    type: 'set_area_bonus_rule',
    rule,
  });
  hideOptionsMenu();
}

function requestSinglePlayerMode(): void {
  if (!latestGameState || !currentPlayer(latestGameState)) {
    hideOptionsMenu();
    return;
  }
  sendMessageToServer({
    type: 'set_single_player',
    enabled: !latestGameState.singlePlayer,
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
  socket = new WebSocket(webSocketUrl(target.claimToken, target.gameId));

  socket.addEventListener('open', () => {
    if (generation !== socketGeneration) return;
    reconnectAttempts = 0;
    setStatus('Connected. Syncing game state...');
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

function webSocketUrl(claimToken: string | null, gameId: string): string {
  const query = new URLSearchParams();
  query.set('game', gameId);
  if (claimToken) {
    query.set('claim', claimToken);
  }
  return resolveWebSocketUrl('/ws', query);
}

function currentSocketTarget(): { claimToken: string | null; gameId: string } | null {
  const { currentClaimToken, currentGameId } = getClientState();
  return currentGameId ? { claimToken: currentClaimToken, gameId: currentGameId } : null;
}

function socketMatchesTarget(
  candidateSocket: WebSocket,
  target: { claimToken: string | null; gameId: string },
): boolean {
  const socketUrl = new URL(candidateSocket.url);
  return socketUrl.searchParams.get('claim') === target.claimToken &&
    socketUrl.searchParams.get('game') === target.gameId;
}

function shouldReconnectTo(target: { claimToken: string | null; gameId: string }): boolean {
  const desiredTarget = currentSocketTarget();
  return Boolean(
    desiredTarget &&
    desiredTarget.claimToken === target.claimToken &&
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

      if (!isRecord(message.state)) {
        setStatus('Server state message was malformed.', 'error');
        return;
      }

      const stateGameId = readStringValue(message.state.gameId);
      const selectedGameId = getClientState().currentGameId;
      if (selectedGameId && stateGameId && stateGameId !== selectedGameId) {
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
      const serverMessage = readStringValue(message.msg) ?? 'The server returned an error.';
      if (/claim token/i.test(serverMessage) || /game not found/i.test(serverMessage)) {
        const { currentGameId } = getClientState();
        if (currentGameId) {
          const nextStore = removeStoredClaim(currentGameId);
          hydrateClientState({
            claims: nextStore.claims,
            currentClaimToken: null,
            currentPlayerId: null,
          });
        }
      }
      setStatus(serverMessage, 'error');
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
