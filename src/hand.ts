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
  zoom: number;

  constructor(parent : HTMLElement, size = 7) {
    this.grid = { cols: size, rows: 1, pad: GRID.pad };
    this.cols = size;
    this.rows = 1;
    this.tiles = [];
    this.zoom = 1;

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
    const occupyingTile = this.tiles.find((candidate) => (
      candidate !== tile &&
      candidate.col === tile.col &&
      candidate.row === tile.row
    ));

    if (occupyingTile) {
      const emptySlot = this.firstEmptySlot();
      if (!emptySlot) {
        return false;
      }
      const oldCoords = gridCoordsToTileHolderCoords(occupyingTile.col, occupyingTile.row, this);
      occupyingTile.col = emptySlot.col;
      occupyingTile.row = emptySlot.row;
      occupyingTile.handCol = emptySlot.col;
      occupyingTile.handRow = emptySlot.row;
      const coords = gridCoordsToTileHolderCoords(occupyingTile.col, occupyingTile.row, this);
      occupyingTile.el.style.left = coords.x + 'px';
      occupyingTile.el.style.top = coords.y + 'px';
      occupyingTile.animateBump(oldCoords.x - coords.x, oldCoords.y - coords.y);
    }

    if (!this.spaceIsEmpty(tile)) {
      return false;
    }

    tile.tileHolder = this;
    if (tile.isBlank) {
      tile.setBlank();
    }
    tile.handCol = tile.col;
    tile.handRow = tile.row;
    tile.el.classList.remove('preview-valid');
    tile.el.classList.remove('selected-tile');
    tile.el.classList.add('rack-tile');
    this.tiles.push(tile);
    this.el.appendChild(tile.el);
    return true;
  }

  firstEmptySlot(): { col: number; row: number } | null {
    for (let row = 0; row < this.rows; row += 1) {
      for (let col = 0; col < this.cols; col += 1) {
        if (!this.tiles.some((tile) => tile.col === col && tile.row === row)) {
          return { col, row };
        }
      }
    }
    return null;
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

  restoreTiles(incomingTiles : Tile[] = []) {
    const orderedTiles = [...this.tiles, ...incomingTiles]
      .map((tile, index) => ({
        tile,
        index,
        sortCol: tile.handCol ?? tile.col,
      }))
      .sort((a, b) => a.sortCol - b.sortCol || a.index - b.index)
      .map((entry) => entry.tile);

    this.tiles = [];

    for (const [index, tile] of orderedTiles.entries()) {
      tile.tileHolder = this;
      if (tile.isBlank) {
        tile.setBlank();
      }
      tile.col = index;
      tile.row = 0;
      tile.handCol = index;
      tile.handRow = 0;
      tile.el.classList.remove('preview-valid');
      tile.el.classList.add('rack-tile');
      this.tiles.push(tile);
      this.el.appendChild(tile.el);
    }

    this.updateOrder();
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
        isBlank: tile.isBlank,
      })),
      name: "hand"
    };
  }

}
