// src/components/ui/count-up.tsx
'use client';

// 数字滚动（0.5.1）：统计卡片的数字从 0 滚到目标值。
// 用 rAF + 缓出曲线，避免引入动画库；尊重 prefers-reduced-motion。
//
// 0.8.0：接上设置里的「数字滚动」区域开关与 --motion-scale。
// 关掉这个区域、或总档位是「关闭」时，数字直接是结果，不再从 0 滚 ——
// 低性能机器上这种每帧 setState 的滚动是最该先砍掉的东西。

import { useEffect, useRef, useState } from 'react';

import { motionEnabled, motionScale } from '@/lib/motion-prefs';

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
    const settle = (): void => {
      setShown(value);
      doneRef.current = true;
      fromRef.current = value;
    };

    // 区域关掉 / 总档位关闭：不滚，直接给结果
    const scaled = duration * motionScale();
    if (!motionEnabled('numbers') || scaled < 60) {
      settle();
      return;
    }

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      settle();
      return;
    }

    if (doneRef.current && !replayOnChange) {
      settle();
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / scaled);
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

  return <span className={className ?? 'ps-num'}>{shown.toFixed(decimals)}</span>;
}
