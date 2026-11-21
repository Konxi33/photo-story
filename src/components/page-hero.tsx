// src/components/page-hero.tsx
// 页面统一页首（0.7.1 重做）。
//
// 0.7.0 只是把「眉标 + 标题 + 说明 + 动作」对齐成一条；
// 0.7.1 让它真正有版式：铜色短标尺 + 大标题下的呼吸、可选右侧图示槽、
// 数字读数靠右坐、分隔线改成从铜到透明的渐隐——比一条死板的灰线更像印刷品。
//
// 只负责排版，不接管数据或交互。

'use client';

import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeroProps {
  /** 顶部小字，例如 GALLERY / STUDIO */
  eyebrow?: string;
  /** 眉标左侧的序号（可选），印刷感的 01 / 02… */
  index?: string;
  title: string;
  description?: ReactNode;
  /** 标题右侧的补充读数，如「32 / 140 张」 */
  meta?: ReactNode;
  /** 右上角动作区（按钮、下拉等） */
  actions?: ReactNode;
  /** 右侧图示槽：放一个迷你网格、缩略图或统计数据 */
  aside?: ReactNode;
  /** 页首下面是否带分隔线 */
  divider?: boolean;
  className?: string;
}

export function PageHero({
  eyebrow,
  index,
  title,
  description,
  meta,
  actions,
  aside,
  divider = true,
  className,
}: PageHeroProps) {
  return (
    <header className={cn('ps-enter relative', className)} style={{ '--ps-delay': '20ms' } as CSSProperties}>
      <div
        className={cn(
          'flex flex-wrap items-end justify-between gap-x-8 gap-y-5',
          aside && 'lg:flex-nowrap',
        )}
      >
        <div className="min-w-0 flex-1">
          {(eyebrow || index) && (
            <p className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="h-[3px] w-6 rounded-full bg-gradient-to-r from-copper to-copper/25"
              />
              {index && (
                <span className="text-[10px] font-semibold tracking-[0.18em] text-copper/80 tabular-nums">
                  {index}
                </span>
              )}
              {eyebrow && (
                <span className="text-[10.5px] font-medium tracking-[0.18em] text-ink-faint uppercase">
                  {eyebrow}
                </span>
              )}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
            <h1 className="ps-display text-[clamp(26px,3.1vw,40px)] leading-[1.06] tracking-[-0.02em] text-ink">
              {title}
            </h1>
            {meta && (
              <span className="ps-num shrink-0 pb-1 text-[11.5px] text-ink-faint">{meta}</span>
            )}
          </div>

          {description && (
            <p className="mt-3 max-w-[52rem] text-[12.5px] leading-[1.78] text-ink-mid">
              {description}
            </p>
          )}
        </div>

        {aside && <div className="hidden shrink-0 lg:block">{aside}</div>}

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:pb-1">{actions}</div>
        )}
      </div>

      {divider && (
        <div
          aria-hidden
          className="mt-7 h-px w-full bg-[linear-gradient(90deg,color-mix(in_srgb,var(--copper)_34%,transparent),color-mix(in_srgb,var(--color-line)_60%,transparent)_34%,transparent_88%)]"
        />
      )}
    </header>
  );
}
