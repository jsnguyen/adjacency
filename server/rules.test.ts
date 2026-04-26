import assert from 'node:assert/strict';
import { buildWordSet, coordKey, validateMove } from './rules.ts';
import type { LetterTileState, MoveValidationResult } from './rules.ts';

const words = buildWordSet('CAT CATS AT AX');

function tile(id: string, letter: LetterTileState['letter'], col: number, row: number): LetterTileState {
  return { id, letter, col, row };
}

function board(tiles: LetterTileState[]) {
  return { name: 'board', tiles };
}

function committedBoard(tiles: LetterTileState[]): Map<string, LetterTileState> {
  return new Map(tiles.map((candidate) => [coordKey(candidate.col, candidate.row), candidate]));
}

function expectOk(result: MoveValidationResult): asserts result is Extract<MoveValidationResult, { ok: true }> {
  assert.equal(result.ok, true, result.ok ? undefined : result.reason);
}

function expectRejected(result: MoveValidationResult, reasonIncludes: string): void {
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.reason, new RegExp(reasonIncludes));
  }
}

const rack = [
  tile('c', 'C', 0, 0),
  tile('a', 'A', 1, 0),
  tile('t', 'T', 2, 0),
  tile('s', 'S', 3, 0),
  tile('x', 'X', 4, 0),
];

const firstMove = validateMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  words,
);
expectOk(firstMove);
assert.deepEqual(firstMove.words, ['CAT']);
assert.equal(firstMove.score, 5);

expectRejected(
  validateMove(
    new Map(),
    rack,
    board([tile('c', 'C', 2, 2), tile('a', 'A', 3, 2), tile('t', 'T', 4, 2)]),
    words,
  ),
  'center',
);

expectRejected(
  validateMove(
    new Map(),
    rack,
    board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
    buildWordSet('DOG'),
  ),
  'word list',
);

const committedCat = committedBoard([
  tile('c', 'C', 7, 7),
  tile('a', 'A', 8, 7),
  tile('t', 'T', 9, 7),
]);

const pluralMove = validateMove(
  committedCat,
  [tile('s', 'S', 0, 0)],
  board([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('s', 'S', 10, 7),
  ]),
  words,
);
expectOk(pluralMove);
assert.deepEqual(pluralMove.words, ['CATS']);

expectRejected(
  validateMove(
    committedCat,
    [tile('s', 'S', 0, 0)],
    board([
      tile('c', 'C', 6, 7),
      tile('a', 'A', 8, 7),
      tile('t', 'T', 9, 7),
      tile('s', 'S', 10, 7),
    ]),
    words,
  ),
  'moved',
);

expectRejected(
  validateMove(
    committedCat,
    [tile('s', 'S', 0, 0)],
    board([
      tile('c', 'C', 7, 7),
      tile('a', 'A', 8, 7),
      tile('t', 'T', 9, 7),
      tile('s', 'S', 1, 1),
    ]),
    words,
  ),
  'connect',
);

expectRejected(
  validateMove(
    new Map(),
    rack,
    board([tile('c', 'C', 7, 7), tile('t', 'T', 9, 7)]),
    words,
  ),
  'gaps',
);

console.log('Rule tests passed.');
