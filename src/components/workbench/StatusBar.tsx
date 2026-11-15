// src/components/workbench/StatusBar.tsx
// 0.5.1：底部状态条改成玻璃浮条——不再贴死屏幕边缘通栏，
// 而是居中悬浮的小胶囊，两侧留出呼吸；进度出现/消失用淡入淡出衔接。

'use client';

import { cn, clamp } from '@/lib/utils';

interface StatusBarProps {
  total: number;
  success: number;
  failed: number;
  processing: number;
  selected: number;
  progressValue: number;
}

export function StatusBar({
  total,
  success,
  failed,
  processing,
  selected,
  progressValue,
}: StatusBarProps) {
  const percent = Math.round(clamp(progressValue, 0, 100));
  const running = processing > 0;
  const active = percent > 0 || running;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center pb-3">
      <div className="pointer-events-auto flex h-10 items-center gap-2.5 rounded-full border border-line/50 bg-paper/82 px-4 text-[11.5px] text-ink-mid shadow-[0_10px_30px_-16px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <span className="inline-flex items-baseline gap-1">
          <b className="font-semibold text-ink tabular-nums">{total}</b>
          <span className="text-ink-faint">张</span>
        </span>

        <span className="h-3 w-px bg-line/80" />

        <span className="inline-flex items-center gap-1">
          <i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          <span className="tabular-nums text-ink">{success}</span>
        </span>
        <span className={cn('inline-flex items-center gap-1', failed > 0 && 'text-destructive')}>
          <i className={cn('h-1.5 w-1.5 rounded-full', failed > 0 ? 'bg-red-500' : 'bg-line')} />
          <span className="tabular-nums">{failed}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <i
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              running ? 'animate-pulse bg-blue-500' : 'bg-line',
            )}
          />
          <span className="tabular-nums text-ink">{processing}</span>
        </span>

        <span className="h-3 w-px bg-line/80" />

        <span className="text-ink-faint">
          已选 <b className="font-medium tabular-nums text-ink">{selected}</b>
        </span>

        {/* 0.5.0：空闲时不再挂一根 0% 的进度条，那看着像坏了 */}
        <span
          className={cn(
            'grid items-center overflow-hidden transition-[grid-template-columns,opacity] duration-[320ms] ease-[var(--ease-out)]',
            active ? 'grid-cols-[auto_auto] gap-2 opacity-100' : 'grid-cols-[0px_0px] opacity-0',
          )}
        >
          <span
            className="block h-[3px] w-24 overflow-hidden rounded-full bg-ink/10"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="批量生成进度"
          >
            <span
              className={cn(
                'block h-full rounded-full bg-ink/70 transition-[width] duration-500 ease-[var(--ease-out)]',
                running && 'ps-pulse-soft',
              )}
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="w-7 text-right tabular-nums text-ink-faint" aria-live="polite">
            {percent}%
          </span>
        </span>

        {!active && (
          <span className="text-ink-faint">{total > 0 ? '全部就绪' : '还没有照片'}</span>
        )}
      </div>
    </div>
  );
}
