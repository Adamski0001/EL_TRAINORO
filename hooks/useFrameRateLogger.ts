import { useEffect } from 'react';

const getNow = () => {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
};

export function useFrameRateLogger(label: string, enabled: boolean, thresholdFps = 55) {
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    let mounted = true;
    let frameCount = 0;
    let sumFps = 0;
    let minFps = Number.POSITIVE_INFINITY;
    let lastTs = getNow();
    let rafId: number;

    const loop = () => {
      if (!mounted) {
        return;
      }
      const now = getNow();
      const delta = now - lastTs;
      lastTs = now;
      const fps = delta > 0 ? 1000 / delta : 0;
      frameCount += 1;
      sumFps += fps;
      if (fps < minFps) {
        minFps = fps;
      }

      if (frameCount >= 120) {
        const avg = sumFps / frameCount;
        if (avg < thresholdFps) {
          console.log(`[%cPerf%c][${label}] avg ${avg.toFixed(1)} fps (min ${minFps.toFixed(1)})`, 'color:#22d3ee', '');
        }
        frameCount = 0;
        sumFps = 0;
        minFps = Number.POSITIVE_INFINITY;
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafId);
    };
  }, [enabled, label, thresholdFps]);
}
