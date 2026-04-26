import type {
  AccountState as SharedAccountState,
  GameState,
  GameSummaryState as SharedGameSummaryState,
  PlayerPublicState,
} from '../shared/states.ts';

export type AccountSummary = SharedAccountState;

export type GameParticipantSummary = {
  id: string | null;
  accountName: string | null;
  seat: number | null;
  connected: boolean | null;
};

export type GameSummary = Pick<SharedGameSummaryState, 'gameId'> & {
  currentPlayerId: string | null;
  gameEnded: boolean | null;
  opponentName: string | null;
  players: GameParticipantSummary[];
  teamScore: number | null;
  updatedAt: string | null;
  yourTurn: boolean | null;
};

type RecordLike = Record<string, unknown>;

export function normalizeAccount(value: unknown): AccountSummary | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const name = readString(value.name);
  if (!id || !name) return null;
  return { id, name };
}

export function normalizeGameSummaries(value: unknown): GameSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeGameSummary(entry)).filter((entry): entry is GameSummary => entry !== null);
}

export function normalizeGameSummary(value: unknown): GameSummary | null {
  if (!isRecord(value)) return null;
  const gameId = readString(value.gameId) ?? readString(value.roomId) ?? readString(value.id);
  if (!gameId) return null;
  const players = Array.isArray(value.players) ? value.players.map(normalizeParticipant) : [];
  return {
    gameId,
    currentPlayerId: readString(value.currentPlayerId),
    gameEnded: typeof value.gameEnded === 'boolean' ? value.gameEnded : null,
    opponentName: readString(value.opponentName),
    players,
    teamScore: readNumber(value.teamScore),
    updatedAt: readString(value.updatedAt),
    yourTurn: typeof value.yourTurn === 'boolean' ? value.yourTurn : null,
  };
}

export function gameIdFromState(state: GameState | null): string | null {
  if (!state) return null;
  const record = state as GameState & { gameId?: string; roomId?: string };
  if (typeof record.gameId === 'string' && record.gameId.length > 0) return record.gameId;
  if (typeof record.roomId === 'string' && record.roomId.length > 0) return record.roomId;
  return null;
}

export function gameSummaryFromState(state: GameState): GameSummary | null {
  const gameId = gameIdFromState(state);
  if (!gameId) return null;
  return {
    gameId,
    currentPlayerId: state.currentPlayerId,
    gameEnded: state.gameEnded,
    opponentName: null,
    players: state.players.map((player, index) => ({
      id: player.id,
      accountName: playerAccountName(player),
      seat: playerSeat(player, index),
      connected: player.connected,
    })),
    teamScore: state.teamScore,
    updatedAt: null,
    yourTurn: null,
  };
}

export function playerAccountName(player: PlayerPublicState | GameParticipantSummary): string | null {
  const record = player as (PlayerPublicState & { accountName?: string; name?: string });
  const accountName = readString(record.accountName);
  if (accountName) return accountName;
  return readString(record.name);
}

export function playerSeat(
  player: PlayerPublicState | GameParticipantSummary,
  fallbackIndex?: number,
): number | null {
  const record = player as (PlayerPublicState & { seat?: number });
  if (Number.isInteger(record.seat)) {
    return record.seat;
  }
  if (fallbackIndex === undefined) return null;
  return fallbackIndex + 1;
}

export function describeGameSummary(
  summary: GameSummary,
  currentAccountName: string | null,
): { title: string; status: string } {
  if (summary.opponentName) {
    const statusParts: string[] = [];
    if (summary.gameEnded) {
      statusParts.push('finished');
    } else if (summary.yourTurn === true) {
      statusParts.push('your turn');
    } else if (summary.yourTurn === false) {
      statusParts.push('their turn');
    }
    if (summary.teamScore !== null) {
      statusParts.push(`${summary.teamScore} pts`);
    }
    return {
      title: summary.opponentName,
      status: statusParts.join(' / ') || `Game ${shortGameId(summary.gameId)}`,
    };
  }

  const namedPlayers = summary.players
    .map((player, index) => player.accountName ?? `Seat ${playerSeat(player, index) ?? index + 1}`)
    .filter((name) => name.length > 0);
  const opponentNames = currentAccountName
    ? namedPlayers.filter((name) => name !== currentAccountName)
    : namedPlayers;
  const title = opponentNames[0] ?? namedPlayers[0] ?? `Game ${shortGameId(summary.gameId)}`;
  const seat = currentAccountName
    ? summary.players.find((player) => player.accountName === currentAccountName)?.seat ?? null
    : null;
  const filledSeats = summary.players.filter((player) => player.accountName !== null).length;
  const statusParts: string[] = [];
  if (seat !== null) statusParts.push(`seat ${seat}`);
  if (summary.gameEnded) {
    statusParts.push('finished');
  } else if (filledSeats < 2) {
    statusParts.push('waiting');
  } else {
    statusParts.push('active');
  }
  return {
    title,
    status: statusParts.join(' / '),
  };
}

export function shortGameId(gameId: string): string {
  return gameId.slice(0, 6);
}

function normalizeParticipant(value: unknown): GameParticipantSummary {
  if (!isRecord(value)) {
    return {
      id: null,
      accountName: null,
      seat: null,
      connected: null,
    };
  }

  return {
    id: readString(value.id),
    accountName: readString(value.accountName) ?? readString(value.name),
    seat: readInteger(value.seat),
    connected: typeof value.connected === 'boolean' ? value.connected : null,
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null;
}
