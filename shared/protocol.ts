import type { GameState, MovePreviewState, TileHolderState } from './states.ts';
import type { BoardLayoutType } from './boardBonuses.ts';

export type ClientMessage =
  | { type: 'play_turn'; playerId: string; handState: TileHolderState; boardState: TileHolderState }
  | { type: 'preview_turn'; playerId: string; handState: TileHolderState; boardState: TileHolderState; requestId: number }
  | { type: 'pass_turn'; playerId: string }
  | { type: 'exchange_tiles'; playerId: string; tileIds: string[] }
  | { type: 'set_board_layout'; playerId: string; layout: BoardLayoutType }
  | { type: 'reset_game'; playerId: string }
  | { type: 'join_room'; roomId: string; sessionId?: string };

export type ServerMessage =
  | { type: 'player_id'; playerId: string; sessionId: string; roomId: string }
  | { type: 'game_state'; state: GameState }
  | { type: 'move_preview'; preview: MovePreviewState; requestId: number }
  | { type: 'removed_from_room'; roomId: string; msg: string }
  | { type: 'turn_rejected'; reason: string }
  | { type: 'error'; msg: string };
