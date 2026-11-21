'use client';

// src/components/studio/preset-card.tsx
// 0.7.2：一套版式 = 一张整页缩略图 + 名字。
//
// 之前方案库是一行行文字（「摄影集 / 整页大图，下面一行图注…」），要读才知道长什么样。
// 现在直接画出来：12×24 的每一块在哪、多大、谁压着谁，一眼看完。

import { Check, X } from 'lucide-react';

import type { LayoutItem } from '@/lib/export/layout';
import { cn } from '@/lib/utils';

import { MiniLayout } from './mini-layout';

interface PresetCardProps {
  name: string;
  items: LayoutItem[];
  /** 悬停时的完整说明（原生 title，够用且不抢版面） */
  hint?: string;
  /** 当前正在用的那套 */
  active?: boolean;
  onApply: () => void;
  /** 我存的方案才有删除 */
  onRemove?: () => void;
}

export function PresetCard({ name, items, hint, active = false, onApply, onRemove }: PresetCardProps) {
  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={onApply}
        title={hint ? `${name} —— ${hint}` : name}
        aria-pressed={active}
        className={cn(
          'ps-tile flex w-full items-center gap-1.5 rounded-xl border px-1.5 py-1.5 text-left',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper',
          active
            ? 'border-copper bg-copper/10 shadow-[inset_0_0_0_1px_var(--color-copper)]'
            : 'border-line/60 bg-surface-2/30 hover:border-line hover:bg-surface-2/60',
        )}
      >
        <MiniLayout items={items} rules className="w-[26px]" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <span
              className={cn(
                'truncate text-[11.5px] font-medium',
                active ? 'text-copper' : 'text-ink',
              )}
            >
              {name}
            </span>
            {active ? <Check className="size-3 shrink-0 text-copper" aria-hidden /> : null}
          </span>
          <span className="mt-0.5 block text-[10px] leading-tight text-ink-faint">
            {items.length} 块
          </span>
        </span>
      </button>

      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`删掉方案 ${name}`}
          className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full border border-line bg-surface text-ink-faint opacity-0 transition-opacity duration-150 hover:text-rose-500 focus-visible:opacity-100 group-hover:opacity-100"
        >
          <X className="size-2.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
