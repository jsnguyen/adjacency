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
assert.equal(snapshot.wordLengthRule, 'standard');
assert.equal(snapshot.areaBonusRule, 'none');
assert.equal(snapshot.players[0]?.rack.tiles.length, 7);
assert.equal(restored.getPlayerByClaimToken('claim-alpha')?.id, firstPlayer.id);
assert.equal(restored.getPlayerByClaimToken('claim-beta')?.id, secondPlayer.id);

const soloRoom = new GameRoom('persist-solo');
const soloPlayer = soloRoom.claimSeat('Solo Persist', 1, 'claim-solo-persist', null);
assert.ok(soloPlayer);
assert.equal(soloRoom.setSinglePlayer(soloPlayer.id, true), null);
assert.equal(soloRoom.setWordLengthRule(soloPlayer.id, 'no-three-letter-words'), null);
assert.equal(soloRoom.setAreaBonusRule(soloPlayer.id, 'closed-rectangle-area'), null);

savePersistedGames([room.toPersistedState(), soloRoom.toPersistedState()]);
const persistedAgain = loadPersistedGames();
const restoredSolo = GameRoom.fromPersistedState(
  persistedAgain.find((game) => game.id === 'persist-solo') ?? persistedAgain[0],
);
assert.equal(restoredSolo.snapshot().singlePlayer, true);
assert.equal(restoredSolo.snapshot().wordLengthRule, 'no-three-letter-words');
assert.equal(restoredSolo.snapshot().areaBonusRule, 'closed-rectangle-area');

const legacyState = room.toPersistedState() as Partial<PersistedGameState>;
legacyState.players = [...(legacyState.players ?? [])].reverse();
legacyState.turnOrder = [];
legacyState.turnHistory = [{
  turn: 7,
  playerId: firstPlayer.id,
  playerName: firstPlayer.name,
  kind: 'pass',
  words: [],
  rectangleBonuses: [],
  totalScore: 0,
  message: 'Passed.',
}];
delete legacyState.nextTileNumber;
delete legacyState.nextTurnNumber;
delete legacyState.wordLengthRule;
delete legacyState.areaBonusRule;

const restoredLegacy = GameRoom.fromPersistedState(legacyState as PersistedGameState);
assert.equal(restoredLegacy.snapshot().currentPlayerId, firstPlayer.id);
assert.equal(restoredLegacy.passTurn(firstPlayer.id), null);
const legacySnapshot = restoredLegacy.snapshot();
assert.equal(legacySnapshot.wordLengthRule, 'standard');
assert.equal(legacySnapshot.areaBonusRule, 'none');
assert.equal(legacySnapshot.turnHistory[0]?.turn, 8);
assert.ok(
  legacySnapshot.players
    .flatMap((player) => player.rack.tiles)
    .every((tile) => /^tile-\d+$/.test(tile.id)),
);

const oldAreaState = room.toPersistedState();
oldAreaState.teamScore = 4;
oldAreaState.lastMove = {
  playerId: firstPlayer.id,
  playerName: firstPlayer.name,
  words: ['LET'],
  score: 4,
  message: 'Played LET for 4 points.',
};
oldAreaState.turnHistory = [{
  turn: 1,
  playerId: firstPlayer.id,
  playerName: firstPlayer.name,
  kind: 'play',
  words: [],
  rectangleBonuses: [{
    minCol: 6,
    minRow: 6,
    maxCol: 8,
    maxRow: 8,
    width: 2,
    height: 2,
    area: 4,
    score: 4,
  }],
  totalScore: 4,
  message: 'Played LET for 4 points.',
}];

const restoredOldArea = GameRoom.fromPersistedState(oldAreaState);
const oldAreaSnapshot = restoredOldArea.snapshot();
assert.equal(oldAreaSnapshot.teamScore, 9);
assert.equal(oldAreaSnapshot.lastMove?.score, 9);
assert.equal(oldAreaSnapshot.turnHistory[0]?.totalScore, 9);
assert.deepEqual(oldAreaSnapshot.turnHistory[0]?.rectangleBonuses[0], {
  minCol: 6,
  minRow: 6,
  maxCol: 8,
  maxRow: 8,
  width: 3,
  height: 3,
  area: 9,
  score: 9,
});

console.log('Persistence tests passed.');
