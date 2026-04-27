import type { StoredClaim } from './claimStore.ts';

type ClientState = {
  currentGameId: string | null;
  currentPlayerId: string | null;
  currentClaimToken: string | null;
  defaultPlayerName: string;
  claims: StoredClaim[];
};

const clientState: ClientState = {
  currentGameId: null,
  currentPlayerId: null,
  currentClaimToken: null,
  defaultPlayerName: '',
  claims: [],
};

export function hydrateClientState(partialState: Partial<ClientState>): void {
  if (partialState.currentGameId !== undefined) {
    clientState.currentGameId = partialState.currentGameId;
  }
  if (partialState.currentPlayerId !== undefined) {
    clientState.currentPlayerId = partialState.currentPlayerId;
  }
  if (partialState.currentClaimToken !== undefined) {
    clientState.currentClaimToken = partialState.currentClaimToken;
  }
  if (partialState.defaultPlayerName !== undefined) {
    clientState.defaultPlayerName = partialState.defaultPlayerName;
  }
  if (partialState.claims !== undefined) {
    clientState.claims = partialState.claims;
  }
}

export function clearClientState(): void {
  clientState.currentGameId = null;
  clientState.currentPlayerId = null;
  clientState.currentClaimToken = null;
  clientState.defaultPlayerName = '';
  clientState.claims = [];
}

export function getClientState(): Readonly<ClientState> {
  return clientState;
}

export function setCurrentPlayerId(nextPlayerId: string): void {
  clientState.currentPlayerId = nextPlayerId;
}

export function clearCurrentPlayerId(): void {
  clientState.currentPlayerId = null;
}

export function hasCurrentPlayerId(): boolean {
  return clientState.currentPlayerId !== null;
}

export function getCurrentPlayerId(): string {
  if (clientState.currentPlayerId === null) {
    throw new Error('currentPlayerId is not set yet');
  }

  return clientState.currentPlayerId;
}
