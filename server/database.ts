import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { BoardLayoutType } from '../shared/boardBonuses.ts';
import type { LastMoveState, TurnHistoryEntryState, AccountState } from '../shared/states.ts';
import type { Letter } from '../shared/letters.ts';
import type { LetterTileState } from './rules.ts';

export type PersistedPlayerState = {
  id: string;
  accountId: string;
  accountName: string;
  seat: number;
  rack: LetterTileState[];
};

export type PersistedGameState = {
  id: string;
  board: LetterTileState[];
  players: PersistedPlayerState[];
  turnOrder: string[];
  currentTurnIndex: number;
  bag: Letter[];
  gameEnded: boolean;
  finalTurnsRemaining: number | null;
  boardLayout: BoardLayoutType;
  nextTileNumber: number;
  teamScore: number;
  lastMove: LastMoveState;
  turnHistory: TurnHistoryEntryState[];
  nextTurnNumber: number;
  createdAt: string;
  updatedAt: string;
};

const DEFAULT_DATABASE_PATH = resolve(fileURLToPath(new URL('./data/adjacency.sqlite', import.meta.url)));

function databasePath(): string {
  return process.env.ADJACENCY_DB_PATH ?? DEFAULT_DATABASE_PATH;
}

class AdjacencyDatabase {
  private readonly db: DatabaseSync;

  constructor(path = databasePath()) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS account_sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        board_json TEXT NOT NULL,
        turn_order_json TEXT NOT NULL,
        current_turn_index INTEGER NOT NULL,
        bag_json TEXT NOT NULL,
        game_ended INTEGER NOT NULL,
        final_turns_remaining INTEGER,
        board_layout TEXT NOT NULL,
        next_tile_number INTEGER NOT NULL,
        team_score INTEGER NOT NULL,
        last_move_json TEXT,
        next_turn_number INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_players (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        player_id TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        account_name TEXT NOT NULL,
        seat INTEGER NOT NULL,
        rack_json TEXT NOT NULL,
        PRIMARY KEY (game_id, player_id),
        UNIQUE (game_id, account_id),
        UNIQUE (game_id, seat)
      );

      CREATE TABLE IF NOT EXISTS game_turns (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        turn_number INTEGER NOT NULL,
        player_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        words_json TEXT NOT NULL,
        total_score INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, turn_number)
      );
    `);
  }

  loginAccount(accountName: string): { account: AccountState; sessionToken: string } {
    const normalizedName = normalizeAccountName(accountName);
    if (!normalizedName) {
      throw new Error('Account names must be 1-24 characters and use letters, numbers, spaces, underscores, or dashes.');
    }

    const now = new Date().toISOString();
    const existing = this.db.prepare(`
      SELECT id, name
      FROM accounts
      WHERE name = ?
    `).get(normalizedName) as { id: string; name: string } | undefined;

    const account = existing ?? {
      id: randomUUID(),
      name: normalizedName,
    };

    if (!existing) {
      this.db.prepare(`
        INSERT INTO accounts (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(account.id, account.name, now, now);
    } else {
      this.db.prepare(`
        UPDATE accounts
        SET updated_at = ?
        WHERE id = ?
      `).run(now, account.id);
    }

    const sessionToken = randomUUID();
    this.db.prepare(`
      INSERT INTO account_sessions (token, account_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(sessionToken, account.id, now, now);

    return { account, sessionToken };
  }

  accountBySession(sessionToken: string): AccountState | null {
    const row = this.db.prepare(`
      SELECT accounts.id AS id, accounts.name AS name
      FROM account_sessions
      INNER JOIN accounts ON accounts.id = account_sessions.account_id
      WHERE account_sessions.token = ?
    `).get(sessionToken) as { id: string; name: string } | undefined;

    if (!row) return null;

    this.db.prepare(`
      UPDATE account_sessions
      SET updated_at = ?
      WHERE token = ?
    `).run(new Date().toISOString(), sessionToken);

    return {
      id: row.id,
      name: row.name,
    };
  }

  accountByName(accountName: string): AccountState | null {
    const normalizedName = normalizeAccountName(accountName);
    if (!normalizedName) return null;

    const row = this.db.prepare(`
      SELECT id, name
      FROM accounts
      WHERE name = ?
    `).get(normalizedName) as { id: string; name: string } | undefined;

    return row ? { id: row.id, name: row.name } : null;
  }

  saveGames(games: PersistedGameState[]): void {
    try {
      this.db.exec('BEGIN');
      for (const game of games) {
        this.db.prepare(`
          INSERT INTO games (
            id,
            board_json,
            turn_order_json,
            current_turn_index,
            bag_json,
            game_ended,
            final_turns_remaining,
            board_layout,
            next_tile_number,
            team_score,
            last_move_json,
            next_turn_number,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            board_json = excluded.board_json,
            turn_order_json = excluded.turn_order_json,
            current_turn_index = excluded.current_turn_index,
            bag_json = excluded.bag_json,
            game_ended = excluded.game_ended,
            final_turns_remaining = excluded.final_turns_remaining,
            board_layout = excluded.board_layout,
            next_tile_number = excluded.next_tile_number,
            team_score = excluded.team_score,
            last_move_json = excluded.last_move_json,
            next_turn_number = excluded.next_turn_number,
            updated_at = excluded.updated_at
        `).run(
          game.id,
          JSON.stringify(game.board),
          JSON.stringify(game.turnOrder),
          game.currentTurnIndex,
          JSON.stringify(game.bag),
          game.gameEnded ? 1 : 0,
          game.finalTurnsRemaining,
          game.boardLayout,
          game.nextTileNumber,
          game.teamScore,
          JSON.stringify(game.lastMove),
          game.nextTurnNumber,
          game.createdAt,
          game.updatedAt,
        );

        this.db.prepare(`DELETE FROM game_players WHERE game_id = ?`).run(game.id);
        for (const player of game.players) {
          this.db.prepare(`
            INSERT INTO game_players (
              game_id,
              player_id,
              account_id,
              account_name,
              seat,
              rack_json
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            game.id,
            player.id,
            player.accountId,
            player.accountName,
            player.seat,
            JSON.stringify(player.rack),
          );
        }

        this.db.prepare(`DELETE FROM game_turns WHERE game_id = ?`).run(game.id);
        for (const turn of game.turnHistory) {
          this.db.prepare(`
            INSERT INTO game_turns (
              game_id,
              turn_number,
              player_id,
              player_name,
              kind,
              words_json,
              total_score,
              message,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            game.id,
            turn.turn,
            turn.playerId,
            turn.playerName,
            turn.kind,
            JSON.stringify(turn.words),
            turn.totalScore,
            turn.message,
            game.updatedAt,
          );
        }
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  loadGames(): PersistedGameState[] {
    const gameRows = this.db.prepare(`
      SELECT
        id,
        board_json,
        turn_order_json,
        current_turn_index,
        bag_json,
        game_ended,
        final_turns_remaining,
        board_layout,
        next_tile_number,
        team_score,
        last_move_json,
        next_turn_number,
        created_at,
        updated_at
      FROM games
      ORDER BY updated_at DESC
    `).all() as Array<{
      id: string;
      board_json: string;
      turn_order_json: string;
      current_turn_index: number;
      bag_json: string;
      game_ended: number;
      final_turns_remaining: number | null;
      board_layout: BoardLayoutType;
      next_tile_number: number;
      team_score: number;
      last_move_json: string | null;
      next_turn_number: number;
      created_at: string;
      updated_at: string;
    }>;

    const playerRows = this.db.prepare(`
      SELECT game_id, player_id, account_id, account_name, seat, rack_json
      FROM game_players
      ORDER BY seat ASC
    `).all() as Array<{
      game_id: string;
      player_id: string;
      account_id: string;
      account_name: string;
      seat: number;
      rack_json: string;
    }>;

    const turnRows = this.db.prepare(`
      SELECT game_id, turn_number, player_id, player_name, kind, words_json, total_score, message
      FROM game_turns
      ORDER BY turn_number DESC
    `).all() as Array<{
      game_id: string;
      turn_number: number;
      player_id: string;
      player_name: string;
      kind: TurnHistoryEntryState['kind'];
      words_json: string;
      total_score: number;
      message: string;
    }>;

    return gameRows.map((row) => ({
      id: row.id,
      board: JSON.parse(row.board_json) as LetterTileState[],
      players: playerRows
        .filter((player) => player.game_id === row.id)
        .map((player) => ({
          id: player.player_id,
          accountId: player.account_id,
          accountName: player.account_name,
          seat: player.seat,
          rack: JSON.parse(player.rack_json) as LetterTileState[],
        })),
      turnOrder: JSON.parse(row.turn_order_json) as string[],
      currentTurnIndex: row.current_turn_index,
      bag: JSON.parse(row.bag_json) as Letter[],
      gameEnded: Boolean(row.game_ended),
      finalTurnsRemaining: row.final_turns_remaining,
      boardLayout: row.board_layout,
      nextTileNumber: row.next_tile_number,
      teamScore: row.team_score,
      lastMove: row.last_move_json ? JSON.parse(row.last_move_json) as LastMoveState : null,
      turnHistory: turnRows
        .filter((turn) => turn.game_id === row.id)
        .map((turn) => ({
          turn: turn.turn_number,
          playerId: turn.player_id,
          playerName: turn.player_name,
          kind: turn.kind,
          words: JSON.parse(turn.words_json) as TurnHistoryEntryState['words'],
          totalScore: turn.total_score,
          message: turn.message,
        })),
      nextTurnNumber: row.next_turn_number,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
}

function normalizeAccountName(accountName: string): string | null {
  const trimmedName = accountName.trim();
  if (!/^[A-Za-z0-9 _-]{1,24}$/.test(trimmedName)) return null;
  return trimmedName;
}

const database = new AdjacencyDatabase();

export function loginAccount(accountName: string): { account: AccountState; sessionToken: string } {
  return database.loginAccount(accountName);
}

export function accountBySession(sessionToken: string): AccountState | null {
  return database.accountBySession(sessionToken);
}

export function accountByName(accountName: string): AccountState | null {
  return database.accountByName(accountName);
}

export function loadPersistedGames(): PersistedGameState[] {
  return database.loadGames();
}

export function savePersistedGames(games: PersistedGameState[]): void {
  database.saveGames(games);
}
