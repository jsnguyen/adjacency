import assert from 'node:assert/strict';
import { buildWordSet, coordKey, validateMove } from './rules.ts';
import type { LetterTileState, MoveValidationResult } from './rules.ts';

const words = buildWordSet('CAT CATS AT AX AS ASK');

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
assert.equal(firstMove.wordRuns[0].score, 5);
assert.deepEqual(firstMove.wordRuns[0].cells, [
  { col: 7, row: 7 },
  { col: 8, row: 7 },
  { col: 9, row: 7 },
]);
assert.deepEqual(firstMove.wordRuns[0].anchor, { col: 9, row: 7 });

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
  'makes "CAT"',
);

expectRejected(
  validateMove(
    new Map(),
    rack,
    board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
    buildWordSet('DOG'),
  ),
  'rejects "CAT"',
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

const inferredPluralMove = validateMove(
  committedBoard([
    tile('p', 'P', 7, 7),
    tile('l', 'L', 8, 7),
    tile('a', 'A', 9, 7),
    tile('n', 'N', 10, 7),
  ]),
  [tile('s', 'S', 0, 0)],
  board([
    tile('p', 'P', 7, 7),
    tile('l', 'L', 8, 7),
    tile('a', 'A', 9, 7),
    tile('n', 'N', 10, 7),
    tile('s', 'S', 11, 7),
  ]),
  buildWordSet('PLAN'),
);
expectOk(inferredPluralMove);
assert.deepEqual(inferredPluralMove.words, ['PLANS']);

const inferredIesMove = validateMove(
  new Map(),
  [
    tile('c', 'C', 0, 0),
    tile('r', 'R', 1, 0),
    tile('i', 'I', 2, 0),
    tile('e', 'E', 3, 0),
    tile('s', 'S', 4, 0),
  ],
  board([
    tile('c', 'C', 5, 7),
    tile('r', 'R', 6, 7),
    tile('i', 'I', 7, 7),
    tile('e', 'E', 8, 7),
    tile('s', 'S', 9, 7),
  ]),
  buildWordSet('CRY'),
);
expectOk(inferredIesMove);
assert.deepEqual(inferredIesMove.words, ['CRIES']);

const pluralHookMove = validateMove(
  committedBoard([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
    tile('k', 'K', 10, 8),
  ]),
  [tile('s', 'S', 0, 0)],
  board([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
    tile('k', 'K', 10, 8),
    tile('s', 'S', 10, 7),
  ]),
  words,
);
expectOk(pluralHookMove);
assert.deepEqual(pluralHookMove.words, ['CATS', 'ASK']);

const multipleWordMove = validateMove(
  committedBoard([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
  ]),
  [tile('s', 'S', 0, 0)],
  board([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
    tile('s', 'S', 10, 7),
  ]),
  words,
);
expectOk(multipleWordMove);
assert.deepEqual(multipleWordMove.words, ['CATS', 'AS']);

const invalidCrossWordMove = validateMove(
  committedBoard([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
  ]),
  [tile('s', 'S', 0, 0)],
  board([
    tile('c', 'C', 7, 7),
    tile('a', 'A', 8, 7),
    tile('t', 'T', 9, 7),
    tile('a2', 'A', 10, 6),
    tile('s', 'S', 10, 7),
  ]),
  buildWordSet('CATS'),
);
expectRejected(invalidCrossWordMove, 'makes "CATS", "AS"');
expectRejected(invalidCrossWordMove, 'rejects "AS"');

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

const closedSquareMove = validateMove(
  committedBoard([
    tile('n', 'A', 8, 7),
    tile('s', 'T', 8, 9),
    tile('w', 'C', 7, 8),
    tile('v1', 'C', 9, 7),
    tile('v2', 'T', 9, 9),
  ]),
  [tile('m', 'A', 0, 0)],
  board([
    tile('n', 'A', 8, 7),
    tile('s', 'T', 8, 9),
    tile('w', 'C', 7, 8),
    tile('v1', 'C', 9, 7),
    tile('v2', 'T', 9, 9),
    tile('m', 'A', 9, 8),
  ]),
  words,
);
expectRejected(closedSquareMove, 'closed square');
expectRejected(closedSquareMove, '\\(8,8\\)');

console.log('Rule tests passed.');
