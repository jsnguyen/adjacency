import { Hand } from './hand.ts'
import { Board } from './board.ts'
import { TILE_SIZE } from './constants.ts'

function holderScale(tileHolder: Hand | Board): number {
  return tileHolder.zoom ?? 1;
}

// 3 coordinate systems:
// the actual screen coordinates (clientX/Y) with origin at top-left of viewport
// the board coordinates with origin at bottom-left of the board, increasing upward and rightward
// the grid coordinates with row/col indices, 0-based from top-left of the board

export function clientToBoardCoords(clientX : number, clientY : number, tileHolder : Hand | Board) {
  const rect = tileHolder.el.getBoundingClientRect();
  const scale = holderScale(tileHolder);
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top) / scale,
  };
}

export function boardCoordsToGridCoords(boardX : number, boardY : number, tileHolder : Hand | Board) {
  return {
    col: Math.round((boardX - tileHolder.grid.pad) / (TILE_SIZE + tileHolder.grid.pad)),
    row: Math.round((boardY - tileHolder.grid.pad) / (TILE_SIZE + tileHolder.grid.pad)),
  };
}

export function gridCoordsToTileHolderCoords(col : number, row : number, tileHolder : Hand | Board) {
  return {
    x: col * TILE_SIZE + (col+1) * tileHolder.grid.pad,
    y: row * TILE_SIZE + (row+1) * tileHolder.grid.pad,
  };
}

export function snapToGrid(boardX : number, boardY : number, tileHolder : Hand | Board) {
  const gridCoords = boardCoordsToGridCoords(boardX, boardY, tileHolder);
  const col = Math.max(0, Math.min(tileHolder.grid.cols - 1, gridCoords.col));
  const row = Math.max(0, Math.min(tileHolder.grid.rows - 1, gridCoords.row));
  return gridCoordsToTileHolderCoords(col, row, tileHolder);
}
