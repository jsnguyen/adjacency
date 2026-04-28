import assert from 'node:assert/strict';
import { buildWordSet, coordKey, previewMove, validateMove } from './rules.ts';
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

function letter(value: string): LetterTileState['letter'] {
  return value as LetterTileState['letter'];
}

function extensionMove(baseWord: string, suffix: string, allowedWords: string): MoveValidationResult {
  const row = 7;
  const startCol = 7;
  const committedTiles = [...baseWord].map((value, index) => (
    tile(`${baseWord}-base-${index}`, letter(value), startCol + index, row)
  ));
  const rackTiles = [...suffix].map((value, index) => (
    tile(`${baseWord}-${suffix}-${index}`, letter(value), index, 0)
  ));
  const playedTiles = rackTiles.map((candidate, index) => ({
    ...candidate,
    col: startCol + baseWord.length + index,
    row,
  }));

  return validateMove(
    committedBoard(committedTiles),
    rackTiles,
    board([...committedTiles, ...playedTiles]),
    buildWordSet(allowedWords),
  );
}

function freshWordMove(word: string, allowedWords: string): MoveValidationResult {
  const row = 7;
  const startCol = 7 - Math.floor(word.length / 2);
  const rackTiles = [...word].map((value, index) => tile(`${word}-${index}`, letter(value), index, 0));
  const playedTiles = rackTiles.map((candidate, index) => ({
    ...candidate,
    col: startCol + index,
    row,
  }));

  return validateMove(new Map(), rackTiles, board(playedTiles), buildWordSet(allowedWords));
}

const rack = [
  tile('c', 'C', 0, 0),
  tile('a', 'A', 1, 0),
  tile('t', 'T', 2, 0),
  tile('s', 'S', 3, 0),
  tile('x', 'X', 4, 0),
];

const blankRack = [
  { id: 'blank-c', letter: null, col: 0, row: 0, isBlank: true },
  tile('blank-a', 'A', 1, 0),
  tile('blank-t', 'T', 2, 0),
];

const firstMove = validateMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  words,
);
expectOk(firstMove);
assert.deepEqual(firstMove.words, ['CAT']);
assert.equal(firstMove.score, 10);
assert.equal(firstMove.wordRuns[0].kind, 'fresh');
assert.equal(firstMove.wordRuns[0].score, 10);
assert.equal(firstMove.wordRuns[0].letterSubtotal, 5);
assert.equal(firstMove.wordRuns[0].wordMultiplier, 2);
assert.deepEqual(firstMove.wordRuns[0].wordBonuses, [
  { col: 7, row: 7, premium: 'double-word', multiplier: 2 },
]);
assert.deepEqual(
  firstMove.wordRuns[0].letters.map((letter) => ({
    letter: letter.letter,
    tileScore: letter.tileScore,
    premium: letter.premium,
  })),
  [
    { letter: 'C', tileScore: 3, premium: 'double-word' },
    { letter: 'A', tileScore: 1, premium: 'normal' },
    { letter: 'T', tileScore: 1, premium: 'normal' },
  ],
);
assert.deepEqual(firstMove.wordRuns[0].cells, [
  { col: 7, row: 7 },
  { col: 8, row: 7 },
  { col: 9, row: 7 },
]);
assert.deepEqual(firstMove.wordRuns[0].anchor, { col: 9, row: 7 });

const blankTileMove = validateMove(
  new Map(),
  blankRack,
  board([
    { id: 'blank-c', letter: 'C', col: 7, row: 7, isBlank: true },
    tile('blank-a', 'A', 8, 7),
    tile('blank-t', 'T', 9, 7),
  ]),
  words,
);
expectOk(blankTileMove);
assert.deepEqual(blankTileMove.words, ['CAT']);
assert.equal(blankTileMove.score, 4);
assert.deepEqual(
  blankTileMove.wordRuns[0].letters.map((letterScore) => ({
    letter: letterScore.letter,
    baseScore: letterScore.baseScore,
    isBlank: letterScore.isBlank,
  })),
  [
    { letter: 'C', baseScore: 0, isBlank: true },
    { letter: 'A', baseScore: 1, isBlank: false },
    { letter: 'T', baseScore: 1, isBlank: false },
  ],
);

const noTwoLetterWordsMove = validateMove(
  new Map(),
  [tile('a-no-two', 'A', 0, 0), tile('t-no-two', 'T', 1, 0)],
  board([tile('a-no-two', 'A', 7, 7), tile('t-no-two', 'T', 8, 7)]),
  buildWordSet('AT'),
  'scrabble',
  'no-two-letter-words',
);
expectRejected(noTwoLetterWordsMove, 'rejects "AT"');

const noThreeLetterWordsMove = validateMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  words,
  'scrabble',
  'no-three-letter-words',
);
expectRejected(noThreeLetterWordsMove, 'rejects "CAT"');

const firstMoveWwf = validateMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  words,
  'words-with-friends',
);
expectOk(firstMoveWwf);
assert.deepEqual(firstMoveWwf.words, ['CAT']);
assert.equal(firstMoveWwf.score, 5);
assert.equal(firstMoveWwf.wordRuns[0].score, 5);
assert.equal(firstMoveWwf.wordRuns[0].letterSubtotal, 5);
assert.equal(firstMoveWwf.wordRuns[0].wordMultiplier, 1);
assert.deepEqual(firstMoveWwf.wordRuns[0].wordBonuses, []);

const correctedWwfTopLeftMove = validateMove(
  committedBoard([
    tile('a-wwf', 'A', 1, 0),
    tile('t-wwf', 'T', 2, 0),
  ]),
  [tile('c-wwf', 'C', 0, 0)],
  board([
    tile('c-wwf', 'C', 0, 0),
    tile('a-wwf', 'A', 1, 0),
    tile('t-wwf', 'T', 2, 0),
  ]),
  words,
  'words-with-friends',
);
expectOk(correctedWwfTopLeftMove);
assert.deepEqual(correctedWwfTopLeftMove.words, ['CAT']);
assert.equal(correctedWwfTopLeftMove.score, 5);
assert.equal(correctedWwfTopLeftMove.wordRuns[0].score, 5);

const firstMoveNyt = validateMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  words,
  'nyt-crossplay',
);
expectOk(firstMoveNyt);
assert.deepEqual(firstMoveNyt.words, ['CAT']);
assert.equal(firstMoveNyt.score, 6);
assert.equal(firstMoveNyt.wordRuns[0].score, 6);

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

const invalidPreview = previewMove(
  new Map(),
  rack,
  board([tile('c', 'C', 7, 7), tile('a', 'A', 8, 7), tile('t', 'T', 9, 7)]),
  buildWordSet('DOG'),
);
assert.equal(invalidPreview.valid, false);
assert.equal(invalidPreview.totalScore, 10);
assert.deepEqual(invalidPreview.words.map((word) => word.word), ['CAT']);
assert.match(invalidPreview.reason ?? '', /CAT/);

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
assert.equal(pluralMove.wordRuns[0].kind, 'extension');

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

const inferredEsPluralMove = extensionMove('BOX', 'ES', 'BOX');
expectOk(inferredEsPluralMove);
assert.deepEqual(inferredEsPluralMove.words, ['BOXES']);
assert.equal(inferredEsPluralMove.wordRuns[0].kind, 'extension');

const pastTenseExtensionMove = extensionMove('TRACK', 'ED', 'TRACK');
expectOk(pastTenseExtensionMove);
assert.deepEqual(pastTenseExtensionMove.words, ['TRACKED']);
assert.equal(pastTenseExtensionMove.wordRuns[0].kind, 'extension');

const irregularPastParticipleExtensionMove = extensionMove('EAT', 'EN', 'EAT');
expectOk(irregularPastParticipleExtensionMove);
assert.deepEqual(irregularPastParticipleExtensionMove.words, ['EATEN']);
assert.equal(irregularPastParticipleExtensionMove.wordRuns[0].kind, 'extension');

const regularEnMove = extensionMove('DARK', 'EN', 'DARK');
expectOk(regularEnMove);
assert.deepEqual(regularEnMove.words, ['DARKEN']);
assert.equal(regularEnMove.wordRuns[0].kind, 'extension');

const inferredPastTenseMove = extensionMove('PLAY', 'ED', 'PLAY');
expectOk(inferredPastTenseMove);
assert.deepEqual(inferredPastTenseMove.words, ['PLAYED']);
assert.equal(inferredPastTenseMove.wordRuns[0].kind, 'extension');

const nearedMove = extensionMove('NEAR', 'ED', 'NEAR');
expectOk(nearedMove);
assert.deepEqual(nearedMove.words, ['NEARED']);

const playingMove = extensionMove('PLAY', 'ING', 'PLAY');
expectOk(playingMove);
assert.deepEqual(playingMove.words, ['PLAYING']);

const trackingMove = extensionMove('TRACK', 'ING', 'TRACK');
expectOk(trackingMove);
assert.deepEqual(trackingMove.words, ['TRACKING']);

const doubledPastTenseMove = extensionMove('STOP', 'PED', 'STOP');
expectOk(doubledPastTenseMove);
assert.deepEqual(doubledPastTenseMove.words, ['STOPPED']);

const droppedEMove = freshWordMove('MAKING', 'MAKE');
expectOk(droppedEMove);
assert.deepEqual(droppedEMove.words, ['MAKING']);

const derivationalMove = freshWordMove('HAPPINESS', 'HAPPY');
expectOk(derivationalMove);
assert.deepEqual(derivationalMove.words, ['HAPPINESS']);

const comparativeMove = extensionMove('NEAR', 'ER', 'NEAR');
expectOk(comparativeMove);
assert.deepEqual(comparativeMove.words, ['NEARER']);

const superlativeMove = extensionMove('NEAR', 'EST', 'NEAR');
expectOk(superlativeMove);
assert.deepEqual(superlativeMove.words, ['NEAREST']);

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
assert.deepEqual(
  pluralHookMove.wordRuns.map((run) => [run.word, run.kind]),
  [['CATS', 'extension'], ['ASK', 'hook']],
);

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
assert.deepEqual(
  multipleWordMove.wordRuns.map((run) => [run.word, run.kind]),
  [['CATS', 'extension'], ['AS', 'hook']],
);

const doubleLetterMove = validateMove(
  committedBoard([
    tile('a1', 'A', 5, 6),
  ]),
  [tile('x1', 'X', 0, 0)],
  board([
    tile('a1', 'A', 5, 6),
    tile('x1', 'X', 6, 6),
  ]),
  words,
);
expectOk(doubleLetterMove);
assert.deepEqual(doubleLetterMove.words, ['AX']);
assert.equal(doubleLetterMove.score, 17);
assert.equal(doubleLetterMove.wordRuns[0].score, 17);

const tripleLetterMove = validateMove(
  committedBoard([
    tile('a2', 'A', 4, 5),
  ]),
  [tile('x2', 'X', 0, 0)],
  board([
    tile('a2', 'A', 4, 5),
    tile('x2', 'X', 5, 5),
  ]),
  words,
);
expectOk(tripleLetterMove);
assert.deepEqual(tripleLetterMove.words, ['AX']);
assert.equal(tripleLetterMove.score, 25);
assert.equal(tripleLetterMove.wordRuns[0].score, 25);

const tripleWordMove = validateMove(
  committedBoard([
    tile('a3', 'A', 1, 0),
    tile('t3', 'T', 2, 0),
  ]),
  [tile('c3', 'C', 0, 0)],
  board([
    tile('c3', 'C', 0, 0),
    tile('a3', 'A', 1, 0),
    tile('t3', 'T', 2, 0),
  ]),
  words,
);
expectOk(tripleWordMove);
assert.deepEqual(tripleWordMove.words, ['CAT']);
assert.equal(tripleWordMove.score, 15);
assert.equal(tripleWordMove.wordRuns[0].score, 15);

const nytCornerTripleLetterMove = validateMove(
  committedBoard([
    tile('a4', 'A', 1, 0),
    tile('t4', 'T', 2, 0),
  ]),
  [tile('c4', 'C', 0, 0)],
  board([
    tile('c4', 'C', 0, 0),
    tile('a4', 'A', 1, 0),
    tile('t4', 'T', 2, 0),
  ]),
  words,
  'nyt-crossplay',
);
expectOk(nytCornerTripleLetterMove);
assert.deepEqual(nytCornerTripleLetterMove.words, ['CAT']);
assert.equal(nytCornerTripleLetterMove.score, 11);
assert.equal(nytCornerTripleLetterMove.wordRuns[0].score, 11);

const sharedBonusCrossMove = validateMove(
  committedBoard([
    tile('a4', 'A', 5, 6),
    tile('a5', 'A', 6, 5),
  ]),
  [tile('x3', 'X', 0, 0)],
  board([
    tile('a4', 'A', 5, 6),
    tile('x3', 'X', 6, 6),
    tile('a5', 'A', 6, 5),
  ]),
  words,
);
expectOk(sharedBonusCrossMove);
assert.deepEqual(sharedBonusCrossMove.words, ['AX', 'AX']);
assert.equal(sharedBonusCrossMove.score, 34);
assert.deepEqual(sharedBonusCrossMove.wordRuns.map((run) => run.score), [17, 17]);

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

const closedSquareWordMove = validateMove(
  committedBoard([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
  ]),
  [
    tile('l', 'L', 0, 0),
    tile('e', 'E', 1, 0),
    tile('t', 'T', 2, 0),
  ],
  board([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
    tile('l', 'L', 6, 8),
    tile('e', 'E', 7, 8),
    tile('t', 'T', 8, 8),
  ]),
  buildWordSet('DIP DAL POT LET'),
);
expectOk(closedSquareWordMove);
assert.deepEqual(closedSquareWordMove.words, ['LET', 'DAL', 'POT']);
assert.equal(closedSquareWordMove.rectangleBonuses.length, 0);

const closedSquareAreaBonusMove = validateMove(
  committedBoard([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
  ]),
  [
    tile('l', 'L', 0, 0),
    tile('e', 'E', 1, 0),
    tile('t', 'T', 2, 0),
  ],
  board([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
    tile('l', 'L', 6, 8),
    tile('e', 'E', 7, 8),
    tile('t', 'T', 8, 8),
  ]),
  buildWordSet('DIP DAL POT LET'),
  'scrabble',
  'standard',
  'closed-rectangle-area',
);
expectOk(closedSquareAreaBonusMove);
assert.deepEqual(closedSquareAreaBonusMove.rectangleBonuses, [{
  minCol: 6,
  minRow: 6,
  maxCol: 8,
  maxRow: 8,
  width: 3,
  height: 3,
  area: 9,
  score: 9,
}]);
assert.equal(closedSquareAreaBonusMove.score, closedSquareWordMove.score + 9);

const alreadyClosedSquareMove = validateMove(
  committedBoard([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
    tile('l', 'L', 6, 8),
    tile('e', 'E', 7, 8),
    tile('t', 'T', 8, 8),
    tile('a2', 'A', 10, 10),
  ]),
  [tile('s2', 'S', 0, 0)],
  board([
    tile('d', 'D', 6, 6),
    tile('i', 'I', 7, 6),
    tile('p', 'P', 8, 6),
    tile('a', 'A', 6, 7),
    tile('o', 'O', 8, 7),
    tile('l', 'L', 6, 8),
    tile('e', 'E', 7, 8),
    tile('t', 'T', 8, 8),
    tile('a2', 'A', 10, 10),
    tile('s2', 'S', 11, 10),
  ]),
  buildWordSet('AS'),
  'scrabble',
  'standard',
  'closed-rectangle-area',
);
expectOk(alreadyClosedSquareMove);
assert.equal(alreadyClosedSquareMove.rectangleBonuses.length, 0);

console.log('Rule tests passed.');
