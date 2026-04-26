import type { GameState, TileHolderState } from './states.ts';

export type ClientMessage =
  | { type: 'play_turn'; playerId: string; handState: TileHolderState; boardState: TileHolderState; roomId?: string }
  | { type: 'pass_turn'; playerId: string; roomId?: string }
  | { type: 'exchange_tiles'; playerId: string; tileIds: string[]; roomId?: string }
  | { type: 'join_room'; roomId: string };

export type ServerMessage =
  | { type: 'player_id'; playerId: string }
  | { type: 'game_state'; state: GameState }
  | { type: 'turn_rejected'; reason: string }
  | { type: 'board_is_valid'; boardIsValid: boolean }
  | { type: 'room_created'; roomId: string }
  | { type: 'error'; msg: string };
