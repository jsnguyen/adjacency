import assert from 'node:assert/strict';
import { TILE_DISTRIBUTION } from '../shared/letters.ts';
import { GameRoom, createBag } from './index.ts';

const totalTiles = Object.values(TILE_DISTRIBUTION).reduce((sum, count) => sum + count, 0);

const bag = createBag();
assert.equal(bag.length, totalTiles);

for (const [letter, expectedCount] of Object.entries(TILE_DISTRIBUTION)) {
  const actualCount = bag.filter((candidate) => candidate === letter).length;
  assert.equal(actualCount, expectedCount, `Unexpected count for ${letter}.`);
}

const room = new GameRoom('bag-test');
const firstPlayer = room.addPlayer(null, 'session-1');
const secondPlayer = room.addPlayer(null, 'session-2');

assert.equal(room.hasOpenSeat(), false);

let state = room.snapshot();
assert.equal(state.players.length, 2);
assert.equal(state.remainingTiles, totalTiles - 14);
assert.equal(state.boardLayout, 'scrabble');
assert.equal(state.canChangeBoardLayout, true);

const nytLayoutReason = room.setBoardLayout(firstPlayer.id, 'nyt-crossplay');
assert.equal(nytLayoutReason, null);

state = room.snapshot();
assert.equal(state.boardLayout, 'nyt-crossplay');
assert.equal(state.canChangeBoardLayout, true);

const layoutReason = room.setBoardLayout(firstPlayer.id, 'words-with-friends');
assert.equal(layoutReason, null);

state = room.snapshot();
assert.equal(state.boardLayout, 'words-with-friends');
assert.equal(state.canChangeBoardLayout, true);

const firstRackBefore = state.players.find((player) => player.id === firstPlayer.id)?.rack.tiles ?? [];
assert.equal(firstRackBefore.length, 7);

const exchangeIds = firstRackBefore.slice(0, 2).map((tile) => tile.id);
const exchangeReason = room.exchangeTiles(firstPlayer.id, exchangeIds);
assert.equal(exchangeReason, null);

state = room.snapshot();
assert.equal(state.remainingTiles, totalTiles - 14);
assert.equal(state.currentPlayerId, secondPlayer.id);
assert.equal(state.turnHistory[0]?.kind, 'exchange');
assert.equal(state.canChangeBoardLayout, false);

const lateLayoutReason = room.setBoardLayout(firstPlayer.id, 'scrabble');
assert.equal(lateLayoutReason, 'Board layout can only change before the first turn.');

const firstRackAfter = state.players.find((player) => player.id === firstPlayer.id)?.rack.tiles ?? [];
assert.equal(firstRackAfter.length, 7);
assert.equal(new Set(firstRackAfter.map((tile) => tile.id)).size, 7);
assert.equal(firstRackAfter.some((tile) => exchangeIds.includes(tile.id)), false);

const resetResult = room.resetGame(firstPlayer.id);
assert.equal(resetResult.ok, true);
if (resetResult.ok) {
  assert.equal(resetResult.evictedPlayers.length, 1);
  assert.equal(resetResult.evictedPlayers[0]?.id, secondPlayer.id);
}

state = room.snapshot();
assert.equal(state.players.length, 1);
assert.equal(state.players[0]?.id, firstPlayer.id);
assert.equal(state.currentPlayerId, firstPlayer.id);
assert.equal(state.teamScore, 0);
assert.equal(state.turnHistory[0]?.kind, 'reset');
assert.equal(state.boardLayout, 'words-with-friends');
assert.equal(state.canChangeBoardLayout, true);

console.log('Game room tests passed.');
