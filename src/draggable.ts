import {
  boardCoordsToGridCoords,
  clientToBoardCoords,
  gridCoordsToTileHolderCoords,
} from './coordinates.ts'

import type { Hand } from './hand.ts'
import type { Board } from './board.ts'
import { Tile } from './tile.ts'


//
// drag/drop behavior
//

function withinBounds(clientX : number, clientY : number, tileHolder : Hand | Board) {
  const r = tileHolder.el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right &&
         clientY >= r.top  && clientY <= r.bottom;
}

export function makeDraggable(tile: Tile, hand: Hand, board: Board) {

  const el = tile.el;

  let drag: {
    pointerId: number;
    offsetX: number;
    offsetY: number;
    origin: Hand | Board;
    originCol: number;
    originRow: number;
  } | null = null;

  let pendingCleanup : (() => void) | null = null;
  const ac = new AbortController();

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
    drag = null;
  };

  el.addEventListener('pointerdown', (e) => {
    pendingCleanup?.();
    pendingCleanup = null;

    const rect = el.getBoundingClientRect();
    drag = {
      pointerId: e.pointerId,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
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

    tile.tileHolder.removeTile(tile);

    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
  }, ac);

  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    el.style.left = (e.clientX - drag.offsetX) + 'px';
    el.style.top  = (e.clientY - drag.offsetY) + 'px';
  }, ac);

  el.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;

    let finalTileHolder = drag.origin;
    if (withinBounds(e.clientX, e.clientY, board)) {
      finalTileHolder = board;
    } else if (withinBounds(e.clientX, e.clientY, hand)) {
      finalTileHolder = hand;
    }

    const p = clientToBoardCoords(e.clientX, e.clientY, finalTileHolder);
    const tileX = p.x - drag.offsetX;
    const tileY = p.y - drag.offsetY;

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
    tile.tileHolder = finalTileHolder;

    const snappedCoords = gridCoordsToTileHolderCoords(tile.col, tile.row, finalTileHolder);

    // animate in viewport space, then reparent on transitionend
    const finalRect = finalTileHolder.el.getBoundingClientRect();
    const targetX = finalRect.left + snappedCoords.x;
    const targetY = finalRect.top  + snappedCoords.y;
    const noMove = parseFloat(el.style.left) === targetX && parseFloat(el.style.top) === targetY;

    const cleanup = () => {
      el.classList.remove('snapping');
      finalTileHolder.el.appendChild(el);
      el.style.position = '';
      el.style.left = snappedCoords.x + 'px';
      el.style.top  = snappedCoords.y + 'px';
      pendingCleanup = null;
    };

    if (noMove) {
      cleanup();
    } else {
      el.classList.add('snapping');
      el.style.left = targetX + 'px';
      el.style.top  = targetY + 'px';
      pendingCleanup = cleanup;
      el.addEventListener('transitionend', () => {
        if (pendingCleanup === cleanup) cleanup();
      }, { once: true });
    }

    /*
    console.log('Tile added to', finalTileHolder === board ? 'board' : 'hand');
    if (finalTileHolder === board) {
      console.log(tile.row, tile.col, tile.handRow, tile.handCol)
    }
    */

    drag = null;
    el.classList.remove('dragging');
    el.style.cursor = 'grab';

  }, ac);

  el.addEventListener('pointercancel', restoreToOrigin, ac);

  return () => ac.abort();

}
