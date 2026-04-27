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
const firstPlayer = room.claimSeat('Alice', 1, 'claim-a', null);
const secondPlayer = room.claimSeat('Blair', 2, 'claim-b', null);
assert.ok(firstPlayer);
assert.ok(secondPlayer);

let state = room.snapshot();
assert.equal(state.players.length, 2);
assert.equal(state.players[0]?.name, 'Alice');
assert.equal(state.players[1]?.name, 'Blair');
assert.equal(state.remainingTiles, totalTiles - 14);
assert.equal(state.boardLayout, 'scrabble');
assert.equal(state.canChangeBoardLayout, true);
assert.equal(state.gameId, 'bag-test');

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
assert.equal(state.turnHistory[0]?.playerName, 'Alice');
assert.equal(state.canChangeBoardLayout, false);

const lateLayoutReason = room.setBoardLayout(firstPlayer.id, 'scrabble');
assert.equal(lateLayoutReason, 'Board layout can only change before the first turn.');

const firstRackAfter = state.players.find((player) => player.id === firstPlayer.id)?.rack.tiles ?? [];
assert.equal(firstRackAfter.length, 7);
assert.equal(new Set(firstRackAfter.map((tile) => tile.id)).size, 7);
assert.equal(firstRackAfter.some((tile) => exchangeIds.includes(tile.id)), false);

const resetResult = room.resetGame(firstPlayer.id);
assert.equal(resetResult.ok, true);

state = room.snapshot();
assert.equal(state.players.length, 2);
assert.equal(state.players[0]?.id, firstPlayer.id);
assert.equal(state.players[1]?.id, secondPlayer.id);
assert.equal(state.currentPlayerId, firstPlayer.id);
assert.equal(state.teamScore, 0);
assert.equal(state.turnHistory.length, 0);
assert.equal(state.lastMove, null);
assert.equal(state.boardLayout, 'words-with-friends');
assert.equal(state.canChangeBoardLayout, true);

const finalRoundSeed = new GameRoom('final-round');
const finalRoundFirst = finalRoundSeed.claimSeat('Casey', 1, 'claim-c', null);
const finalRoundSecond = finalRoundSeed.claimSeat('Drew', 2, 'claim-d', null);
assert.ok(finalRoundFirst);
assert.ok(finalRoundSecond);
const finalRoundPersisted = finalRoundSeed.toPersistedState();
finalRoundPersisted.bag = [];
finalRoundPersisted.lastMove = null;
finalRoundPersisted.turnHistory = [];
finalRoundPersisted.nextTurnNumber = 1;

const finalRoundRoom = GameRoom.fromPersistedState(finalRoundPersisted);

state = finalRoundRoom.snapshot();
assert.equal(state.gameEnded, false);
assert.equal(state.finalTurnsRemaining, null);
assert.equal(state.currentPlayerId, finalRoundFirst.id);

assert.equal(finalRoundRoom.passTurn(finalRoundFirst.id), null);
state = finalRoundRoom.snapshot();
assert.equal(state.gameEnded, false);
assert.equal(state.finalTurnsRemaining, 2);
assert.equal(state.currentPlayerId, finalRoundSecond.id);

assert.equal(finalRoundRoom.passTurn(finalRoundSecond.id), null);
state = finalRoundRoom.snapshot();
assert.equal(state.gameEnded, false);
assert.equal(state.finalTurnsRemaining, 1);
assert.equal(state.currentPlayerId, finalRoundFirst.id);

assert.equal(finalRoundRoom.passTurn(finalRoundFirst.id), null);
state = finalRoundRoom.snapshot();
assert.equal(state.gameEnded, true);
assert.equal(state.finalTurnsRemaining, 0);
assert.equal(state.currentPlayerId, null);
assert.equal(finalRoundRoom.passTurn(finalRoundSecond.id), 'Game is over.');

const reconnectRoom = new GameRoom('reconnect-room');
const reconnectFirst = reconnectRoom.claimSeat('Em', 1, 'claim-e', null);
const reconnectSecond = reconnectRoom.claimSeat('Finn', 2, 'claim-f', null);
assert.ok(reconnectFirst);
assert.ok(reconnectSecond);
assert.equal(reconnectRoom.getPlayerByClaimToken('claim-e')?.id, reconnectFirst.id);
assert.equal(reconnectRoom.getPlayerByClaimToken('claim-f')?.id, reconnectSecond.id);
const reconnectSummary = reconnectRoom.summary();
assert.equal(reconnectSummary.players[0]?.name, 'Em');
assert.equal(reconnectSummary.players[1]?.name, 'Finn');

const unnamedRoom = new GameRoom('unnamed-room');
const unnamedFirst = unnamedRoom.claimSeat(null, 1, 'claim-u1', null);
const unnamedSecond = unnamedRoom.claimSeat('', 2, 'claim-u2', null);
assert.ok(unnamedFirst);
assert.ok(unnamedSecond);
assert.equal(unnamedFirst.name, 'Player 1');
assert.equal(unnamedSecond.name, 'Player 2');

console.log('Game room tests passed.');
