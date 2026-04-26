import { GRID, TILE_SIZE } from './constants.ts'
import type { TileHolderState } from '../shared/states.ts'
import { gridCoordsToTileHolderCoords } from './coordinates.ts'
import { Tile } from './tile.ts'

export class Hand {
  grid: Record<string, number>;
  cols: number;
  rows: number;
  tiles: Tile[];
  el: HTMLElement;

  constructor(parent : HTMLElement, size = 7) {
    this.grid = { cols: size, rows: 1, pad: GRID.pad };
    this.cols = size;
    this.rows = 1;
    this.tiles = [];

    const hand = document.createElement('div');
    hand.classList.add('hand');
    hand.style.width = (TILE_SIZE * this.cols + this.grid.pad * (size + 1)) + 'px';
    hand.style.height = (TILE_SIZE + this.grid.pad * 2) + 'px';
    this.el = hand;
    parent.appendChild(this.el);

  }

  spaceIsEmpty(tile : Tile) {
    return this.tiles.every(t => t === tile || t.col !== tile.col || t.row !== tile.row);
  }

  addTile(tile : Tile) {
    if (this.spaceIsEmpty(tile)) {
      tile.tileHolder = this;
      tile.handCol = tile.col;
      tile.handRow = tile.row;
      tile.el.classList.remove('preview-valid');
      tile.el.classList.remove('selected-tile');
      tile.el.classList.add('rack-tile');
      this.tiles.push(tile);
      this.el.appendChild(tile.el);
      return true;
    } else {
      return false;
    }
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

  shuffleHand() {
    const tiles = this.tiles.filter(t => t !== null);

    // Fisher-Yates
    for (let i = tiles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const iCol = tiles[i].col
      const jCol = tiles[j].col

      tiles[i].col = jCol
      tiles[i].handCol = jCol

      tiles[j].col = iCol
      tiles[j].handCol = iCol
    }

    this.updateOrder();
  }

  updateOrder() {
    for (const t of this.tiles) {
      if (!t) continue;
      const c = gridCoordsToTileHolderCoords(t.col, 0, this);
      t.el.style.left = c.x + 'px';
      t.el.style.top  = c.y + 'px';
    }
  }

  getHandState(): TileHolderState  {
    return {
      tiles: this.tiles.map((tile) => ({
        id: tile.id,
        letter: tile.letter,
        col: tile.col,
        row: tile.row,
      })),
      name: "hand"
    };
  }

}
