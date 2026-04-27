import type { StoredClaim } from './claimStore.ts';

type ClientState = {
  currentGameId: string | null;
  currentPlayerId: string | null;
  currentClaimToken: string | null;
  claims: StoredClaim[];
};

const clientState: ClientState = {
  currentGameId: null,
  currentPlayerId: null,
  currentClaimToken: null,
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
  if (partialState.claims !== undefined) {
    clientState.claims = partialState.claims;
  }
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
