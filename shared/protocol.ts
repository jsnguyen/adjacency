import type { GameState, TileHolderState } from './states.ts';

export type ClientMessage =
  | { type: 'play_turn'; playerId: string; handState: TileHolderState; boardState: TileHolderState }
  | { type: 'pass_turn'; playerId: string }
  | { type: 'exchange_tiles'; playerId: string; tileIds: string[] }
  | { type: 'reset_game'; playerId: string }
  | { type: 'join_room'; roomId: string };

export type ServerMessage =
  | { type: 'player_id'; playerId: string; sessionId: string; roomId: string }
  | { type: 'game_state'; state: GameState }
  | { type: 'turn_rejected'; reason: string }
  | { type: 'error'; msg: string };
