import { resolveApiUrl } from './network.ts';
import {
  normalizeClaimSession,
  normalizeGameSummary,
  type ClaimSession,
  type GameSummary,
} from './gameModels.ts';

type GameSummaryResult = {
  game: GameSummary;
};

type ClaimedGameResult = GameSummaryResult & {
  claim: ClaimSession;
};

export async function createInviteGame(name: string | null = null): Promise<ClaimedGameResult> {
  return requestClaimedGame('/api/games', {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
}

export async function fetchGameSummary(gameId: string): Promise<GameSummaryResult> {
  const payload = await requestJson(resolveApiUrl(`/api/games/${encodeURIComponent(gameId)}`), { method: 'GET' });
  if (!isRecord(payload)) {
    throw new Error('Game response was not valid JSON.');
  }

  const game = normalizeGameSummary(payload.game);
  if (!game) {
    throw new Error('Game response was missing summary data.');
  }

  return { game };
}

export async function claimInviteGame(gameId: string, name: string | null = null): Promise<ClaimedGameResult> {
  return requestClaimedGame(`/api/games/${encodeURIComponent(gameId)}/claim`, {
    method: 'POST',
    body: JSON.stringify(name ? { name } : {}),
  });
}

export async function renameClaimedPlayer(
  gameId: string,
  claimToken: string,
  name: string,
): Promise<ClaimedGameResult> {
  return requestClaimedGame(`/api/games/${encodeURIComponent(gameId)}/player`, {
    method: 'PATCH',
    body: JSON.stringify({ claimToken, name }),
  });
}

async function requestClaimedGame(pathOrUrl: string, init: RequestInit): Promise<ClaimedGameResult> {
  const payload = await requestJson(pathOrUrl, init);
  if (!isRecord(payload)) {
    throw new Error('Server response was not valid JSON.');
  }

  const game = normalizeGameSummary(payload.game);
  const claim = normalizeClaimSession(payload.claim);
  if (!game || !claim) {
    throw new Error('Server response was missing claim data.');
  }

  return { game, claim };
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
