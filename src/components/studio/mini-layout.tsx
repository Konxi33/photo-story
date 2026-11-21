'use client';

// src/components/studio/mini-layout.tsx
// 0.7.2：12×24 版式的「迷你网格缩略图」—— 纯 CSS（div + 百分比定位），不用任何图片。
//
// 一个 LayoutItem 画成一个小方块：col/row/colSpan/rowSpan 直接换算成百分比，
// 所以「这个块占几列几行、在纸上的哪一角」一眼就能看出来。
// 颜色由 globals.css 的 .ps-mini-block[data-tone] 决定（铜=版面、墨=文字、暗房蓝=解读），
// 底色永远是纸白 —— 缩略图代表「印出来的纸」，深浅主题下都该是白的。

import { cn } from '@/lib/utils';
import { GRID_COLS, GRID_ROWS, type LayoutItem } from '@/lib/export/layout';

import { BLOCK_TONE } from './block-skin';

interface MiniLayoutProps {
  /** 要画的块（一般就是 layout.items） */
  items: LayoutItem[];
  cols?: number;
  rows?: number;
  /** 只控制宽度（w-10 / w-full …），高度按纸张比例自动算 */
  className?: string;
  /** 只突出这一块，其余压暗 */
  highlight?: LayoutItem['id'] | null;
  /** 画极淡的格线 —— 缩略图大一点时才画，太小会糊成一团 */
  rules?: boolean;
  /** 空心虚线：表示「这个块还没摆到纸上」 */
  ghost?: boolean;
}

export function MiniLayout({
  items,
  cols = GRID_COLS,
  rows = GRID_ROWS,
  className,
  highlight = null,
  rules = false,
  ghost = false,
}: MiniLayoutProps) {
  return (
    <div
      aria-hidden
      className={cn('ps-mini shrink-0', className)}
      style={{ aspectRatio: `${cols} / ${rows}` }}
    >
      {rules ? (
        <div
          className="ps-mini-lines"
          style={{ backgroundSize: `${100 / cols}% ${100 / rows}%` }}
        />
      ) : null}
      {items.map((item) => {
        const focused = !highlight || highlight === item.id;
        return (
          <span
            key={item.id}
            data-block={item.id}
            data-tone={BLOCK_TONE[item.id]}
            data-solid={item.id === 'image' ? '1' : undefined}
            data-dim={focused ? undefined : '1'}
            data-ghost={ghost ? '1' : undefined}
            className="ps-mini-block"
            style={{
              left: `${(item.col / cols) * 100}%`,
              top: `${(item.row / rows) * 100}%`,
              width: `${(item.colSpan / cols) * 100}%`,
              height: `${(item.rowSpan / rows) * 100}%`,
            }}
          />
        );
      })}
    </div>
  );
}
