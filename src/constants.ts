import { LETTER_VALUES } from '../shared/letters.ts';
import type { Letter } from '../shared/letters.ts';

export const GRID = {
  cols: 15,
  rows: 15,
  pad: 3,
}

export { LETTER_VALUES };
export type { Letter };

export const TILE_SIZE = 40
export const BOARD_WIDTH_PX = GRID.cols * TILE_SIZE + (GRID.cols + 1) * GRID.pad;
export const BOARD_HEIGHT_PX = GRID.rows * TILE_SIZE + (GRID.rows + 1) * GRID.pad;

export function randomLetter(): Letter {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return letters[Math.floor(Math.random() * letters.length)] as Letter;
}


export const APP_WIDTH = `${BOARD_WIDTH_PX}px`;
export const BOARD_HEIGHT = `${BOARD_HEIGHT_PX}px`;
