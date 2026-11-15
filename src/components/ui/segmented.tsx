// src/components/ui/segmented.tsx
'use client';

// 分段控件（0.5.1）：一个带滑动药丸的 Segmented。
// 照片库的排序、评分页的筛选、设置的服务商/评分方式都换成它，
// 取代之前「一排裸文字按钮 + 各自描边」造成的视觉噪音。
//
// 注意（0.5.1 修）：设置页的 Segmented 是随 SSR 首屏水合的，水合期
// useLayoutEffect 里的 setState 可能被吞掉，导致药丸永远不渲染。
// 因此这里改成「逐帧重试直到量到尺寸」，并在每次渲染后补测一次。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  title?: string;
  /** 右侧的次要数字，例如张数 */
  badge?: React.ReactNode;
}

interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  className?: string;
  /** 等宽铺满容器 */
  block?: boolean;
  ariaLabel?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className,
  block = false,
  ariaLabel,
}: SegmentedProps<T>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const [ready, setReady] = useState(false);

  /** 量当前项的位置；量不到返回 false（用于重试） */
  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const el = itemRefs.current.get(value);
    if (!wrap || !el) return false;
    const w = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width === 0) return false;
    const next = { left: r.left - w.left, width: r.width };
    setPill((prev) =>
      prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.width - next.width) < 0.5
        ? prev
        : next,
    );
    return true;
  }, [value]);

  // 首帧落位：量不到就逐帧重试（最多 40 帧 ≈ 650ms），量到后再开过渡
  useLayoutEffect(() => {
    let raf = 0;
    let tries = 0;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (measure()) {
        raf = requestAnimationFrame(() => setReady(true));
        return;
      }
      if (tries++ < 40) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  // 容器尺寸变化（换行、侧栏展开、窗口缩放）时重新落位
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [measure]);

  const h = size === 'sm' ? 'h-7 text-[11px]' : 'h-8 text-xs';

  return (
    <div
      ref={wrapRef}
      role="tablist"
      aria-label={ariaLabel}
      data-pill={pill ? `${Math.round(pill.left)}/${Math.round(pill.width)}` : 'none'}
      data-ready={ready ? '1' : '0'}
      className={cn(
        'relative inline-flex items-center rounded-full border border-line/60 bg-surface-2/80 p-0.5',
        block && 'flex w-full',
        className,
      )}
    >
      {pill && (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute top-0.5 bottom-0.5 rounded-full bg-ink',
            ready && 'transition-[transform,width] duration-[280ms] ease-[var(--ease-out)]',
          )}
          style={{ transform: `translateX(${pill.left}px)`, width: pill.width }}
        />
      )}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              if (el) itemRefs.current.set(option.value, el);
              else itemRefs.current.delete(option.value);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3 whitespace-nowrap transition-colors duration-200',
              h,
              block && 'flex-1',
              active ? 'text-paper' : 'text-ink-mid hover:text-ink',
            )}
          >
            {option.label}
            {option.badge !== undefined && (
              <span
                className={cn(
                  'text-[10px] tabular-nums transition-colors duration-200',
                  active ? 'text-paper/60' : 'text-ink-faint',
                )}
              >
                {option.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
