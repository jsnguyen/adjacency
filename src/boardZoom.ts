import type { Board } from './board.ts';
import { DRAG_CANCEL_EVENT } from './draggable.ts';

const MIN_ZOOM = 0.45;
const MAX_ZOOM = 2.6;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WHEEL_LINE_HEIGHT_PX = 16;
const WHEEL_PAGE_HEIGHT_PX = 800;
const PINCH_INERTIA_DURATION_MS = 180;
const PINCH_INERTIA_PROJECTION_MS = 85;
const PAN_DRAG_MULTIPLIER = 0.84;
const PAN_INERTIA_MULTIPLIER = 0.5;
const PAN_FRICTION = 0.86;
const PAN_FRAME_MS = 16;
const MIN_PAN_VELOCITY = 0.035;
const MAX_PAN_VELOCITY = 0.9;
const PAN_VELOCITY_SMOOTHING = 0.34;

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
  let offsetX = 0;
  let offsetY = 0;
  let pinchStartDistance: number | null = null;
  let pinchStartScale = 1;
  let pinchLastScale = 1;
  let pinchLastTime = 0;
  let pinchVelocity = 0;
  let pinchLastMidpoint: { x: number; y: number } | null = null;
  let zoomAnimationFrameId: number | null = null;
  let panAnimationFrameId: number | null = null;
  let panState: {
    pointerId: number;
    lastX: number;
    lastY: number;
    lastTime: number;
    velocityX: number;
    velocityY: number;
  } | null = null;

  const cancelZoomAnimation = () => {
    if (zoomAnimationFrameId !== null) {
      window.cancelAnimationFrame(zoomAnimationFrameId);
      zoomAnimationFrameId = null;
    }
  };

  const cancelPanAnimation = () => {
    if (panAnimationFrameId !== null) {
      window.cancelAnimationFrame(panAnimationFrameId);
      panAnimationFrameId = null;
    }
  };

  const shouldStartPan = (event: PointerEvent): boolean => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return false;
    if (scale <= minScale + 0.01) return false;
    const target = event.target;
    return !(target instanceof Element && target.closest('.play-tile, button, input, textarea, select'));
  };

  const startPanInertia = (velocityX: number, velocityY: number) => {
    cancelPanAnimation();
    let nextVelocityX = clampPanVelocity(velocityX * PAN_INERTIA_MULTIPLIER);
    let nextVelocityY = clampPanVelocity(velocityY * PAN_INERTIA_MULTIPLIER);

    const tick = () => {
      scroller.scrollLeft += nextVelocityX * PAN_FRAME_MS;
      scroller.scrollTop += nextVelocityY * PAN_FRAME_MS;
      nextVelocityX *= PAN_FRICTION;
      nextVelocityY *= PAN_FRICTION;
      if (Math.hypot(nextVelocityX, nextVelocityY) > MIN_PAN_VELOCITY) {
        panAnimationFrameId = window.requestAnimationFrame(tick);
        return;
      }
      panAnimationFrameId = null;
    };

    if (Math.hypot(nextVelocityX, nextVelocityY) > MIN_PAN_VELOCITY) {
      panAnimationFrameId = window.requestAnimationFrame(tick);
    }
  };

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
    offsetX = Math.max(0, (surfaceWidth - scaledWidth) / 2);
    offsetY = Math.max(0, (surfaceHeight - scaledHeight) / 2);

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
    const boardX = (scroller.scrollLeft + localX - offsetX) / scale;
    const boardY = (scroller.scrollTop + localY - offsetY) / scale;

    scale = clampedScale;
    syncLayout();

    scroller.scrollLeft = boardX * scale + offsetX - localX;
    scroller.scrollTop = boardY * scale + offsetY - localY;
  };

  const animateZoomAroundClientPoint = (
    nextScale: number,
    clientX: number,
    clientY: number,
    durationMs = PINCH_INERTIA_DURATION_MS,
  ) => {
    cancelZoomAnimation();
    const startScale = scale;
    const clampedScale = Math.min(MAX_ZOOM, Math.max(minScale, nextScale));
    if (Math.abs(clampedScale - startScale) < 0.001) return;
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      const easedProgress = 1 - (1 - progress) ** 3;
      zoomAroundClientPoint(startScale + (clampedScale - startScale) * easedProgress, clientX, clientY);
      if (progress < 1) {
        zoomAnimationFrameId = window.requestAnimationFrame(tick);
        return;
      }
      zoomAnimationFrameId = null;
    };

    zoomAnimationFrameId = window.requestAnimationFrame(tick);
  };

  const normalizedWheelDelta = (event: WheelEvent): number => {
    const rawDelta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return rawDelta * WHEEL_LINE_HEIGHT_PX;
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return rawDelta * WHEEL_PAGE_HEIGHT_PX;
    return rawDelta;
  };

  scroller.addEventListener('wheel', (event) => {
    event.preventDefault();
    cancelZoomAnimation();
    cancelPanAnimation();
    const wheelDelta = normalizedWheelDelta(event);
    if (Math.abs(wheelDelta) < 0.01) return;
    const zoomFactor = Math.exp(-wheelDelta * WHEEL_ZOOM_SENSITIVITY);
    zoomAroundClientPoint(scale * zoomFactor, event.clientX, event.clientY);
  }, { passive: false });

  scroller.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    cancelZoomAnimation();
    cancelPanAnimation();
    panState = null;
    pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
    pinchStartScale = scale;
    pinchLastScale = scale;
    pinchLastTime = performance.now();
    pinchVelocity = 0;
    pinchLastMidpoint = touchMidpoint(event.touches[0], event.touches[1]);
    document.dispatchEvent(new Event(DRAG_CANCEL_EVENT));
  }, { passive: false });

  scroller.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 2 || pinchStartDistance === null) return;
    event.preventDefault();
    const nextDistance = touchDistance(event.touches[0], event.touches[1]);
    const midpoint = touchMidpoint(event.touches[0], event.touches[1]);
    const nextScale = pinchStartScale * (nextDistance / pinchStartDistance);
    const now = performance.now();
    const elapsed = Math.max(1, now - pinchLastTime);
    zoomAroundClientPoint(nextScale, midpoint.x, midpoint.y);
    pinchVelocity = (scale - pinchLastScale) / elapsed;
    pinchLastScale = scale;
    pinchLastTime = now;
    pinchLastMidpoint = midpoint;
  }, { passive: false });

  const resetPinchState = () => {
    if (pinchStartDistance === null) return;
    pinchStartDistance = null;
    pinchStartScale = scale;
    if (pinchLastMidpoint && Math.abs(pinchVelocity) > 0.00045) {
      animateZoomAroundClientPoint(
        scale + pinchVelocity * PINCH_INERTIA_PROJECTION_MS,
        pinchLastMidpoint.x,
        pinchLastMidpoint.y,
      );
    }
    pinchVelocity = 0;
    pinchLastMidpoint = null;
  };

  scroller.addEventListener('touchend', resetPinchState);
  scroller.addEventListener('touchcancel', resetPinchState);

  scroller.addEventListener('pointerdown', (event) => {
    if (!shouldStartPan(event)) return;
    cancelPanAnimation();
    panState = {
      pointerId: event.pointerId,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocityX: 0,
      velocityY: 0,
    };
    scroller.setPointerCapture(event.pointerId);
  });

  scroller.addEventListener('pointermove', (event) => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    event.preventDefault();
    const now = performance.now();
    const elapsed = Math.max(8, now - panState.lastTime);
    const deltaX = event.clientX - panState.lastX;
    const deltaY = event.clientY - panState.lastY;
    const scrollDeltaX = -deltaX * PAN_DRAG_MULTIPLIER;
    const scrollDeltaY = -deltaY * PAN_DRAG_MULTIPLIER;
    scroller.scrollLeft += scrollDeltaX;
    scroller.scrollTop += scrollDeltaY;
    panState.velocityX = smoothPanVelocity(panState.velocityX, scrollDeltaX / elapsed);
    panState.velocityY = smoothPanVelocity(panState.velocityY, scrollDeltaY / elapsed);
    panState.lastX = event.clientX;
    panState.lastY = event.clientY;
    panState.lastTime = now;
  });

  const stopPan = (event: PointerEvent) => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    const { velocityX, velocityY } = panState;
    panState = null;
    startPanInertia(velocityX, velocityY);
  };

  scroller.addEventListener('pointerup', stopPan);
  scroller.addEventListener('pointercancel', (event) => {
    if (panState?.pointerId === event.pointerId) {
      panState = null;
    }
  });

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

function smoothPanVelocity(previousVelocity: number, nextVelocity: number): number {
  return clampPanVelocity(
    previousVelocity * (1 - PAN_VELOCITY_SMOOTHING) + nextVelocity * PAN_VELOCITY_SMOOTHING,
  );
}

function clampPanVelocity(velocity: number): number {
  return Math.max(-MAX_PAN_VELOCITY, Math.min(MAX_PAN_VELOCITY, velocity));
}
