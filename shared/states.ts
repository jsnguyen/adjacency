export type Grid = {
  cols: number;
  rows: number;
  pad: number;
};

export type Letter =
  | 'A' | 'B' | 'C' | 'D' | 'E'
  | 'F' | 'G' | 'H' | 'I' | 'J'
  | 'K' | 'L' | 'M' | 'N' | 'O'
  | 'P' | 'Q' | 'R' | 'S' | 'T'
  | 'U' | 'V' | 'W' | 'X' | 'Y' | 'Z';

export type TileState = {
  id: string;
  letter: Letter | null;
  col: number;
  row: number;
};

export type TileHolderState = {
  tiles: TileState[];
  name: string;
};
