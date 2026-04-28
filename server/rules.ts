import { LETTER_VALUES } from '../shared/letters.ts';
import type { Letter } from '../shared/letters.ts';
import {
  letterMultiplierAt,
  premiumSquareAt,
  type BoardLayoutType,
  wordMultiplierAt,
} from '../shared/boardBonuses.ts';
import type {
  MovePreviewState,
  PreviewCellState,
  PreviewWordState,
  RectangleBonusState,
  TileHolderState,
  TileState,
  WordBonusState,
  WordBuildKind,
  WordLetterScoreState,
} from '../shared/states.ts';
import { minimumWordLengthForRule, type AreaBonusRule, type WordLengthRule } from '../shared/ruleSets.ts';

export const BOARD_COLS = 15;
export const BOARD_ROWS = 15;
export const RACK_SIZE = 7;
export const CENTER_COL = Math.floor(BOARD_COLS / 2);
export const CENTER_ROW = Math.floor(BOARD_ROWS / 2);

export type LetterTileState = TileState & { letter: Letter; isBlank?: boolean };
export type RackTileState = TileState & { letter: Letter | null; isBlank?: boolean };

export type MoveValidationResult =
  | {
    ok: true;
    newTiles: LetterTileState[];
    words: string[];
    score: number;
    wordRuns: PreviewWordState[];
    rectangleBonuses: RectangleBonusState[];
  }
  | { ok: false; reason: string };

type WordRun = {
  key: string;
  kind: WordBuildKind;
  word: string;
  cells: PreviewCellState[];
  tiles: LetterTileState[];
  anchor: PreviewCellState;
};

type ScoreBreakdown = {
  letters: WordLetterScoreState[];
  letterSubtotal: number;
  wordMultiplier: number;
  wordBonuses: WordBonusState[];
  score: number;
};

const IRREGULAR_DERIVED_BASES = new Map<string, string[]>([
  ['ATE', ['EAT']],
  ['EATEN', ['EAT']],
  ['WENT', ['GO']],
  ['GONE', ['GO']],
  ['WAS', ['BE']],
  ['WERE', ['BE']],
  ['BEEN', ['BE']],
  ['DID', ['DO']],
  ['DONE', ['DO']],
  ['HAD', ['HAVE']],
  ['MADE', ['MAKE']],
  ['CAME', ['COME']],
  ['SAID', ['SAY']],
  ['PAID', ['PAY']],
  ['RAN', ['RUN']],
  ['SAW', ['SEE']],
  ['SEEN', ['SEE']],
  ['TOOK', ['TAKE']],
  ['TAKEN', ['TAKE']],
  ['GAVE', ['GIVE']],
  ['GIVEN', ['GIVE']],
  ['WROTE', ['WRITE']],
  ['WRITTEN', ['WRITE']],
  ['DROVE', ['DRIVE']],
  ['DRIVEN', ['DRIVE']],
  ['RODE', ['RIDE']],
  ['RIDDEN', ['RIDE']],
  ['SPOKE', ['SPEAK']],
  ['SPOKEN', ['SPEAK']],
  ['BROKE', ['BREAK']],
  ['BROKEN', ['BREAK']],
  ['CHOSE', ['CHOOSE']],
  ['CHOSEN', ['CHOOSE']],
  ['STOLE', ['STEAL']],
  ['STOLEN', ['STEAL']],
  ['FELL', ['FALL']],
  ['FALLEN', ['FALL']],
  ['FOUND', ['FIND']],
  ['LOST', ['LOSE']],
  ['BOUGHT', ['BUY']],
  ['BROUGHT', ['BRING']],
  ['THOUGHT', ['THINK']],
  ['TAUGHT', ['TEACH']],
  ['CAUGHT', ['CATCH']],
  ['KEPT', ['KEEP']],
  ['SLEPT', ['SLEEP']],
  ['LEFT', ['LEAVE']],
  ['FELT', ['FEEL']],
  ['HEARD', ['HEAR']],
  ['MET', ['MEET']],
  ['SOLD', ['SELL']],
  ['TOLD', ['TELL']],
  ['STOOD', ['STAND']],
  ['UNDERSTOOD', ['UNDERSTAND']],
  ['WON', ['WIN']],
  ['WORE', ['WEAR']],
  ['WORN', ['WEAR']],
  ['DREW', ['DRAW']],
  ['DRAWN', ['DRAW']],
  ['FLEW', ['FLY']],
  ['FLOWN', ['FLY']],
  ['KNEW', ['KNOW']],
  ['KNOWN', ['KNOW']],
  ['GREW', ['GROW']],
  ['GROWN', ['GROW']],
  ['THREW', ['THROW']],
  ['THROWN', ['THROW']],
  ['BEGAN', ['BEGIN']],
  ['BEGUN', ['BEGIN']],
  ['DRANK', ['DRINK']],
  ['DRUNK', ['DRINK']],
  ['SANG', ['SING']],
  ['SUNG', ['SING']],
  ['SWAM', ['SWIM']],
  ['SWUM', ['SWIM']],
]);

type AnalyzedMove = {
  newTiles: LetterTileState[];
  words: string[];
  score: number;
  wordRuns: PreviewWordState[];
  rectangleBonuses: RectangleBonusState[];
  invalidWords: string[];
};

export function coordKey(col: number, row: number): string {
  return `${col}:${row}`;
}

export function buildWordSet(rawWords: string | undefined): Set<string> {
  if (!rawWords) return new Set();
  return new Set(
    rawWords
      .split(/[,\s]+/)
      .map((word) => word.trim().toUpperCase())
      .filter((word) => /^[A-Z]{2,15}$/.test(word)),
  );
}

export function validateMove(
  committedBoard: Map<string, LetterTileState>,
  playerRack: RackTileState[],
  submittedBoard: TileHolderState,
  allowedWords: Set<string>,
  boardLayout: BoardLayoutType = 'scrabble',
  wordLengthRule: WordLengthRule = 'standard',
  areaBonusRule: AreaBonusRule = 'none',
): MoveValidationResult {
  const analyzedMove = analyzeMove(
    committedBoard,
    playerRack,
    submittedBoard,
    allowedWords,
    boardLayout,
    wordLengthRule,
    areaBonusRule,
  );
  if (!analyzedMove.ok) return analyzedMove;

  if (analyzedMove.invalidWords.length > 0) {
    return {
      ok: false,
      reason: invalidMoveReason(analyzedMove.words, analyzedMove.invalidWords),
    };
  }

  return {
    ok: true,
    newTiles: analyzedMove.newTiles,
    words: analyzedMove.words,
    score: analyzedMove.score,
    wordRuns: analyzedMove.wordRuns,
    rectangleBonuses: analyzedMove.rectangleBonuses,
  };
}

export function previewMove(
  committedBoard: Map<string, LetterTileState>,
  playerRack: RackTileState[],
  submittedBoard: TileHolderState,
  allowedWords: Set<string>,
  boardLayout: BoardLayoutType = 'scrabble',
  wordLengthRule: WordLengthRule = 'standard',
  areaBonusRule: AreaBonusRule = 'none',
): MovePreviewState {
  const analyzedMove = analyzeMove(
    committedBoard,
    playerRack,
    submittedBoard,
    allowedWords,
    boardLayout,
    wordLengthRule,
    areaBonusRule,
  );
  if (!analyzedMove.ok) {
    return { valid: false, words: [], rectangleBonuses: [], totalScore: 0, reason: analyzedMove.reason };
  }

  const reason = analyzedMove.invalidWords.length > 0
    ? invalidMoveReason(analyzedMove.words, analyzedMove.invalidWords)
    : null;

  return {
    valid: reason === null,
    words: analyzedMove.wordRuns,
    rectangleBonuses: analyzedMove.rectangleBonuses,
    totalScore: analyzedMove.score,
    reason,
  };
}

function analyzeMove(
  committedBoard: Map<string, LetterTileState>,
  playerRack: RackTileState[],
  submittedBoard: TileHolderState,
  allowedWords: Set<string>,
  boardLayout: BoardLayoutType,
  wordLengthRule: WordLengthRule,
  areaBonusRule: AreaBonusRule,
): ({ ok: true } & AnalyzedMove) | { ok: false; reason: string } {
  const submittedTiles = normaliseSubmittedTiles(submittedBoard);
  if (!submittedTiles.ok) return submittedTiles;

  const committedById = new Map([...committedBoard.values()].map((tile) => [tile.id, tile]));
  const rackById = new Map(playerRack.map((tile) => [tile.id, tile]));
  const submittedById = new Map(submittedTiles.tiles.map((tile) => [tile.id, tile]));

  for (const committedTile of committedBoard.values()) {
    const submittedTile = submittedById.get(committedTile.id);
    if (!submittedTile) {
      return { ok: false, reason: 'Committed tiles cannot be removed from the board.' };
    }
    if (
      submittedTile.letter !== committedTile.letter ||
      Boolean(submittedTile.isBlank) !== Boolean(committedTile.isBlank) ||
      submittedTile.col !== committedTile.col ||
      submittedTile.row !== committedTile.row
    ) {
      return { ok: false, reason: 'Committed tiles cannot be moved or changed.' };
    }
  }

  const newTiles: LetterTileState[] = [];
  for (const submittedTile of submittedTiles.tiles) {
    if (committedById.has(submittedTile.id)) continue;

    const rackTile = rackById.get(submittedTile.id);
    if (!rackTile) {
      return { ok: false, reason: 'The move includes a tile that is not in your rack.' };
    }
    if (rackTile.isBlank) {
      submittedTile.isBlank = true;
    } else if (rackTile.letter !== submittedTile.letter || submittedTile.isBlank) {
      return { ok: false, reason: 'Rack tile letters cannot be changed.' };
    }
    if (committedBoard.has(coordKey(submittedTile.col, submittedTile.row))) {
      return { ok: false, reason: 'A new tile overlaps a committed tile.' };
    }
    newTiles.push(submittedTile);
  }

  if (newTiles.length === 0) {
    return { ok: false, reason: 'Play at least one tile before submitting a turn.' };
  }

  const proposedBoard = new Map(committedBoard);
  for (const tile of newTiles) {
    proposedBoard.set(coordKey(tile.col, tile.row), tile);
  }

  const lineResult = validateLine(newTiles, proposedBoard);
  if (!lineResult.ok) return lineResult;

  const connectionResult = validateConnection(committedBoard, newTiles);
  if (!connectionResult.ok) return connectionResult;

  const wordRuns = collectWords(newTiles, proposedBoard, committedBoard, lineResult.direction, boardLayout);
  if (wordRuns.length === 0) {
    return { ok: false, reason: 'Every submitted turn must form at least one word.' };
  }
  const words = wordRuns.map((run) => run.word);

  const invalidWords = words.filter((word) => !isWordAllowed(word, allowedWords, wordLengthRule));
  const rectangleBonuses = areaBonusRule === 'closed-rectangle-area'
    ? collectClosedRectangleBonuses(committedBoard, proposedBoard, newTiles)
    : [];
  const wordScore = wordRuns.reduce((total, run) => total + run.score, 0);
  const rectangleScore = rectangleBonuses.reduce((total, bonus) => total + bonus.score, 0);
  const score = wordScore + rectangleScore;
  return {
    ok: true,
    newTiles,
    words,
    score,
    rectangleBonuses,
    invalidWords,
    wordRuns: wordRuns.map((run) => ({
      kind: run.kind,
      word: run.word,
      score: run.score,
      letters: run.letters,
      letterSubtotal: run.letterSubtotal,
      wordMultiplier: run.wordMultiplier,
      wordBonuses: run.wordBonuses,
      cells: run.cells,
      anchor: run.anchor,
    })),
  };
}

function normaliseSubmittedTiles(
  submittedBoard: TileHolderState,
): { ok: true; tiles: LetterTileState[] } | { ok: false; reason: string } {
  const coordKeys = new Set<string>();
  const tileIds = new Set<string>();
  const tiles: LetterTileState[] = [];

  for (const tile of submittedBoard.tiles) {
    if (!Number.isInteger(tile.col) || !Number.isInteger(tile.row)) {
      return { ok: false, reason: 'Tile coordinates must be whole board cells.' };
    }
    if (tile.col < 0 || tile.col >= BOARD_COLS || tile.row < 0 || tile.row >= BOARD_ROWS) {
      return { ok: false, reason: 'A tile is outside the board.' };
    }
    if (!isLetter(tile.letter)) {
      return { ok: false, reason: 'Every played tile must have a letter.' };
    }

    const positionKey = coordKey(tile.col, tile.row);
    if (coordKeys.has(positionKey)) {
      return { ok: false, reason: 'Two tiles cannot occupy the same board cell.' };
    }
    coordKeys.add(positionKey);

    if (tileIds.has(tile.id)) {
      return { ok: false, reason: 'The board contains a duplicate tile id.' };
    }
    tileIds.add(tile.id);

    tiles.push({ id: tile.id, letter: tile.letter, col: tile.col, row: tile.row, isBlank: Boolean(tile.isBlank) });
  }

  return { ok: true, tiles };
}

function collectClosedRectangleBonuses(
  committedBoard: Map<string, LetterTileState>,
  proposedBoard: Map<string, LetterTileState>,
  newTiles: LetterTileState[],
): RectangleBonusState[] {
  const newTileKeys = new Set(newTiles.map((tile) => coordKey(tile.col, tile.row)));
  const occupiedCells = [...proposedBoard.values()];
  const cols = [...new Set(occupiedCells.map((tile) => tile.col))].sort((left, right) => left - right);
  const rows = [...new Set(occupiedCells.map((tile) => tile.row))].sort((left, right) => left - right);
  const bonuses: RectangleBonusState[] = [];

  for (let leftIndex = 0; leftIndex < cols.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cols.length; rightIndex += 1) {
      const minCol = cols[leftIndex];
      const maxCol = cols[rightIndex];
      for (let topIndex = 0; topIndex < rows.length; topIndex += 1) {
        for (let bottomIndex = topIndex + 1; bottomIndex < rows.length; bottomIndex += 1) {
          const minRow = rows[topIndex];
          const maxRow = rows[bottomIndex];
          if (!rectanglePerimeterIsOccupied(proposedBoard, minCol, minRow, maxCol, maxRow)) continue;
          if (rectanglePerimeterIsOccupied(committedBoard, minCol, minRow, maxCol, maxRow)) continue;
          if (!rectanglePerimeterTouchesKeys(newTileKeys, minCol, minRow, maxCol, maxRow)) continue;

          const width = maxCol - minCol + 1;
          const height = maxRow - minRow + 1;
          const area = width * height;
          bonuses.push({
            minCol,
            minRow,
            maxCol,
            maxRow,
            width,
            height,
            area,
            score: area,
          });
        }
      }
    }
  }

  return bonuses.sort((left, right) => (
    right.area - left.area ||
    left.minRow - right.minRow ||
    left.minCol - right.minCol ||
    left.maxRow - right.maxRow ||
    left.maxCol - right.maxCol
  ));
}

function rectanglePerimeterIsOccupied(
  board: Map<string, LetterTileState>,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): boolean {
  for (let col = minCol; col <= maxCol; col += 1) {
    if (!board.has(coordKey(col, minRow)) || !board.has(coordKey(col, maxRow))) return false;
  }
  for (let row = minRow + 1; row < maxRow; row += 1) {
    if (!board.has(coordKey(minCol, row)) || !board.has(coordKey(maxCol, row))) return false;
  }
  return true;
}

function rectanglePerimeterTouchesKeys(
  keys: Set<string>,
  minCol: number,
  minRow: number,
  maxCol: number,
  maxRow: number,
): boolean {
  for (let col = minCol; col <= maxCol; col += 1) {
    if (keys.has(coordKey(col, minRow)) || keys.has(coordKey(col, maxRow))) return true;
  }
  for (let row = minRow + 1; row < maxRow; row += 1) {
    if (keys.has(coordKey(minCol, row)) || keys.has(coordKey(maxCol, row))) return true;
  }
  return false;
}

function validateLine(
  newTiles: LetterTileState[],
  proposedBoard: Map<string, LetterTileState>,
): { ok: true; direction: 'horizontal' | 'vertical' | 'single' } | { ok: false; reason: string } {
  if (newTiles.length === 1) {
    return { ok: true, direction: 'single' };
  }

  const rows = new Set(newTiles.map((tile) => tile.row));
  const cols = new Set(newTiles.map((tile) => tile.col));
  const sameRow = rows.size === 1;
  const sameCol = cols.size === 1;

  if (!sameRow && !sameCol) {
    return { ok: false, reason: 'New tiles must be placed in a single row or column.' };
  }

  if (sameRow) {
    const row = newTiles[0].row;
    const minCol = Math.min(...newTiles.map((tile) => tile.col));
    const maxCol = Math.max(...newTiles.map((tile) => tile.col));
    for (let col = minCol; col <= maxCol; col += 1) {
      if (!proposedBoard.has(coordKey(col, row))) {
        return { ok: false, reason: 'New tiles cannot leave gaps in the played word.' };
      }
    }
    return { ok: true, direction: 'horizontal' };
  }

  const col = newTiles[0].col;
  const minRow = Math.min(...newTiles.map((tile) => tile.row));
  const maxRow = Math.max(...newTiles.map((tile) => tile.row));
  for (let row = minRow; row <= maxRow; row += 1) {
    if (!proposedBoard.has(coordKey(col, row))) {
      return { ok: false, reason: 'New tiles cannot leave gaps in the played word.' };
    }
  }
  return { ok: true, direction: 'vertical' };
}

function validateConnection(
  committedBoard: Map<string, LetterTileState>,
  newTiles: LetterTileState[],
): { ok: true } | { ok: false; reason: string } {
  if (committedBoard.size === 0) {
    const crossesCenter = newTiles.some((tile) => tile.col === CENTER_COL && tile.row === CENTER_ROW);
    if (!crossesCenter) {
      return { ok: false, reason: 'The first word must cross the center square.' };
    }
    return { ok: true };
  }

  const touchesCommittedTile = newTiles.some((tile) => (
    committedBoard.has(coordKey(tile.col - 1, tile.row)) ||
    committedBoard.has(coordKey(tile.col + 1, tile.row)) ||
    committedBoard.has(coordKey(tile.col, tile.row - 1)) ||
    committedBoard.has(coordKey(tile.col, tile.row + 1))
  ));

  if (!touchesCommittedTile) {
    return { ok: false, reason: 'Each move must connect to the existing board.' };
  }
  return { ok: true };
}

function collectWords(
  newTiles: LetterTileState[],
  board: Map<string, LetterTileState>,
  committedBoard: Map<string, LetterTileState>,
  direction: 'horizontal' | 'vertical' | 'single',
  boardLayout: BoardLayoutType,
): Array<WordRun & ScoreBreakdown> {
  const wordsByKey = new Map<string, WordRun>();
  const addRun = (run: WordRun) => {
    if (run.word.length > 1) {
      wordsByKey.set(run.key, run);
    }
  };

  if (direction === 'horizontal') {
    addRun(collectWordRun(newTiles[0], board, 1, 0));
    for (const tile of newTiles) {
      addRun(collectWordRun(tile, board, 0, 1));
    }
  } else if (direction === 'vertical') {
    addRun(collectWordRun(newTiles[0], board, 0, 1));
    for (const tile of newTiles) {
      addRun(collectWordRun(tile, board, 1, 0));
    }
  } else {
    addRun(collectWordRun(newTiles[0], board, 1, 0));
    addRun(collectWordRun(newTiles[0], board, 0, 1));
  }

  return [...wordsByKey.values()].map((run) => ({
    ...run,
    kind: classifyWordRun(run, committedBoard),
    ...scoreWordRun(run, committedBoard, boardLayout),
  }));
}

function collectWordRun(
  startTile: LetterTileState,
  board: Map<string, LetterTileState>,
  deltaCol: number,
  deltaRow: number,
): WordRun {
  let startCol = startTile.col;
  let startRow = startTile.row;
  while (board.has(coordKey(startCol - deltaCol, startRow - deltaRow))) {
    startCol -= deltaCol;
    startRow -= deltaRow;
  }

  const letters: Letter[] = [];
  const cells: PreviewCellState[] = [];
  const tiles: LetterTileState[] = [];
  let endCol = startCol;
  let endRow = startRow;
  while (true) {
    const tile = board.get(coordKey(endCol, endRow));
    if (!tile) break;
    letters.push(tile.letter);
    cells.push({ col: endCol, row: endRow });
    tiles.push(tile);
    endCol += deltaCol;
    endRow += deltaRow;
  }

  const key = `${startCol}:${startRow}:${endCol - deltaCol}:${endRow - deltaRow}`;
  return {
    key,
    kind: 'fresh',
    word: letters.join(''),
    cells,
    tiles,
    anchor: wordAnchor(cells),
  };
}

function classifyWordRun(
  run: Pick<WordRun, 'cells'>,
  committedBoard: Map<string, LetterTileState>,
): WordBuildKind {
  let committedCellCount = 0;
  let longestCommittedSegment = 0;
  let currentCommittedSegment = 0;

  for (const cell of run.cells) {
    if (committedBoard.has(coordKey(cell.col, cell.row))) {
      committedCellCount += 1;
      currentCommittedSegment += 1;
      if (currentCommittedSegment > longestCommittedSegment) {
        longestCommittedSegment = currentCommittedSegment;
      }
    } else {
      currentCommittedSegment = 0;
    }
  }

  if (committedCellCount === 0) {
    return 'fresh';
  }
  if (longestCommittedSegment >= 2) {
    return 'extension';
  }
  return 'hook';
}

function invalidMoveReason(
  words: string[],
  invalidWords: string[],
): string {
  const messages: string[] = [];

  if (words.length > 0) {
    messages.push(`This move makes ${formatWordList(words)}.`);
  }
  if (invalidWords.length > 0) {
    messages.push(`The dictionary rejects ${formatWordList(invalidWords)}.`);
  }

  return messages.join(' ');
}

function formatWordList(words: string[]): string {
  return words.map((word) => `"${word}"`).join(', ');
}

function isWordAllowed(word: string, allowedWords: Set<string>, wordLengthRule: WordLengthRule): boolean {
  if (word.length < minimumWordLengthForRule(wordLengthRule)) {
    return false;
  }

  if (allowedWords.size === 0) {
    return /^[A-Z]{2,}$/.test(word);
  }
  return allowedWords.has(word) ||
    matchesRegularPlural(word, allowedWords) ||
    matchesDerivedWord(word, allowedWords);
}

function matchesRegularPlural(word: string, allowedWords: Set<string>): boolean {
  if (word.length < 3 || !word.endsWith('S')) {
    return false;
  }

  if (word.endsWith('IES') && word.length > 4) {
    const singularY = `${word.slice(0, -3)}Y`;
    if (allowedWords.has(singularY)) {
      return true;
    }
  }

  if (word.endsWith('VES') && word.length > 4) {
    const singularF = `${word.slice(0, -3)}F`;
    const singularFe = `${word.slice(0, -3)}FE`;
    if (allowedWords.has(singularF) || allowedWords.has(singularFe)) {
      return true;
    }
  }

  if (word.endsWith('ES') && word.length > 3) {
    const singularEs = word.slice(0, -2);
    if (takesEsPlural(singularEs) && allowedWords.has(singularEs)) {
      return true;
    }

    if (word.endsWith('ZZES')) {
      const singularZ = word.slice(0, -3);
      if (allowedWords.has(singularZ)) {
        return true;
      }
    }
  }

  const singularS = word.slice(0, -1);
  return allowedWords.has(singularS);
}

function takesEsPlural(word: string): boolean {
  return (
    word.endsWith('S') ||
    word.endsWith('X') ||
    word.endsWith('Z') ||
    word.endsWith('CH') ||
    word.endsWith('SH') ||
    word.endsWith('O')
  );
}

function matchesDerivedWord(word: string, allowedWords: Set<string>): boolean {
  return derivedBaseCandidates(word).some((candidate) => allowedWords.has(candidate));
}

function derivedBaseCandidates(word: string): string[] {
  const candidates = new Set<string>(IRREGULAR_DERIVED_BASES.get(word) ?? []);

  addEdBaseCandidates(word, candidates);
  addEnBaseCandidates(word, candidates);
  addIngBaseCandidates(word, candidates);
  addDerivationalSuffixBaseCandidates(word, candidates);

  return [...candidates].filter((candidate) => candidate.length >= 2);
}

function addEdBaseCandidates(word: string, candidates: Set<string>): void {
  if (!word.endsWith('ED') || word.length < 4) return;

  const stem = word.slice(0, -2);
  candidates.add(stem);
  candidates.add(`${stem}E`);

  if (stem.endsWith('I') && stem.length > 1) {
    candidates.add(`${stem.slice(0, -1)}Y`);
  }

  if (hasDoubledFinalConsonant(stem)) {
    candidates.add(stem.slice(0, -1));
  }
}

function addEnBaseCandidates(word: string, candidates: Set<string>): void {
  if (!word.endsWith('EN') || word.length < 4) return;

  const stem = word.slice(0, -2);
  candidates.add(stem);
  candidates.add(`${stem}E`);

  if (stem.endsWith('I') && stem.length > 1) {
    candidates.add(`${stem.slice(0, -1)}Y`);
  }

  if (hasDoubledFinalConsonant(stem)) {
    candidates.add(stem.slice(0, -1));
  }
}

function addIngBaseCandidates(word: string, candidates: Set<string>): void {
  if (!word.endsWith('ING') || word.length < 5) return;

  const stem = word.slice(0, -3);
  candidates.add(stem);
  candidates.add(`${stem}E`);

  if (stem.endsWith('Y') && stem.length > 1) {
    candidates.add(`${stem.slice(0, -1)}IE`);
  }

  if (stem.endsWith('CK') && stem.length > 2) {
    candidates.add(stem.slice(0, -1));
  }

  if (hasDoubledFinalConsonant(stem)) {
    candidates.add(stem.slice(0, -1));
  }
}

function addDerivationalSuffixBaseCandidates(word: string, candidates: Set<string>): void {
  for (const suffix of ['ER', 'EST', 'LY', 'NESS', 'MENT', 'FUL', 'LESS', 'ABLE', 'IBLE', 'ISH']) {
    if (!word.endsWith(suffix) || word.length <= suffix.length + 1) continue;
    const stem = word.slice(0, -suffix.length);
    candidates.add(stem);
    candidates.add(`${stem}E`);
    if (stem.endsWith('I') && stem.length > 1) {
      candidates.add(`${stem.slice(0, -1)}Y`);
    }
    if (hasDoubledFinalConsonant(stem)) {
      candidates.add(stem.slice(0, -1));
    }
  }
}

function hasDoubledFinalConsonant(word: string): boolean {
  if (word.length < 2) return false;
  const finalLetter = word.at(-1);
  return finalLetter === word.at(-2) && finalLetter !== undefined && !'AEIOUY'.includes(finalLetter);
}

function wordAnchor(cells: PreviewCellState[]): PreviewCellState {
  return cells.reduce((anchor, cell) => {
    if (cell.row > anchor.row) return cell;
    if (cell.row === anchor.row && cell.col > anchor.col) return cell;
    return anchor;
  });
}

function scoreWordRun(
  run: Pick<WordRun, 'word' | 'cells' | 'tiles'>,
  committedBoard: Map<string, LetterTileState>,
  boardLayout: BoardLayoutType,
) : ScoreBreakdown {
  const letters: WordLetterScoreState[] = [];
  const wordBonuses: WordBonusState[] = [];
  let letterTotal = 0;
  let wordMultiplier = 1;

  for (let index = 0; index < run.cells.length; index += 1) {
    const cell = run.cells[index];
    const tile = run.tiles[index];
    const letter = run.word[index] as Letter;
    const isNewTile = !committedBoard.has(coordKey(cell.col, cell.row));
    const isBlank = Boolean(tile.isBlank);
    const baseScore = isBlank ? 0 : LETTER_VALUES[letter];
    const letterMultiplier = isNewTile ? letterMultiplierAt(boardLayout, cell.col, cell.row) : 1;
    const premium = isNewTile ? premiumSquareAt(boardLayout, cell.col, cell.row) : 'normal';
    const tileScore = baseScore * letterMultiplier;
    letterTotal += tileScore;
    letters.push({
      col: cell.col,
      row: cell.row,
      letter,
      baseScore,
      appliedMultiplier: letterMultiplier,
      tileScore,
      isNewTile,
      isBlank,
      premium,
    });
    if (isNewTile) {
      const nextWordMultiplier = wordMultiplierAt(boardLayout, cell.col, cell.row);
      if (nextWordMultiplier > 1) {
        wordMultiplier *= nextWordMultiplier;
        wordBonuses.push({
          col: cell.col,
          row: cell.row,
          premium: nextWordMultiplier === 3 ? 'triple-word' : 'double-word',
          multiplier: nextWordMultiplier,
        });
      }
    }
  }

  return {
    letters,
    letterSubtotal: letterTotal,
    wordMultiplier,
    wordBonuses,
    score: letterTotal * wordMultiplier,
  };
}

function isLetter(value: string | null): value is Letter {
  return typeof value === 'string' && value in LETTER_VALUES;
}
