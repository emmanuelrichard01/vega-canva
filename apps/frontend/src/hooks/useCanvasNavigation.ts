import { useState, useEffect, useRef } from 'react';
import { cameraSystem } from '../engine/CameraSystem';
import { presenceManager } from '../engine/presence/PresenceManager';
import { engineEvents } from '../engine/EventBus';

export interface CanvasNavigationOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  stageRef: React.RefObject<any>;
  onCancelInteractions?: () => void;
}

export function useCanvasNavigation({
  containerRef,
  onCancelInteractions,
}: CanvasNavigationOptions) {
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const pinchRef = useRef<{ dist: number; midX: number; midY: number } | null>(null);
  const isMultiTouchRef = useRef(false);

  // ResizeObserver for canvas dimensions with SSR/Node environment guard
  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 800);
      const h = containerRef.current.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 600);
      if (w <= 0 || h <= 0) return;
      setDimensions({ width: w, height: h });
      cameraSystem.resize(w, h);
    };

    if (typeof ResizeObserver === 'undefined') {
      updateSize();
      return;
    }

    const observer = new ResizeObserver(() => {
      updateSize();
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    updateSize();

    return () => observer.disconnect();
  }, [containerRef]);

  // Viewport presence broadcast on CameraChanged
  useEffect(() => {
    const publish = () => {
      presenceManager.updateViewport({
        x: -cameraSystem.x / cameraSystem.zoom,
        y: -cameraSystem.y / cameraSystem.zoom,
        width: cameraSystem.width,
        height: cameraSystem.height,
        zoom: cameraSystem.zoom,
      });
    };
    publish();
    engineEvents.on('CameraChanged', publish);
    return () => {
      engineEvents.off('CameraChanged', publish);
    };
  }, []);

  // Wheel and trackpad pan/zoom, bound natively with non-passive listener
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (evt: WheelEvent) => {
      evt.preventDefault();
      if (evt.ctrlKey) {
        cameraSystem.zoomByWheel(evt.deltaY, evt.clientX, evt.clientY);
      } else {
        cameraSystem.pan(evt.deltaX, evt.deltaY);
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef]);

  const touchMetrics = (touches: TouchList) => {
    const [a, b] = [touches[0], touches[1]];
    const dx = b.clientX - a.clientX;
    const dy = b.clientY - a.clientY;
    return {
      dist: Math.hypot(dx, dy) || 1,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
    };
  };

  const handleTouchStartNative = (e: React.TouchEvent) => {
    if (e.touches.length >= 2) {
      isMultiTouchRef.current = true;
      pinchRef.current = touchMetrics(e.touches as unknown as TouchList);
      onCancelInteractions?.();
    }
  };

  const handleTouchMoveNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2 || !pinchRef.current) return;
    e.preventDefault();

    const next = touchMetrics(e.touches as unknown as TouchList);
    const prev = pinchRef.current;

    cameraSystem.zoomBy(next.dist / prev.dist, next.midX, next.midY);
    cameraSystem.panBy(next.midX - prev.midX, next.midY - prev.midY);

    pinchRef.current = next;
  };

  const handleTouchEndNative = (e: React.TouchEvent) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
      if (e.touches.length === 0) isMultiTouchRef.current = false;
    }
  };

  return {
    dimensions,
    isMultiTouchRef,
    handleTouchStartNative,
    handleTouchMoveNative,
    handleTouchEndNative,
  };
}
