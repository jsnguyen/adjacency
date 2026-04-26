export type ClientMessage =
  | { type: 'create_room' }
  | { type: 'join_room'; roomId: string }
  | { type: 'play_turn'; data: unknown };

export type ServerMessage =
  | { type: 'hello'; playerId: string }
  | { type: 'room_created'; roomId: string }
  | { type: 'state'; data: unknown }
  | { type: 'error'; message: string };
