// src/components/ui/count-up.tsx
'use client';

// 数字滚动（0.5.1）：统计卡片的数字从 0 滚到目标值。
// 用 rAF + 缓出曲线，避免引入动画库；尊重 prefers-reduced-motion。

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  /** 小数位，默认 0 */
  decimals?: number;
  duration?: number;
  className?: string;
  /** 数值变化时是否重新滚动（默认只首次滚） */
  replayOnChange?: boolean;
}

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

export function CountUp({
  value,
  decimals = 0,
  duration = 720,
  className,
  replayOnChange = false,
}: CountUpProps) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(0);
  const doneRef = useRef(false);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      setShown(value);
      return;
    }

    if (doneRef.current && !replayOnChange) {
      setShown(value);
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (value - from) * easeOut(t);
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        doneRef.current = true;
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, replayOnChange]);

  return <span className={className}>{shown.toFixed(decimals)}</span>;
}
