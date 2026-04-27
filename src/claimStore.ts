export type StoredClaim = {
  gameId: string;
  claimToken: string;
  playerId: string;
  playerName: string;
  seat: number;
  opponentName: string | null;
  updatedAt: string;
};

type StoredClaimStore = {
  claims: StoredClaim[];
  defaultPlayerName: string;
};

const STORAGE_KEY = 'adjacency_claims';

export function readClaimStore(): StoredClaimStore {
  const storage = browserStorage();
  if (!storage) {
    return { claims: [], defaultPlayerName: '' };
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { claims: [], defaultPlayerName: '' };
    const parsed = JSON.parse(raw) as Partial<StoredClaimStore>;
    return {
      claims: Array.isArray(parsed.claims) ? parsed.claims.filter(isStoredClaim) : [],
      defaultPlayerName: typeof parsed.defaultPlayerName === 'string' ? parsed.defaultPlayerName : '',
    };
  } catch {
    return { claims: [], defaultPlayerName: '' };
  }
}

export function writeClaimStore(nextStore: StoredClaimStore): void {
  const storage = browserStorage();
  if (!storage) return;
  storage.setItem(STORAGE_KEY, JSON.stringify(nextStore));
}

export function upsertStoredClaim(claim: StoredClaim): StoredClaimStore {
  const currentStore = readClaimStore();
  const nextClaims = [...currentStore.claims];
  const existingIndex = nextClaims.findIndex((candidate) => candidate.gameId === claim.gameId);
  if (existingIndex === -1) {
    nextClaims.unshift(claim);
  } else {
    nextClaims[existingIndex] = claim;
  }
  const nextStore = {
    ...currentStore,
    claims: sortClaims(nextClaims),
  };
  writeClaimStore(nextStore);
  return nextStore;
}

export function removeStoredClaim(gameId: string): StoredClaimStore {
  const currentStore = readClaimStore();
  const nextStore = {
    ...currentStore,
    claims: currentStore.claims.filter((claim) => claim.gameId !== gameId),
  };
  writeClaimStore(nextStore);
  return nextStore;
}

export function setDefaultPlayerName(defaultPlayerName: string): StoredClaimStore {
  const currentStore = readClaimStore();
  const nextStore = {
    ...currentStore,
    defaultPlayerName,
  };
  writeClaimStore(nextStore);
  return nextStore;
}

export function claimForGame(gameId: string | null): StoredClaim | null {
  if (!gameId) return null;
  return readClaimStore().claims.find((claim) => claim.gameId === gameId) ?? null;
}

function sortClaims(claims: StoredClaim[]): StoredClaim[] {
  return [...claims].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStoredClaim(value: unknown): value is StoredClaim {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredClaim).gameId === 'string' &&
    typeof (value as StoredClaim).claimToken === 'string' &&
    typeof (value as StoredClaim).playerId === 'string' &&
    typeof (value as StoredClaim).playerName === 'string' &&
    typeof (value as StoredClaim).seat === 'number' &&
    typeof (value as StoredClaim).updatedAt === 'string' &&
    (typeof (value as StoredClaim).opponentName === 'string' || (value as StoredClaim).opponentName === null)
  );
}
