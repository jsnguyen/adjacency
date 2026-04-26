export const GRID = {
  cols: 15,
  rows: 15,
  pad: 3,
}

export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1,
  F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1,
  P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4,
  Z: 10,
} as const;

export type Letter = keyof typeof LETTER_VALUES

export const TILE_SIZE = 40

export function randomLetter() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return letters[Math.floor(Math.random() * letters.length)];
}


export const APP_WIDTH = GRID.cols * TILE_SIZE + (GRID.cols+1) * GRID.pad + 'px';
export const BOARD_HEIGHT = GRID.rows * TILE_SIZE + (GRID.rows + 1) * GRID.pad + 'px';
