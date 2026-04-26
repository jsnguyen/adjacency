import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'adjacency-test-db-'));
process.env.ADJACENCY_DB_PATH = join(tempDir, 'adjacency.sqlite');

try {
  await import('./rules.test.ts');
  await import('./gameRoom.test.ts');
  await import('./persistence.test.ts');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
