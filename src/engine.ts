const socket = new WebSocket('ws://localhost:8080');

import { GRID, TILE_SIZE, APP_WIDTH } from './constants.ts'
import type { TileHolderState } from '../shared/states.ts'
import { Actions } from './actions.ts'
import { Board } from './board.ts'
import { Hand } from './hand.ts'
import { Tile } from './tile.ts'
import { makeDraggable } from './draggable.ts'
import { setPlayerId, getPlayerId } from './clientState.ts'; // kinda like globals

socket.addEventListener('open', () => {
  console.log('Connected to server');
});

socket.addEventListener('message', (event: MessageEvent) => {
  const msg = JSON.parse(event.data);
  console.log(msg);

  if (msg.type == 'player_id') {
    console.log(`Assigned player id: ${msg.playerId}`)
    setPlayerId(msg.playerId);
  }

});

function sendTurnToServer(handState: TileHolderState, boardState: TileHolderState): void {
  if (socket.readyState !== WebSocket.OPEN) {
    console.warn('Socket is not open yet');
    return;
  }

  const state = {
    type: 'play_turn',
    playerId: getPlayerId(),
    handState: handState,
    boardState: boardState
  };

  socket.send(JSON.stringify(state));
}

const app = document.getElementById('app')
if (!app) {
  throw new Error('Missing #app');
}
app.style.width = APP_WIDTH;

let board = new Board(GRID, app);

let bottomBar = document.createElement('div');
bottomBar.style.height = (TILE_SIZE + GRID.pad * 2) + 'px';
bottomBar.classList.add('bottom-bar')
app.appendChild(bottomBar);

const leftButtonLabels = ['exchange', 'recall', 'shuffle'];
new Actions(3, 'left', bottomBar, leftButtonLabels);

let hand = new Hand(bottomBar);

const rightButtonLabels = ['play', 'pass'];
new Actions(2, 'right', bottomBar, rightButtonLabels);

for (const tile of hand.tiles) {
  tile.dragAbortCallback = makeDraggable(tile, hand, board);
}

const shuffleButton = document.getElementById('shuffle-button')
if (shuffleButton) {
  shuffleButton.addEventListener('click', () => {
    board.recallHand(hand);
    hand.shuffleHand();
  });
}

const recallButton = document.getElementById('recall-button')
if (recallButton) {
  recallButton.addEventListener('click', () => {
    board.recallHand(hand);
  })
}

const playButton = document.getElementById('play-button')
if (playButton) {
  playButton.addEventListener('click', () => {
    board.setAllPlayed();
    const boardState = board.getBoardState();
    const handState = hand.getHandState();
    sendTurnToServer(handState, boardState);
  })
}

//
// make background tiles
//

for (let row = 0; row < board.grid.rows; row++) {
  for (let col = 0; col < board.grid.cols; col++) {
    const bgTile = new Tile(col, row, board, true);
    board.el.appendChild(bgTile.el);
  }
}

for (let col = 0; col < hand.grid.cols; col++) {
  const bgTile = new Tile(col, 0, hand, true);
  hand.el.appendChild(bgTile.el);
}
