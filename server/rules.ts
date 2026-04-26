import { LETTER_VALUES } from '../shared/letters.ts';
import type { Letter } from '../shared/letters.ts';
import type { TileHolderState, TileState } from '../shared/states.ts';

export const BOARD_COLS = 15;
export const BOARD_ROWS = 15;
export const RACK_SIZE = 7;
export const CENTER_COL = Math.floor(BOARD_COLS / 2);
export const CENTER_ROW = Math.floor(BOARD_ROWS / 2);

export type LetterTileState = TileState & { letter: Letter };

export type MoveValidationResult =
  | { ok: true; newTiles: LetterTileState[]; words: string[]; score: number }
  | { ok: false; reason: string };

type WordRun = {
  key: string;
  word: string;
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
  playerRack: LetterTileState[],
  submittedBoard: TileHolderState,
  allowedWords: Set<string>,
): MoveValidationResult {
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
    if (rackTile.letter !== submittedTile.letter) {
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

  const words = collectWords(newTiles, proposedBoard, lineResult.direction);
  if (words.length === 0) {
    return { ok: false, reason: 'Every submitted turn must form at least one word.' };
  }

  for (const word of words) {
    if (!isWordAllowed(word, allowedWords)) {
      return { ok: false, reason: `"${word}" is not in the configured word list.` };
    }
  }

  const score = words.reduce((total, word) => total + scoreWord(word), 0);
  return { ok: true, newTiles, words, score };
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

    tiles.push({ id: tile.id, letter: tile.letter, col: tile.col, row: tile.row });
  }

  return { ok: true, tiles };
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
  direction: 'horizontal' | 'vertical' | 'single',
): string[] {
  const wordsByKey = new Map<string, string>();
  const addRun = (run: WordRun) => {
    if (run.word.length > 1) {
      wordsByKey.set(run.key, run.word);
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

  return [...wordsByKey.values()];
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
  let endCol = startCol;
  let endRow = startRow;
  while (true) {
    const tile = board.get(coordKey(endCol, endRow));
    if (!tile) break;
    letters.push(tile.letter);
    endCol += deltaCol;
    endRow += deltaRow;
  }

  const key = `${startCol}:${startRow}:${endCol - deltaCol}:${endRow - deltaRow}`;
  return { key, word: letters.join('') };
}

function isWordAllowed(word: string, allowedWords: Set<string>): boolean {
  if (allowedWords.size === 0) {
    return /^[A-Z]{2,}$/.test(word);
  }
  return allowedWords.has(word);
}

function scoreWord(word: string): number {
  return [...word].reduce((total, letter) => total + LETTER_VALUES[letter as Letter], 0);
}

function isLetter(value: string | null): value is Letter {
  return typeof value === 'string' && value in LETTER_VALUES;
}
