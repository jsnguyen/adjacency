import type { TileHolderState } from '../shared/states.ts'

export type ClientMessage =
  | { type: 'play_turn'; playerId: string; handState: TileHolderState;  boardState: TileHolderState}
  | { type: 'join_room'; roomId: string };

export type ServerMessage =
  | { type: 'player_id'; playerId: string }
  | { type: 'board_is_valid'; boardIsValid: boolean }
  | { type: 'room_created'; roomId: string }
  | { type: 'error'; msg: string };
