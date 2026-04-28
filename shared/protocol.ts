import type { GameState, MovePreviewState, TileHolderState } from './states.ts';
import type { BoardLayoutType } from './boardBonuses.ts';
import type { AreaBonusRule, WordLengthRule } from './ruleSets.ts';

export type ClientMessage =
  | { type: 'play_turn'; handState: TileHolderState; boardState: TileHolderState }
  | { type: 'preview_turn'; handState: TileHolderState; boardState: TileHolderState; requestId: number }
  | { type: 'pass_turn' }
  | { type: 'exchange_tiles'; tileIds: string[] }
  | { type: 'set_board_layout'; layout: BoardLayoutType }
  | { type: 'set_word_length_rule'; rule: WordLengthRule }
  | { type: 'set_area_bonus_rule'; rule: AreaBonusRule }
  | { type: 'set_single_player'; enabled: boolean }
  | { type: 'reset_game' };

export type ServerMessage =
  | { type: 'game_state'; state: GameState }
  | { type: 'move_preview'; preview: MovePreviewState; requestId: number }
  | { type: 'turn_rejected'; reason: string }
  | { type: 'error'; msg: string };
