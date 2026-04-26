import assert from 'node:assert/strict';
import { GameRoom } from './index.ts';
import { loadPersistedGames, loginAccount, savePersistedGames } from './database.ts';

const { account: accountA } = loginAccount('Persist Alpha');
const { account: accountB } = loginAccount('Persist Beta');

const room = new GameRoom('persist-test');
room.addPlayer(accountA, 0, null);
room.addPlayer(accountB, 1, null);

savePersistedGames([room.toPersistedState()]);
const persistedGames = loadPersistedGames();
assert.equal(persistedGames.length, 1);

const restored = GameRoom.fromPersistedState(persistedGames[0]);
const snapshot = restored.snapshot();
assert.equal(snapshot.gameId, 'persist-test');
assert.equal(snapshot.players.length, 2);
assert.equal(snapshot.players[0]?.accountName, 'Persist Alpha');
assert.equal(snapshot.players[1]?.accountName, 'Persist Beta');
assert.equal(snapshot.players[0]?.rack.tiles.length, 7);
assert.equal(restored.assignments()[0]?.accountId, accountA.id);
assert.equal(restored.assignments()[1]?.accountId, accountB.id);

console.log('Persistence tests passed.');
