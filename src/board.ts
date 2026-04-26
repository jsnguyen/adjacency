import { BOARD_HEIGHT } from './constants.ts'
import type { TileHolderState } from '../shared/states.ts'
import type { Tile } from './tile.ts'
import type { Hand } from './hand.ts'

export class Board {
  grid: Record<string, number>;
  cols: number;
  rows: number;
  tiles: Tile[];
  el: HTMLElement;

  constructor(grid : Record<string, number>, parent : HTMLElement) {
    this.grid = grid;
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.tiles = [];

    const board = document.createElement('div');
    board.classList.add('board');
    board.style.height = BOARD_HEIGHT;
    this.el = board;

    parent.appendChild(this.el);
  }

  spaceIsEmpty(tile : Tile) {
    return !this.tiles.some(t => t !== tile && t.col === tile.col && t.row === tile.row);
  }

  addTile(tile : Tile) {
    if (!this.spaceIsEmpty(tile)) return false;
    tile.el.classList.remove('preview-valid');
    tile.el.classList.remove('selected-tile');
    tile.el.classList.remove('rack-tile');
    tile.tileHolder = this;
    this.tiles.push(tile);
    this.el.appendChild(tile.el);
    return true;
  }

  removeTile(tile : Tile) {
    this.tiles = this.tiles.filter(t => t !== tile);
  }

  clearTiles() {
    for (const tile of this.tiles) {
      tile.disableDrag?.();
      tile.el.remove();
    }
    this.tiles = [];
  }

  recallHand(hand : Hand) {
    const recalledTiles: Tile[] = [];

    for (const t of [...this.tiles]) {
      if (!t.isPlayed) {
        this.removeTile(t);
        recalledTiles.push(t);
      }
    }

    hand.restoreTiles(recalledTiles);
  }

  getBoardState(): TileHolderState  {
    return {
      tiles: this.tiles.map((tile) => ({
        id: tile.id,
        letter: tile.letter,
        col: tile.col,
        row: tile.row,
      })),
      name: "board"
    };
  }

}
