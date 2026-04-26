import {
  boardCoordsToGridCoords,
  clientToBoardCoords,
  gridCoordsToTileHolderCoords,
} from './coordinates.ts'

import type { Hand } from './hand.ts'
import type { Board } from './board.ts'
import { Tile } from './tile.ts'

export const DRAG_CANCEL_EVENT = 'adjacency:cancel-active-drag';


//
// drag/drop behavior
//

function withinBounds(clientX : number, clientY : number, tileHolder : Hand | Board) {
  const r = tileHolder.el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right &&
         clientY >= r.top  && clientY <= r.bottom;
}

export function makeDraggable(tile: Tile, hand: Hand, board: Board, onChange?: () => void) {

  const el = tile.el;
  const ac = new AbortController();
  const listenerOptions = { signal: ac.signal };

  let drag: {
    pointerId: number;
    screenOffsetX: number;
    screenOffsetY: number;
    holderOffsetX: number;
    holderOffsetY: number;
    origin: Hand | Board;
    originCol: number;
    originRow: number;
  } | null = null;

  const restoreToOrigin = () => {
    if (!drag) return;
    tile.col = drag.originCol;
    tile.row = drag.originRow;
    drag.origin.addTile(tile);
    const coords = gridCoordsToTileHolderCoords(tile.col, tile.row, drag.origin);
    drag.origin.el.appendChild(el);
    el.style.position = '';
    el.style.left = coords.x + 'px';
    el.style.top = coords.y + 'px';
    el.classList.remove('dragging');
    el.style.cursor = 'grab';
    tile.animatePlacement();
    drag = null;
    onChange?.();
  };

  el.addEventListener('pointerdown', (e) => {
    const rect = el.getBoundingClientRect();
    const pointerCoords = clientToBoardCoords(e.clientX, e.clientY, tile.tileHolder);
    const tileCoords = gridCoordsToTileHolderCoords(tile.col, tile.row, tile.tileHolder);
    drag = {
      pointerId: e.pointerId,
      screenOffsetX: e.clientX - rect.left,
      screenOffsetY: e.clientY - rect.top,
      holderOffsetX: pointerCoords.x - tileCoords.x,
      holderOffsetY: pointerCoords.y - tileCoords.y,
      origin: tile.tileHolder,
      originCol: tile.col,
      originRow: tile.row,
    };

    // hoist into body + fixed positioning so the drag is holder-agnostic
    document.body.appendChild(el);
    el.style.position = 'fixed';
    el.style.left = rect.left + 'px';
    el.style.top  = rect.top  + 'px';
    el.classList.add('dragging');

    drag.origin.removeTile(tile);

    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  }, listenerOptions);

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    el.style.left = (e.clientX - drag.screenOffsetX) + 'px';
    el.style.top  = (e.clientY - drag.screenOffsetY) + 'px';
  }, listenerOptions);

  el.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;

    let finalTileHolder = drag.origin;
    if (withinBounds(e.clientX, e.clientY, board)) {
      finalTileHolder = board;
    } else if (withinBounds(e.clientX, e.clientY, hand)) {
      finalTileHolder = hand;
    }

    const p = clientToBoardCoords(e.clientX, e.clientY, finalTileHolder);
    const tileX = p.x - drag.holderOffsetX;
    const tileY = p.y - drag.holderOffsetY;

    const boardCoords = boardCoordsToGridCoords(tileX, tileY, finalTileHolder);

    const targetCol = Math.max(0, Math.min(finalTileHolder.grid.cols - 1, boardCoords.col));
    const targetRow = Math.max(0, Math.min(finalTileHolder.grid.rows - 1, boardCoords.row));
    tile.col = targetCol;
    tile.row = targetRow;

    if (!finalTileHolder.addTile(tile)) {
      finalTileHolder = drag.origin;
      tile.col = drag.originCol;
      tile.row = drag.originRow;
      finalTileHolder.addTile(tile);
    }

    const snappedCoords = gridCoordsToTileHolderCoords(tile.col, tile.row, finalTileHolder);
    finalTileHolder.el.appendChild(el);
    el.style.position = '';
    el.style.left = snappedCoords.x + 'px';
    el.style.top  = snappedCoords.y + 'px';

    drag = null;
    el.classList.remove('dragging');
    el.style.cursor = 'grab';
    tile.animatePlacement();
    onChange?.();

  }, listenerOptions);

  el.addEventListener('pointercancel', restoreToOrigin, listenerOptions);
  document.addEventListener(DRAG_CANCEL_EVENT, restoreToOrigin, listenerOptions);

  return () => ac.abort();

}
