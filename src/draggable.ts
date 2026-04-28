import {
  boardCoordsToGridCoords,
  clientToBoardCoords,
  gridCoordsToTileHolderCoords,
} from './coordinates.ts'

import type { Hand } from './hand.ts'
import type { Board } from './board.ts'
import { Tile } from './tile.ts'
import { TILE_SIZE } from './constants.ts'

export const DRAG_CANCEL_EVENT = 'adjacency:cancel-active-drag';


//
// drag/drop behavior
//

function withinBounds(clientX : number, clientY : number, tileHolder : Hand | Board) {
  const r = tileHolder.el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right &&
         clientY >= r.top  && clientY <= r.bottom;
}

export function makeDraggable(
  tile: Tile,
  hand: Hand,
  board: Board,
  onChange?: () => void,
  onDrop?: (tile: Tile, tileHolder: Hand | Board) => boolean,
  onTap?: (tile: Tile) => void,
) {

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
    startClientX: number;
    startClientY: number;
  } | null = null;

  const settleIntoHolder = (
    tileHolder: Hand | Board,
    coords: { x: number; y: number },
    sourceScreenWidth?: number,
    sourceScreenHeight?: number,
    sourceScreenLeft?: number,
    sourceScreenTop?: number,
  ) => {
    const holderScale = tileHolder.zoom ?? 1;
    const startWidth = sourceScreenWidth ? sourceScreenWidth / holderScale : TILE_SIZE;
    const startHeight = sourceScreenHeight ? sourceScreenHeight / holderScale : TILE_SIZE;
    const holderRect = tileHolder.el.getBoundingClientRect();
    const startX = sourceScreenLeft !== undefined
      ? (sourceScreenLeft - holderRect.left) / holderScale
      : coords.x;
    const startY = sourceScreenTop !== undefined
      ? (sourceScreenTop - holderRect.top) / holderScale
      : coords.y;

    tileHolder.el.appendChild(el);
    el.style.position = '';
    el.style.left = startX + 'px';
    el.style.top = startY + 'px';
    el.style.width = startWidth + 'px';
    el.style.height = startHeight + 'px';
    el.style.fontSize = '';
    el.style.borderRadius = '';
    el.classList.add('tile-size-settle');

    window.requestAnimationFrame(() => {
      el.style.left = coords.x + 'px';
      el.style.top = coords.y + 'px';
      el.style.width = TILE_SIZE + 'px';
      el.style.height = TILE_SIZE + 'px';
    });

    window.setTimeout(() => {
      el.classList.remove('tile-size-settle');
    }, 260);
  };

  const restoreToOrigin = () => {
    if (!drag) return;
    const releaseRect = el.getBoundingClientRect();
    tile.col = drag.originCol;
    tile.row = drag.originRow;
    drag.origin.addTile(tile);
    const coords = gridCoordsToTileHolderCoords(tile.col, tile.row, drag.origin);
    settleIntoHolder(drag.origin, coords, releaseRect.width, releaseRect.height, releaseRect.left, releaseRect.top);
    el.classList.remove('dragging');
    el.style.cursor = 'grab';
    tile.animatePlacement();
    const origin = drag.origin;
    drag = null;
    if (!onDrop?.(tile, origin)) {
      onChange?.();
    }
  };

  el.addEventListener('pointerdown', (e) => {
    const rect = el.getBoundingClientRect();
    const handScale = hand.zoom ?? 1;
    const dragWidth = TILE_SIZE * handScale;
    const dragHeight = TILE_SIZE * handScale;
    const offsetRatioX = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const offsetRatioY = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    const dragOffsetX = dragWidth * offsetRatioX;
    const dragOffsetY = dragHeight * offsetRatioY;
    const computedStyle = window.getComputedStyle(el);
    const baseFontSize = Number.parseFloat(computedStyle.fontSize);
    const baseBorderRadius = Number.parseFloat(computedStyle.borderTopLeftRadius);
    drag = {
      pointerId: e.pointerId,
      screenOffsetX: dragOffsetX,
      screenOffsetY: dragOffsetY,
      holderOffsetX: TILE_SIZE * offsetRatioX,
      holderOffsetY: TILE_SIZE * offsetRatioY,
      origin: tile.tileHolder,
      originCol: tile.col,
      originRow: tile.row,
      startClientX: e.clientX,
      startClientY: e.clientY,
    };

    if (drag.origin === board && tile.isBlank) {
      tile.setBlank();
    }

    el.classList.remove('tile-drop', 'tile-bump', 'tile-size-settle', 'selected-tile');

    // hoist into body + fixed positioning so the drag is holder-agnostic
    document.body.appendChild(el);
    el.style.position = 'fixed';
    el.style.left = (e.clientX - dragOffsetX) + 'px';
    el.style.top  = (e.clientY - dragOffsetY) + 'px';
    el.style.width = dragWidth + 'px';
    el.style.height = dragHeight + 'px';
    if (Number.isFinite(baseFontSize)) {
      el.style.fontSize = `${baseFontSize * handScale}px`;
    }
    if (Number.isFinite(baseBorderRadius)) {
      el.style.borderRadius = `${baseBorderRadius * handScale}px`;
    }
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

    const releaseRect = el.getBoundingClientRect();
    let finalTileHolder = drag.origin;
    if (withinBounds(e.clientX, e.clientY, hand)) {
      finalTileHolder = hand;
    } else if (withinBounds(e.clientX, e.clientY, board)) {
      finalTileHolder = board;
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

    const isTap = (
      drag.origin === hand &&
      finalTileHolder === hand &&
      Math.hypot(e.clientX - drag.startClientX, e.clientY - drag.startClientY) <= 8
    );

    const snappedCoords = gridCoordsToTileHolderCoords(tile.col, tile.row, finalTileHolder);
    settleIntoHolder(
      finalTileHolder,
      snappedCoords,
      releaseRect.width,
      releaseRect.height,
      releaseRect.left,
      releaseRect.top,
    );

    drag = null;
    el.classList.remove('dragging');
    el.style.cursor = 'grab';
    if (isTap) {
      onTap?.(tile);
      return;
    }
    tile.animatePlacement();
    if (!onDrop?.(tile, finalTileHolder)) {
      onChange?.();
    }

  }, listenerOptions);

  el.addEventListener('pointercancel', restoreToOrigin, listenerOptions);
  document.addEventListener(DRAG_CANCEL_EVENT, restoreToOrigin, listenerOptions);

  return () => ac.abort();

}
