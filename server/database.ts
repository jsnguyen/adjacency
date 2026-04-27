import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { BoardLayoutType } from '../shared/boardBonuses.ts';
import type { LastMoveState, TurnHistoryEntryState } from '../shared/states.ts';
import type { Letter } from '../shared/letters.ts';
import type { LetterTileState } from './rules.ts';

export type PersistedPlayerState = {
  id: string;
  claimToken: string;
  name: string;
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

const DEFAULT_DATABASE_PATH = resolve(fileURLToPath(new URL('./data/adjacency_games.sqlite', import.meta.url)));

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
        claim_token TEXT NOT NULL,
        player_name TEXT NOT NULL,
        seat INTEGER NOT NULL,
        rack_json TEXT NOT NULL,
        PRIMARY KEY (game_id, player_id),
        UNIQUE (game_id, seat),
        UNIQUE (game_id, claim_token)
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

  saveGames(games: PersistedGameState[]): void {
    try {
      this.db.exec('BEGIN');
      this.db.exec('DELETE FROM game_turns');
      this.db.exec('DELETE FROM game_players');
      this.db.exec('DELETE FROM games');

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

        for (const player of game.players) {
          this.db.prepare(`
            INSERT INTO game_players (
              game_id,
              player_id,
              claim_token,
              player_name,
              seat,
              rack_json
            ) VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            game.id,
            player.id,
            player.claimToken,
            player.name,
            player.seat,
            JSON.stringify(player.rack),
          );
        }

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
      SELECT game_id, player_id, claim_token, player_name, seat, rack_json
      FROM game_players
      ORDER BY seat ASC
    `).all() as Array<{
      game_id: string;
      player_id: string;
      claim_token: string;
      player_name: string;
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
          claimToken: player.claim_token,
          name: player.player_name,
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

const database = new AdjacencyDatabase();

export function loadPersistedGames(): PersistedGameState[] {
  return database.loadGames();
}

export function savePersistedGames(games: PersistedGameState[]): void {
  database.saveGames(games);
}
