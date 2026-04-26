import type { Board } from './board.ts';
import { DRAG_CANCEL_EVENT } from './draggable.ts';

const MIN_ZOOM = 1;
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
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;

  const syncLayout = () => {
    surface.style.width = `${baseWidth * scale}px`;
    surface.style.height = `${baseHeight * scale}px`;
    zoomTarget.style.transform = `scale(${scale})`;
    board.zoom = scale;
    scroller.classList.toggle('board-scroller--zoomed', scale > 1.001);
    if (scale === 1) {
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    }
  };

  const zoomAroundClientPoint = (nextScale: number, clientX: number, clientY: number) => {
    const clampedScale = clampScale(nextScale);
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

  syncLayout();
}

function clampScale(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
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
