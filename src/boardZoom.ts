import type { Board } from './board.ts';
import { DRAG_CANCEL_EVENT } from './draggable.ts';

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

type BoardZoomControllerOptions = {
  board: Board;
  scroller: HTMLElement;
  surface: HTMLElement;
  zoomTarget: HTMLElement;
  baseWidth: number;
  baseHeight: number;
};

export function createBoardZoomController({
  board,
  scroller,
  surface,
  zoomTarget,
  baseWidth,
  baseHeight,
}: BoardZoomControllerOptions) {
  let scale = 1;
  let minScale = 1;
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;

  const syncMinScale = () => {
    const widthScale = scroller.clientWidth > 0 ? scroller.clientWidth / baseWidth : 1;
    const heightScale = scroller.clientHeight > 0 ? scroller.clientHeight / baseHeight : 1;
    minScale = Math.max(MIN_ZOOM, Math.min(1, widthScale, heightScale));
  };

  const syncLayout = () => {
    const scaledWidth = baseWidth * scale;
    const scaledHeight = baseHeight * scale;
    const viewportWidth = scroller.clientWidth;
    const viewportHeight = scroller.clientHeight;
    const surfaceWidth = Math.max(scaledWidth, viewportWidth);
    const surfaceHeight = Math.max(scaledHeight, viewportHeight);
    const offsetX = Math.max(0, (surfaceWidth - scaledWidth) / 2);
    const offsetY = Math.max(0, (surfaceHeight - scaledHeight) / 2);

    surface.style.width = `${surfaceWidth}px`;
    surface.style.height = `${surfaceHeight}px`;
    zoomTarget.style.marginLeft = `${offsetX}px`;
    zoomTarget.style.marginTop = `${offsetY}px`;
    zoomTarget.style.transform = `scale(${scale})`;
    board.zoom = scale;
    scroller.classList.toggle('board-scroller--zoomed', scale > 1.001);
    if (Math.abs(scale - minScale) < 0.001) {
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    }
  };

  const zoomAroundClientPoint = (nextScale: number, clientX: number, clientY: number) => {
    const clampedScale = Math.min(MAX_ZOOM, Math.max(minScale, nextScale));
    if (Math.abs(clampedScale - scale) < 0.001) return;

    const rect = scroller.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const boardX = (scroller.scrollLeft + localX) / scale;
    const boardY = (scroller.scrollTop + localY) / scale;

    scale = clampedScale;
    syncLayout();

    scroller.scrollLeft = boardX * scale - localX;
    scroller.scrollTop = boardY * scale - localY;
  };

  scroller.addEventListener('wheel', (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const zoomFactor = Math.exp(-event.deltaY * WHEEL_ZOOM_SENSITIVITY);
    zoomAroundClientPoint(scale * zoomFactor, event.clientX, event.clientY);
  }, { passive: false });

  scroller.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
    pinchStartScale = scale;
    document.dispatchEvent(new Event(DRAG_CANCEL_EVENT));
  }, { passive: false });

  scroller.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 2 || pinchStartDistance === null) return;
    event.preventDefault();
    const nextDistance = touchDistance(event.touches[0], event.touches[1]);
    const midpoint = touchMidpoint(event.touches[0], event.touches[1]);
    const nextScale = pinchStartScale * (nextDistance / pinchStartDistance);
    zoomAroundClientPoint(nextScale, midpoint.x, midpoint.y);
  }, { passive: false });

  const resetPinchState = () => {
    if (pinchStartDistance === null) return;
    pinchStartDistance = null;
    pinchStartScale = scale;
  };

  scroller.addEventListener('touchend', resetPinchState);
  scroller.addEventListener('touchcancel', resetPinchState);

  const syncViewportScale = () => {
    const wasAtMinScale = Math.abs(scale - minScale) < 0.01;
    syncMinScale();
    if (wasAtMinScale || scale < minScale) {
      scale = minScale;
      syncLayout();
    }
  };

  if ('ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver(syncViewportScale);
    resizeObserver.observe(scroller);
  }

  syncMinScale();
  scale = minScale;
  syncLayout();
}

function touchDistance(firstTouch: Touch, secondTouch: Touch): number {
  return Math.hypot(firstTouch.clientX - secondTouch.clientX, firstTouch.clientY - secondTouch.clientY);
}

function touchMidpoint(firstTouch: Touch, secondTouch: Touch): { x: number; y: number } {
  return {
    x: (firstTouch.clientX + secondTouch.clientX) / 2,
    y: (firstTouch.clientY + secondTouch.clientY) / 2,
  };
}
