import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';
import type { TileHolderState } from '../shared/states.ts'

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

function send(socket: WebSocket, msg: ServerMessage): void {
  socket.send(JSON.stringify(msg));
}

function verifyBoard(socket: WebSocket, handState: TileHolderState, boardState: TileHolderState) {
  socket.send(JSON.stringify({type: 'board_is_valid', boardIsValid: true}))
}

wss.on('connection', (socket : WebSocket) => {
  const playerId = crypto.randomUUID();
  send(socket, { type: 'player_id', playerId });

  socket.on('message', (raw : ServerMessage) => {
    const msg = JSON.parse(String(raw)) as ClientMessage;

    switch (msg.type) {
      case 'play_turn':
        console.log(msg.handState);
        console.log(msg.boardState);
        console.log(msg.playerId);
        verifyBoard(socket, msg.handState, msg.boardState);
        break;
    }

  });
});

console.log(`Server listening on ws://localhost:${PORT}`);
