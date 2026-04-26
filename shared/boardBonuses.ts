export type PremiumSquareType =
  | 'normal'
  | 'double-letter'
  | 'triple-letter'
  | 'double-word'
  | 'triple-word';

const PREMIUM_SQUARES = new Map<string, PremiumSquareType>([
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

export function premiumSquareAt(col: number, row: number): PremiumSquareType {
  return PREMIUM_SQUARES.get(`${col}:${row}`) ?? 'normal';
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

export function letterMultiplierAt(col: number, row: number): number {
  switch (premiumSquareAt(col, row)) {
    case 'double-letter':
      return 2;
    case 'triple-letter':
      return 3;
    default:
      return 1;
  }
}

export function wordMultiplierAt(col: number, row: number): number {
  switch (premiumSquareAt(col, row)) {
    case 'double-word':
      return 2;
    case 'triple-word':
      return 3;
    default:
      return 1;
  }
}
