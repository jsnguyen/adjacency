export const TURN_NOTIFICATION_TAG = 'adjacency-current-player-turn';

export type TurnNotificationPermissionState = NotificationPermission | 'unsupported';

export type CurrentTurnNotificationOptions = {
  currentPlayerId: string | null;
  localPlayerId: string | null;
  gameId?: string | null;
  turnId?: string | number | null;
  gameEnded?: boolean;
  title?: string;
  body?: string;
  url?: string;
  icon?: string;
  badge?: string;
};

let lastObservedLocalTurnKey: string | null = null;
let lastNotifiedLocalTurnKey: string | null = null;
let fallbackNotification: Notification | null = null;

export function turnNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function turnNotificationsEnabled(): boolean {
  return turnNotificationsSupported() && Notification.permission === 'granted';
}

export function currentTurnNotificationPermission(): TurnNotificationPermissionState {
  return turnNotificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestTurnNotificationPermission(): Promise<TurnNotificationPermissionState> {
  if (!turnNotificationsSupported()) return 'unsupported';
  return Notification.requestPermission();
}

export async function notifyCurrentPlayerTurn(options: CurrentTurnNotificationOptions): Promise<boolean> {
  const localTurnKey = currentLocalTurnKey(options);
  if (!localTurnKey) {
    lastObservedLocalTurnKey = null;
    lastNotifiedLocalTurnKey = null;
    await clearTurnNotifications();
    return false;
  }

  const becameLocalTurn = lastObservedLocalTurnKey !== localTurnKey;
  lastObservedLocalTurnKey = localTurnKey;

  if (
    !becameLocalTurn ||
    lastNotifiedLocalTurnKey === localTurnKey ||
    !appIsHiddenOrUnfocused() ||
    !turnNotificationsEnabled()
  ) {
    return false;
  }

  const shown = await showTurnNotification(options);
  if (shown) {
    lastNotifiedLocalTurnKey = localTurnKey;
  }
  return shown;
}

export async function clearTurnNotifications(): Promise<void> {
  fallbackNotification?.close();
  fallbackNotification = null;

  const registration = await activeServiceWorkerRegistration();
  if (!registration || typeof registration.getNotifications !== 'function') return;

  const notifications = await registration.getNotifications({
    tag: TURN_NOTIFICATION_TAG,
  });
  for (const notification of notifications) {
    notification.close();
  }
}

export function installTurnNotificationAutoClear(): () => void {
  const clearIfOpen = (): void => {
    if (document.visibilityState === 'visible' && document.hasFocus()) {
      void clearTurnNotifications();
    }
  };

  document.addEventListener('visibilitychange', clearIfOpen);
  window.addEventListener('focus', clearIfOpen);
  window.addEventListener('pageshow', clearIfOpen);
  clearIfOpen();

  return () => {
    document.removeEventListener('visibilitychange', clearIfOpen);
    window.removeEventListener('focus', clearIfOpen);
    window.removeEventListener('pageshow', clearIfOpen);
  };
}

function currentLocalTurnKey(options: CurrentTurnNotificationOptions): string | null {
  if (
    options.gameEnded ||
    !options.localPlayerId ||
    !options.currentPlayerId ||
    options.currentPlayerId !== options.localPlayerId
  ) {
    return null;
  }

  return [
    options.gameId ?? 'unknown-game',
    options.localPlayerId,
    options.turnId ?? 'current-turn',
  ].join(':');
}

function appIsHiddenOrUnfocused(): boolean {
  return document.visibilityState === 'hidden' || !document.hasFocus();
}

async function showTurnNotification(options: CurrentTurnNotificationOptions): Promise<boolean> {
  const notificationOptions = buildNotificationOptions(options);
  const registration = await activeServiceWorkerRegistration();
  if (registration && typeof registration.showNotification === 'function') {
    try {
      await registration.showNotification(options.title ?? 'Your turn', notificationOptions);
      return true;
    } catch {
      // Fall through to the page-level Notification constructor.
    }
  }

  try {
    fallbackNotification?.close();
    fallbackNotification = new Notification(options.title ?? 'Your turn', notificationOptions);
    return true;
  } catch {
    return false;
  }
}

function buildNotificationOptions(options: CurrentTurnNotificationOptions): NotificationOptions {
  const url = options.url ?? window.location.href;
  return {
    body: options.body ?? 'Adjacency is waiting for your move.',
    icon: options.icon ?? '/app-icon.svg',
    badge: options.badge ?? '/app-icon.svg',
    tag: TURN_NOTIFICATION_TAG,
    data: { url },
  };
}

async function activeServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
