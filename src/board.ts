import { gridCoordsToTileHolderCoords } from './coordinates.ts'
import { BOARD_HEIGHT } from './constants.ts'
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
    this.tiles.push(tile);
    this.el.appendChild(tile.el);
    return true;
  }

  removeTile(tile : Tile) {
    this.tiles = this.tiles.filter(t => t !== tile);
  }

  recallHand(hand : Hand) {
    this.tiles.forEach(t => {
      if (!t.isPlayed) {
        t.tileHolder.removeTile(t);
        if (t.handCol === null || t.handRow === null) {
          console.log("Recall failed due to null hand col/row")
          return;
        }
        const c = gridCoordsToTileHolderCoords(t.handCol, t.handRow, hand);
        hand.addTile(t);
        t.col = t.handCol
        t.row = t.handRow
        t.el.style.left = c.x + 'px';
        t.el.style.top  = c.y + 'px';
      }
    });
  }

  setAllPlayed() {
    this.tiles.forEach(t => {
      if (!t.isPlayed) {
        t.isPlayed = true
        t.disableDrag?.();
      }
    });
  }
}
