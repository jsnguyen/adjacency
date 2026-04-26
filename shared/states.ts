import type { Letter } from './letters.ts';
import type { BoardLayoutType, PremiumSquareType } from './boardBonuses.ts';

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

export type WordLetterScoreState = {
  col: number;
  row: number;
  letter: Letter;
  baseScore: number;
  appliedMultiplier: number;
  tileScore: number;
  isNewTile: boolean;
  premium: PremiumSquareType;
};

export type WordBonusState = {
  col: number;
  row: number;
  premium: Extract<PremiumSquareType, 'double-word' | 'triple-word'>;
  multiplier: number;
};

export type TurnWordScoreState = {
  kind: WordBuildKind;
  word: string;
  score: number;
  letters: WordLetterScoreState[];
  letterSubtotal: number;
  wordMultiplier: number;
  wordBonuses: WordBonusState[];
};

export type PreviewCellState = {
  col: number;
  row: number;
};

export type PreviewWordState = {
  kind: WordBuildKind;
  word: string;
  score: number;
  letters: WordLetterScoreState[];
  letterSubtotal: number;
  wordMultiplier: number;
  wordBonuses: WordBonusState[];
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
  boardLayout: BoardLayoutType;
  canChangeBoardLayout: boolean;
  teamScore: number;
  remainingTiles: number;
  lastMove: LastMoveState;
  turnHistory: TurnHistoryEntryState[];
};
