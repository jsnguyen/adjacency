export const BOARD_LAYOUT_TYPES = ['scrabble', 'words-with-friends', 'nyt-crossplay'] as const;

export type BoardLayoutType = (typeof BOARD_LAYOUT_TYPES)[number];

export type PremiumSquareType =
  | 'normal'
  | 'double-letter'
  | 'triple-letter'
  | 'double-word'
  | 'triple-word';

const SCRABBLE_PREMIUM_SQUARES = new Map<string, PremiumSquareType>([
  ['0:0', 'triple-word'],
  ['0:3', 'double-letter'],
  ['0:7', 'triple-word'],
  ['0:11', 'double-letter'],
  ['0:14', 'triple-word'],
  ['1:1', 'double-word'],
  ['1:5', 'triple-letter'],
  ['1:9', 'triple-letter'],
  ['1:13', 'double-word'],
  ['2:2', 'double-word'],
  ['2:6', 'double-letter'],
  ['2:8', 'double-letter'],
  ['2:12', 'double-word'],
  ['3:0', 'double-letter'],
  ['3:3', 'double-word'],
  ['3:7', 'double-letter'],
  ['3:11', 'double-word'],
  ['3:14', 'double-letter'],
  ['4:4', 'double-word'],
  ['4:10', 'double-word'],
  ['5:1', 'triple-letter'],
  ['5:5', 'triple-letter'],
  ['5:9', 'triple-letter'],
  ['5:13', 'triple-letter'],
  ['6:2', 'double-letter'],
  ['6:6', 'double-letter'],
  ['6:8', 'double-letter'],
  ['6:12', 'double-letter'],
  ['7:0', 'triple-word'],
  ['7:3', 'double-letter'],
  ['7:7', 'double-word'],
  ['7:11', 'double-letter'],
  ['7:14', 'triple-word'],
  ['8:2', 'double-letter'],
  ['8:6', 'double-letter'],
  ['8:8', 'double-letter'],
  ['8:12', 'double-letter'],
  ['9:1', 'triple-letter'],
  ['9:5', 'triple-letter'],
  ['9:9', 'triple-letter'],
  ['9:13', 'triple-letter'],
  ['10:4', 'double-word'],
  ['10:10', 'double-word'],
  ['11:0', 'double-letter'],
  ['11:3', 'double-word'],
  ['11:7', 'double-letter'],
  ['11:11', 'double-word'],
  ['11:14', 'double-letter'],
  ['12:2', 'double-word'],
  ['12:6', 'double-letter'],
  ['12:8', 'double-letter'],
  ['12:12', 'double-word'],
  ['13:1', 'double-word'],
  ['13:5', 'triple-letter'],
  ['13:9', 'triple-letter'],
  ['13:13', 'double-word'],
  ['14:0', 'triple-word'],
  ['14:3', 'double-letter'],
  ['14:7', 'triple-word'],
  ['14:11', 'double-letter'],
  ['14:14', 'triple-word'],
]);

const WWF_PREMIUM_SQUARES = new Map<string, PremiumSquareType>([
  ['0:3', 'triple-word'],
  ['0:6', 'triple-letter'],
  ['0:8', 'triple-letter'],
  ['0:11', 'triple-word'],
  ['1:2', 'double-letter'],
  ['1:5', 'double-word'],
  ['1:9', 'double-word'],
  ['1:12', 'double-letter'],
  ['2:1', 'double-letter'],
  ['2:4', 'double-letter'],
  ['2:10', 'double-letter'],
  ['2:13', 'double-letter'],
  ['3:0', 'triple-word'],
  ['3:3', 'triple-letter'],
  ['3:7', 'double-word'],
  ['3:11', 'triple-letter'],
  ['3:14', 'triple-word'],
  ['4:2', 'double-letter'],
  ['4:6', 'double-letter'],
  ['4:8', 'double-letter'],
  ['4:12', 'double-letter'],
  ['5:1', 'double-word'],
  ['5:5', 'triple-letter'],
  ['5:9', 'triple-letter'],
  ['5:13', 'double-word'],
  ['6:0', 'triple-letter'],
  ['6:4', 'double-letter'],
  ['6:10', 'double-letter'],
  ['6:14', 'triple-letter'],
  ['7:3', 'double-word'],
  ['7:11', 'double-word'],
  ['8:0', 'triple-letter'],
  ['8:4', 'double-letter'],
  ['8:10', 'double-letter'],
  ['8:14', 'triple-letter'],
  ['9:1', 'double-word'],
  ['9:5', 'triple-letter'],
  ['9:9', 'triple-letter'],
  ['9:13', 'double-word'],
  ['10:2', 'double-letter'],
  ['10:6', 'double-letter'],
  ['10:8', 'double-letter'],
  ['10:12', 'double-letter'],
  ['11:0', 'triple-word'],
  ['11:3', 'triple-letter'],
  ['11:7', 'double-word'],
  ['11:11', 'triple-letter'],
  ['11:14', 'triple-word'],
  ['12:1', 'double-letter'],
  ['12:4', 'double-letter'],
  ['12:10', 'double-letter'],
  ['12:13', 'double-letter'],
  ['13:2', 'double-letter'],
  ['13:5', 'double-word'],
  ['13:9', 'double-word'],
  ['13:12', 'double-letter'],
  ['14:3', 'triple-word'],
  ['14:6', 'triple-letter'],
  ['14:8', 'triple-letter'],
  ['14:11', 'triple-word'],
]);

const NYT_CROSSPLAY_PREMIUM_SQUARES = new Map<string, PremiumSquareType>([
  ['0:0', 'triple-letter'],
  ['0:3', 'triple-word'],
  ['0:7', 'double-letter'],
  ['0:11', 'triple-word'],
  ['0:14', 'triple-letter'],
  ['1:1', 'double-word'],
  ['1:6', 'triple-letter'],
  ['1:8', 'triple-letter'],
  ['1:13', 'double-word'],
  ['2:4', 'double-letter'],
  ['2:10', 'double-letter'],
  ['3:0', 'triple-word'],
  ['3:3', 'double-letter'],
  ['3:7', 'double-word'],
  ['3:11', 'double-letter'],
  ['3:14', 'triple-word'],
  ['4:2', 'double-letter'],
  ['4:5', 'triple-letter'],
  ['4:9', 'triple-letter'],
  ['4:12', 'double-letter'],
  ['5:4', 'triple-letter'],
  ['5:7', 'double-letter'],
  ['5:10', 'triple-letter'],
  ['6:1', 'triple-letter'],
  ['6:13', 'triple-letter'],
  ['7:0', 'double-letter'],
  ['7:3', 'double-word'],
  ['7:5', 'double-letter'],
  ['7:9', 'double-letter'],
  ['7:11', 'double-word'],
  ['7:14', 'double-letter'],
  ['8:1', 'triple-letter'],
  ['8:13', 'triple-letter'],
  ['9:4', 'triple-letter'],
  ['9:7', 'double-letter'],
  ['9:10', 'triple-letter'],
  ['10:2', 'double-letter'],
  ['10:5', 'triple-letter'],
  ['10:9', 'triple-letter'],
  ['10:12', 'double-letter'],
  ['11:0', 'triple-word'],
  ['11:3', 'double-letter'],
  ['11:7', 'double-word'],
  ['11:11', 'double-letter'],
  ['11:14', 'triple-word'],
  ['12:4', 'double-letter'],
  ['12:10', 'double-letter'],
  ['13:1', 'double-word'],
  ['13:6', 'triple-letter'],
  ['13:8', 'triple-letter'],
  ['13:13', 'double-word'],
  ['14:0', 'triple-letter'],
  ['14:3', 'triple-word'],
  ['14:7', 'double-letter'],
  ['14:11', 'triple-word'],
  ['14:14', 'triple-letter'],
]);

export function isBoardLayoutType(value: unknown): value is BoardLayoutType {
  return typeof value === 'string' && BOARD_LAYOUT_TYPES.includes(value as BoardLayoutType);
}

function premiumSquaresForLayout(layout: BoardLayoutType): Map<string, PremiumSquareType> {
  switch (layout) {
    case 'words-with-friends':
      return WWF_PREMIUM_SQUARES;
    case 'nyt-crossplay':
      return NYT_CROSSPLAY_PREMIUM_SQUARES;
    case 'scrabble':
      return SCRABBLE_PREMIUM_SQUARES;
  }
}

export function premiumSquareAt(layout: BoardLayoutType, col: number, row: number): PremiumSquareType {
  return premiumSquaresForLayout(layout).get(`${col}:${row}`) ?? 'normal';
}

export function premiumSquareLabel(square: PremiumSquareType): string {
  switch (square) {
    case 'double-letter':
      return 'DL';
    case 'triple-letter':
      return 'TL';
    case 'double-word':
      return 'DW';
    case 'triple-word':
      return 'TW';
    case 'normal':
      return '';
  }
}

export function letterMultiplierAt(layout: BoardLayoutType, col: number, row: number): number {
  switch (premiumSquareAt(layout, col, row)) {
    case 'double-letter':
      return 2;
    case 'triple-letter':
      return 3;
    default:
      return 1;
  }
}

export function wordMultiplierAt(layout: BoardLayoutType, col: number, row: number): number {
  switch (premiumSquareAt(layout, col, row)) {
    case 'double-word':
      return 2;
    case 'triple-word':
      return 3;
    default:
      return 1;
  }
}
