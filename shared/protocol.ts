import type { GameState, MovePreviewState, TileHolderState } from './states.ts';
import type { BoardLayoutType } from './boardBonuses.ts';

export type ClientMessage =
  | { type: 'play_turn'; handState: TileHolderState; boardState: TileHolderState }
  | { type: 'preview_turn'; handState: TileHolderState; boardState: TileHolderState; requestId: number }
  | { type: 'pass_turn' }
  | { type: 'exchange_tiles'; tileIds: string[] }
  | { type: 'set_board_layout'; layout: BoardLayoutType }
  | { type: 'set_single_player'; enabled: boolean }
  | { type: 'reset_game' };

export type ServerMessage =
  | { type: 'game_state'; state: GameState }
  | { type: 'move_preview'; preview: MovePreviewState; requestId: number }
  | { type: 'turn_rejected'; reason: string }
  | { type: 'error'; msg: string };
