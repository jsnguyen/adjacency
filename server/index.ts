import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

wss.on('connection', (socket : WebSocket) => {
  const playerId = crypto.randomUUID();

  send(socket, { type: 'hello', playerId });

  socket.on('message', (raw : ServerMessage) => {
    const message = JSON.parse(String(raw)) as ClientMessage;

    switch (message.type) {
      case 'create_room':
        send(socket, { type: 'room_created', roomId: crypto.randomUUID() });
        break;

      case 'join_room':
        send(socket, { type: 'state', data: { roomId: message.roomId } });
        break;

      case 'play_turn':
        send(socket, { type: 'state', data: message.data });
        break;
    }
  });
});

console.log(`Server listening on ws://localhost:${PORT}`);
