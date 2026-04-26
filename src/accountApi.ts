import type { AccountSummary, GameSummary } from './accountModels.ts';
import { normalizeAccount, normalizeGameSummaries } from './accountModels.ts';
import { resolveApiUrl } from './network.ts';

export type AccountOverviewResult = {
  account: AccountSummary;
  games: GameSummary[];
};

export type LoginResult = AccountOverviewResult & {
  sessionToken: string;
};

export type CreateGameResult = {
  game: GameSummary;
  games: GameSummary[];
};

export async function loginAccount(accountName: string): Promise<LoginResult> {
  const payload = await requestJson('/api/account/login', {
    method: 'POST',
    body: JSON.stringify({ accountName }),
  });
  if (!isRecord(payload)) {
    throw new Error('Login response was not valid JSON.');
  }

  const account = normalizeAccount(payload.account);
  const sessionToken = readString(payload.sessionToken);
  if (!account || !sessionToken) {
    throw new Error('Login response was missing account session data.');
  }

  return {
    account,
    sessionToken,
    games: normalizeGameSummaries(payload.games),
  };
}

export async function fetchAccountOverview(sessionToken: string): Promise<AccountOverviewResult> {
  const url = new URL(resolveApiUrl('/api/account/overview'));
  url.searchParams.set('session', sessionToken);
  const payload = await requestJson(url.toString(), { method: 'GET' });
  if (!isRecord(payload)) {
    throw new Error('Overview response was not valid JSON.');
  }

  const account = normalizeAccount(payload.account);
  if (!account) {
    throw new Error('Overview response was missing account data.');
  }

  return {
    account,
    games: normalizeGameSummaries(payload.games),
  };
}

export async function createGame(sessionToken: string, opponentName: string): Promise<CreateGameResult> {
  const payload = await requestJson('/api/games', {
    method: 'POST',
    body: JSON.stringify({ sessionToken, opponentName }),
  });
  if (!isRecord(payload)) {
    throw new Error('Create game response was not valid JSON.');
  }

  const [game] = normalizeGameSummaries([payload.game]);
  if (!game) {
    throw new Error('Create game response was missing the new game.');
  }

  return {
    game,
    games: normalizeGameSummaries(payload.games),
  };
}

async function requestJson(pathOrUrl: string, init: RequestInit): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(resolveRequestUrl(pathOrUrl), {
    ...init,
    headers,
  });

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new Error(extractErrorMessage(payload) ?? `${response.status} ${response.statusText}`.trim());
  }

  return payload;
}

function resolveRequestUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return resolveApiUrl(pathOrUrl);
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string' && payload.length > 0) return payload;
  if (!isRecord(payload)) return null;
  return readString(payload.msg) ?? readString(payload.message) ?? readString(payload.error);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
