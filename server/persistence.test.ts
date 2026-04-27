import assert from 'node:assert/strict';
import { GameRoom } from './index.ts';
import { loadPersistedGames, savePersistedGames } from './database.ts';

const room = new GameRoom('persist-test');
const firstPlayer = room.claimSeat('Persist Alpha', 1, 'claim-alpha', null);
const secondPlayer = room.claimSeat('Persist Beta', 2, 'claim-beta', null);
assert.ok(firstPlayer);
assert.ok(secondPlayer);

savePersistedGames([room.toPersistedState()]);
const persistedGames = loadPersistedGames();
assert.equal(persistedGames.length, 1);

const restored = GameRoom.fromPersistedState(persistedGames[0]);
const snapshot = restored.snapshot();
assert.equal(snapshot.gameId, 'persist-test');
assert.equal(snapshot.players.length, 2);
assert.equal(snapshot.players[0]?.name, 'Persist Alpha');
assert.equal(snapshot.players[1]?.name, 'Persist Beta');
assert.equal(snapshot.players[0]?.rack.tiles.length, 7);
assert.equal(restored.getPlayerByClaimToken('claim-alpha')?.id, firstPlayer.id);
assert.equal(restored.getPlayerByClaimToken('claim-beta')?.id, secondPlayer.id);

console.log('Persistence tests passed.');
