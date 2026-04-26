import type { AccountSummary, GameSummary } from './accountModels.ts';

type ClientState = {
  account: AccountSummary | null;
  currentGameId: string | null;
  games: GameSummary[];
  playerId: string | null;
  sessionToken: string | null;
};

const clientState: ClientState = {
  account: null,
  currentGameId: null,
  games: [],
  playerId: null,
  sessionToken: null,
};

export function hydrateClientState(partialState: Partial<ClientState>): void {
  if (partialState.account !== undefined) {
    clientState.account = partialState.account;
  }
  if (partialState.currentGameId !== undefined) {
    clientState.currentGameId = partialState.currentGameId;
  }
  if (partialState.games !== undefined) {
    clientState.games = partialState.games;
  }
  if (partialState.playerId !== undefined) {
    clientState.playerId = partialState.playerId;
  }
  if (partialState.sessionToken !== undefined) {
    clientState.sessionToken = partialState.sessionToken;
  }
}

export function clearClientState(): void {
  clientState.account = null;
  clientState.currentGameId = null;
  clientState.games = [];
  clientState.playerId = null;
  clientState.sessionToken = null;
}

export function getClientState(): Readonly<ClientState> {
  return clientState;
}

export function setPlayerId(nextPlayerId: string): void {
  clientState.playerId = nextPlayerId;
}

export function clearPlayerId(): void {
  clientState.playerId = null;
}

export function getPlayerId(): string {
  if (clientState.playerId === null) {
    throw new Error('playerId is not set yet');
  }

  return clientState.playerId;
}

export function hasPlayerId(): boolean {
  return clientState.playerId !== null;
}
