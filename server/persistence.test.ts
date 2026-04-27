import assert from 'node:assert/strict';
import { GameRoom } from './index.ts';
import { loadPersistedGames, savePersistedGames } from './database.ts';
import type { PersistedGameState } from './database.ts';

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
assert.equal(snapshot.singlePlayer, false);
assert.equal(snapshot.players[0]?.rack.tiles.length, 7);
assert.equal(restored.getPlayerByClaimToken('claim-alpha')?.id, firstPlayer.id);
assert.equal(restored.getPlayerByClaimToken('claim-beta')?.id, secondPlayer.id);

const soloRoom = new GameRoom('persist-solo');
const soloPlayer = soloRoom.claimSeat('Solo Persist', 1, 'claim-solo-persist', null);
assert.ok(soloPlayer);
assert.equal(soloRoom.setSinglePlayer(soloPlayer.id, true), null);

savePersistedGames([room.toPersistedState(), soloRoom.toPersistedState()]);
const persistedAgain = loadPersistedGames();
const restoredSolo = GameRoom.fromPersistedState(
  persistedAgain.find((game) => game.id === 'persist-solo') ?? persistedAgain[0],
);
assert.equal(restoredSolo.snapshot().singlePlayer, true);

const legacyState = room.toPersistedState() as Partial<PersistedGameState>;
legacyState.players = [...(legacyState.players ?? [])].reverse();
legacyState.turnOrder = [];
legacyState.turnHistory = [{
  turn: 7,
  playerId: firstPlayer.id,
  playerName: firstPlayer.name,
  kind: 'pass',
  words: [],
  totalScore: 0,
  message: 'Passed.',
}];
delete legacyState.nextTileNumber;
delete legacyState.nextTurnNumber;

const restoredLegacy = GameRoom.fromPersistedState(legacyState as PersistedGameState);
assert.equal(restoredLegacy.snapshot().currentPlayerId, firstPlayer.id);
assert.equal(restoredLegacy.passTurn(firstPlayer.id), null);
const legacySnapshot = restoredLegacy.snapshot();
assert.equal(legacySnapshot.turnHistory[0]?.turn, 8);
assert.ok(
  legacySnapshot.players
    .flatMap((player) => player.rack.tiles)
    .every((tile) => /^tile-\d+$/.test(tile.id)),
);

console.log('Persistence tests passed.');
