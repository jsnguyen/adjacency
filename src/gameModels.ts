import type { GameState, GameSummaryState, PlayerPublicState } from '../shared/states.ts';
import { isAreaBonusRule, isWordLengthRule } from '../shared/ruleSets.ts';

export type ClaimSession = {
  gameId: string;
  claimToken: string;
  playerId: string;
  playerName: string;
  seat: number;
};

export type GameSummary = GameSummaryState;

type RecordLike = Record<string, unknown>;

export function normalizeGameSummary(value: unknown): GameSummary | null {
  if (!isRecord(value)) return null;
  const gameId = readString(value.gameId) ?? readString(value.id);
  if (!gameId) return null;
  const players = Array.isArray(value.players)
    ? value.players.map((player, index) => normalizeSummaryPlayer(player, index))
    : [];
  return {
    gameId,
    players,
    currentPlayerId: readString(value.currentPlayerId),
    gameEnded: Boolean(value.gameEnded),
    singlePlayer: Boolean(value.singlePlayer),
    canChangeSinglePlayer: Boolean(value.canChangeSinglePlayer),
    wordLengthRule: isWordLengthRule(value.wordLengthRule) ? value.wordLengthRule : 'standard',
    canChangeWordLengthRule: Boolean(value.canChangeWordLengthRule),
    areaBonusRule: isAreaBonusRule(value.areaBonusRule) ? value.areaBonusRule : 'none',
    canChangeAreaBonusRule: Boolean(value.canChangeAreaBonusRule),
    teamScore: readNumber(value.teamScore) ?? 0,
    updatedAt: readString(value.updatedAt) ?? '',
  };
}

export function normalizeClaimSession(value: unknown): ClaimSession | null {
  if (!isRecord(value)) return null;
  const gameId = readString(value.gameId);
  const claimToken = readString(value.claimToken);
  const playerId = readString(value.playerId);
  const playerName = readString(value.playerName);
  const seat = readInteger(value.seat);
  if (!gameId || !claimToken || !playerId || !playerName || seat === null) return null;
  return {
    gameId,
    claimToken,
    playerId,
    playerName,
    seat,
  };
}

export function gameIdFromState(state: GameState | null): string | null {
  if (!state) return null;
  return typeof state.gameId === 'string' && state.gameId.length > 0 ? state.gameId : null;
}

export function playerName(player: PlayerPublicState): string {
  return player.name;
}

export function shortGameId(gameId: string): string {
  return gameId.slice(0, 6);
}

export function summaryOpponentName(summary: GameSummary, playerId: string | null): string | null {
  return summary.players.find((player) => player.id !== playerId && player.name !== null)?.name ?? null;
}

function normalizeSummaryPlayer(value: unknown, index: number): GameSummary['players'][number] {
  if (!isRecord(value)) {
    return {
      id: null,
      name: null,
      seat: index + 1,
      connected: false,
    };
  }

  return {
    id: readString(value.id),
    name: readString(value.name),
    seat: readInteger(value.seat) ?? index + 1,
    connected: Boolean(value.connected),
  };
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) ? Number(value) : null;
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null;
}
