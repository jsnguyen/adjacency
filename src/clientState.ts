let playerId: string | null = null;

export function setPlayerId(nextPlayerId: string): void {
  playerId = nextPlayerId;
}

export function clearPlayerId(): void {
  playerId = null;
}

export function getPlayerId(): string {
  if (playerId === null) {
    throw new Error('playerId is not set yet');
  }

  return playerId;
}

export function hasPlayerId(): boolean {
  return playerId !== null;
}
