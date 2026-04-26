import type { Letter } from './letters.ts';

export type Grid = {
  cols: number;
  rows: number;
  pad: number;
};

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

export type PlayerPublicState = {
  id: string;
  rack: TileHolderState;
  connected: boolean;
};

export type LastMoveState = {
  playerId: string;
  words: string[];
  score: number;
  message: string;
} | null;

export type WordBuildKind = 'fresh' | 'hook' | 'extension';

export type TurnWordScoreState = {
  kind: WordBuildKind;
  word: string;
  score: number;
};

export type PreviewCellState = {
  col: number;
  row: number;
};

export type PreviewWordState = {
  kind: WordBuildKind;
  word: string;
  score: number;
  cells: PreviewCellState[];
  anchor: PreviewCellState;
};

export type MovePreviewState = {
  valid: boolean;
  words: PreviewWordState[];
  totalScore: number;
  reason: string | null;
};

export type TurnHistoryEntryState = {
  turn: number;
  playerId: string;
  kind: 'play' | 'pass' | 'exchange' | 'reset';
  words: TurnWordScoreState[];
  totalScore: number;
  message: string;
};

export type GameState = {
  roomId: string;
  board: TileHolderState;
  players: PlayerPublicState[];
  currentPlayerId: string | null;
  teamScore: number;
  remainingTiles: number;
  lastMove: LastMoveState;
  turnHistory: TurnHistoryEntryState[];
  rules: {
    boardCols: number;
    boardRows: number;
    rackSize: number;
    centerCol: number;
    centerRow: number;
    dictionary: 'inline' | 'file' | 'system' | 'permissive';
    dictionaryWordCount: number;
  };
};
