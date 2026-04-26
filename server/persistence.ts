import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Letter } from '../shared/letters.ts';
import type { LastMoveState, TurnHistoryEntryState } from '../shared/states.ts';
import type { LetterTileState } from './rules.ts';

export type PersistedPlayerState = {
  id: string;
  sessionId: string;
  rack: LetterTileState[];
};

export type PersistedRoomState = {
  id: string;
  board: LetterTileState[];
  players: PersistedPlayerState[];
  turnOrder: string[];
  currentTurnIndex: number;
  bag: Letter[];
  nextTileNumber: number;
  teamScore: number;
  lastMove: LastMoveState;
  turnHistory: TurnHistoryEntryState[];
  nextTurnNumber: number;
  updatedAt: string;
};

type PersistedStore = {
  version: 1;
  rooms: PersistedRoomState[];
};

const DEFAULT_STATE_PATH = resolve(fileURLToPath(new URL('./data/rooms.json', import.meta.url)));

export function stateFilePath(): string {
  return process.env.ADJACENCY_STATE_PATH ?? DEFAULT_STATE_PATH;
}

export function loadPersistedRooms(): PersistedRoomState[] {
  const path = stateFilePath();

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as PersistedStore;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.rooms)) {
      console.warn(`Ignoring invalid state file at ${path}.`);
      return [];
    }
    return parsed.rooms.filter(isPersistedRoomState);
  } catch (error) {
    if (isMissingFileError(error)) return [];
    console.warn(`Could not read persisted rooms from ${path}.`, error);
    return [];
  }
}

export function savePersistedRooms(rooms: PersistedRoomState[]): void {
  const path = stateFilePath();
  const tmpPath = `${path}.tmp`;
  const store: PersistedStore = {
    version: 1,
    rooms,
  };

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  renameSync(tmpPath, path);
}

function isPersistedRoomState(value: unknown): value is PersistedRoomState {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    Array.isArray(value.board) &&
    Array.isArray(value.players) &&
    Array.isArray(value.turnOrder) &&
    Number.isInteger(value.currentTurnIndex) &&
    Array.isArray(value.bag) &&
    Number.isInteger(value.nextTileNumber) &&
    typeof value.teamScore === 'number' &&
    Array.isArray(value.turnHistory) &&
    Number.isInteger(value.nextTurnNumber) &&
    typeof value.updatedAt === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
