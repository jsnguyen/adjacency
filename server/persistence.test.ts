import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GameRoom } from './index.ts';
import { loadPersistedRooms, savePersistedRooms } from './persistence.ts';

const tempDir = mkdtempSync(join(tmpdir(), 'adjacency-state-'));
const previousStatePath = process.env.ADJACENCY_STATE_PATH;
process.env.ADJACENCY_STATE_PATH = join(tempDir, 'rooms.json');

try {
  const room = new GameRoom('persist-test');
  room.addPlayer(null, 'session-persist');

  savePersistedRooms([room.toPersistedState()]);
  const persistedRooms = loadPersistedRooms();
  assert.equal(persistedRooms.length, 1);

  const restored = GameRoom.fromPersistedState(persistedRooms[0]);
  const snapshot = restored.snapshot();
  assert.equal(snapshot.roomId, 'persist-test');
  assert.equal(snapshot.players.length, 1);
  assert.equal(snapshot.players[0].rack.tiles.length, 7);
  assert.equal(restored.assignments()[0]?.sessionId, 'session-persist');
} finally {
  if (previousStatePath === undefined) {
    delete process.env.ADJACENCY_STATE_PATH;
  } else {
    process.env.ADJACENCY_STATE_PATH = previousStatePath;
  }
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('Persistence tests passed.');
