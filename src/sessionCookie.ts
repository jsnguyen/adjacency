type SessionCookieState = {
  playerId?: string;
  roomId?: string;
  sessionId?: string;
};

const COOKIE_NAME = 'adjacency_state';
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

export function readSessionCookie(): SessionCookieState {
  const encodedValue = document.cookie
    .split('; ')
    .find((cookie) => cookie.startsWith(`${COOKIE_NAME}=`))
    ?.slice(COOKIE_NAME.length + 1);

  if (!encodedValue) return {};

  try {
    const parsed = JSON.parse(decodeURIComponent(encodedValue)) as SessionCookieState;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSessionCookie(partialState: SessionCookieState): void {
  const nextState = {
    ...readSessionCookie(),
    ...partialState,
  };

  document.cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(JSON.stringify(nextState))}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_S}`,
    'SameSite=Lax',
  ].join('; ');
}
