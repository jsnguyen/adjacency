const COOKIE_NAME = 'adjacency_display_name';
const NAME_PATTERN = /^[A-Za-z0-9 _.'-]{1,24}$/;
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function readPreferredDisplayName(): string {
  const source = document.cookie;
  const entry = source
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!entry) return '';

  const rawValue = entry.slice(COOKIE_NAME.length + 1);
  let value: string;
  try {
    value = decodeURIComponent(rawValue).trim();
  } catch {
    return '';
  }
  return NAME_PATTERN.test(value) ? value : '';
}

export function writePreferredDisplayName(name: string): void {
  const trimmedName = name.trim();
  if (!NAME_PATTERN.test(trimmedName)) return;
  document.cookie = [
    `${COOKIE_NAME}=${encodeURIComponent(trimmedName)}`,
    'Path=/',
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    'SameSite=Lax',
  ].join('; ');
}
