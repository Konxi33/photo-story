// src/components/workbench/PhotoStoryPreview.tsx
'use client';

// 大图预览（含文字）。0.5.2 重做：
//   · 打开时从缩略图位置长出来（FLIP），关闭时缩回去——不再「凭空打开」；
//   · 左右切换有方向感，照片横向滑入；
//   · 版式收紧，底部操作固定在列底（sticky），不用滑到底才能看到按钮。
// 0.5.5：整块渲染到 document.body（portal）。否则页面转场留在祖先上的
// transform/filter 会成为 fixed 的包含块，按日期分组的长页面里浮层会被
// 按 5000px 的高度居中，跑到屏幕外（用户报的「全屏模糊、看不到预览」）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Images, Pencil, Star, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { growFrom, shrinkTo, slideIn, type ScreenRect } from '@/lib/motion';
import { cn, formatDate } from '@/lib/utils';
import type { Photo } from '@/types/domain';

interface PhotoStoryPreviewProps {
  photos: Photo[];
  index: number;
  previews: Record<string, string>;
  isCover?: boolean;
  /** 打开前缩略图在屏幕上的位置，用来做 FLIP 放大 */
  origin?: ScreenRect | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onEdit?: (id: string) => void;
  onSetCover?: (id: string) => void;
  /** 0.3.2：给当前照片评分（返回是否成功） */
  onScore?: (id: string) => Promise<boolean>;
}

const STATUS_TEXT: Record<Photo['status'], string> = {
  idle: '待处理',
  processing: '处理中',
  success: '已生成',
  failed: '失败',
};

const TECH_LABELS: { key: keyof NonNullable<Photo['analysis']>['technique']; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '色彩' },
  { key: 'lens', label: '镜头' },
  { key: 'post', label: '后期' },
];

export function PhotoStoryPreview({
  photos,
  index,
  previews,
  isCover = false,
  origin,
  onClose,
  onNavigate,
  onEdit,
  onSetCover,
  onScore,
}: PhotoStoryPreviewProps) {
  const photo = photos[index];
  const total = photos.length;
  const [zoomed, setZoomed] = useState(false);
  const [scoring, setScoring] = useState(false);

  const panelRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const closingRef = useRef(false);
  const prevIndexRef = useRef(index);

  // 打开：从缩略图长出来
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const anim = growFrom(el, origin);
    return () => anim.cancel();
    // 只在挂载时跑一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换：按方向滑入
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const dir: 1 | -1 = index >= prevIndexRef.current ? 1 : -1;
    if (index === prevIndexRef.current) return;
    prevIndexRef.current = index;
    const anim = slideIn(el, dir);
    return () => anim.cancel();
  }, [index]);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = panelRef.current;
    if (!el) {
      onClose();
      return;
    }
    void shrinkTo(el, origin).then(() => onClose());
  }, [onClose, origin]);

  const runScore = async (): Promise<void> => {
    if (!onScore || !photo || scoring) return;
    setScoring(true);
    try {
      await onScore(photo.id);
    } finally {
      setScoring(false);
    }
  };

  const prev = useCallback(() => {
    if (total === 0) return;
    setZoomed(false);
    onNavigate((index - 1 + total) % total);
  }, [index, total, onNavigate]);

  const next = useCallback(() => {
    if (total === 0) return;
    setZoomed(false);
    onNavigate((index + 1) % total);
  }, [index, total, onNavigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose();
      // 0.5.6：除了方向键，再补一套 J / K（和修图软件的习惯一致）
      if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') prev();
      if (e.key === 'ArrowRight' || e.key === 'k' || e.key === 'K') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, requestClose]);

  if (!photo) return null;
  const url = previews[photo.id];
  const a = photo.analysis;

  const step = (i: number): React.CSSProperties => ({ animationDelay: `${100 + i * 60}ms` });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal>
      {/* 背景：高斯模糊 + 点击关闭 */}
      <button
        type="button"
        aria-label="关闭预览"
        onClick={requestClose}
        className="absolute inset-0 cursor-default bg-black/62 backdrop-blur-2xl"
        style={{ animation: 'ps-fade-in 280ms var(--ease-out) both' }}
      />

      <div
        ref={panelRef}
        className="group relative flex max-h-[calc(100vh-2rem)] w-full max-w-[1180px] flex-col overflow-hidden rounded-[20px] border border-line/40 bg-paper shadow-[0_60px_120px_-40px_rgba(0,0,0,0.72)] md:max-h-[calc(100vh-3rem)] md:flex-row"
      >
        {/* 照片区 */}
        <div
          ref={stageRef}
          className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0b0b0d] p-2 md:basis-[58%] md:p-5"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={a?.alt ?? photo.fileName}
              onClick={() => setZoomed((z) => !z)}
              draggable={false}
              className={cn(
                'select-none rounded-lg transition-transform duration-[600ms] ease-[var(--ease-out)]',
                zoomed
                  ? 'max-h-none max-w-none cursor-zoom-out'
                  : 'max-h-[42vh] max-w-full cursor-zoom-in object-contain md:max-h-[calc(100vh-8rem)]',
              )}
            />
          ) : (
            <div className="flex h-56 w-full items-center justify-center text-white/50">
              <Images className="h-8 w-8" />
            </div>
          )}

          {total > 1 && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={prev}
                aria-label="上一张"
                className="absolute top-1/2 left-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 hover:bg-black/55 hover:text-white focus-visible:opacity-100"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={next}
                aria-label="下一张"
                className="absolute top-1/2 right-2 h-9 w-9 -translate-y-1/2 rounded-full bg-black/35 text-white opacity-0 backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 hover:bg-black/55 hover:text-white focus-visible:opacity-100"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}

          <span className="absolute right-3 bottom-3 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] tabular-nums text-white/85 backdrop-blur-sm">
            {index + 1} / {total}
          </span>
        </div>

        {/* 文字区：独立滚动，底部操作常驻可见 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain md:basis-[42%]">
          <div className="px-5 pt-5 md:px-6">
            <div className="ps-slide-up flex flex-wrap items-center gap-1.5" style={step(0)}>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-mid">
                {STATUS_TEXT[photo.status]}
              </span>
              {isCover && (
                <span className="rounded-full bg-amber-400/90 px-2 py-0.5 text-[10px] font-medium text-black/75">
                  封面
                </span>
              )}
              {photo.isEdited && (
                <span className="rounded-full border border-line/80 px-2 py-0.5 text-[10px] text-ink-faint">
                  已手改
                </span>
              )}
              <span className="ml-auto text-[11px] tabular-nums text-ink-faint">
                {formatDate(photo.updatedAt)}
              </span>
            </div>

            <h2
              className="ps-slide-up ps-display mt-2.5 text-[24px] leading-[1.25] font-semibold text-ink"
              style={step(1)}
            >
              {a?.title || photo.fileName}
            </h2>

            {a?.mood && (
              <p className="ps-slide-up mt-1 text-[12px] tracking-wide text-ink-faint" style={step(2)}>
                {a.mood}
              </p>
            )}

            {/* 拍摄参数：焦段 / 光圈 / 快门 / ISO / 调色 */}
            {a?.params && (
              <div className="ps-slide-up mt-2.5 flex flex-wrap gap-1.5" style={step(2)}>
                {[
                  ['焦段', a.params.focalLength],
                  ['光圈', a.params.aperture],
                  ['快门', a.params.shutter],
                  ['ISO', a.params.iso],
                  ['调色', a.params.colorGrade],
                ]
                  .filter(([, value]) => value && value.trim())
                  .map(([label, value]) => (
                    <span
                      key={label}
                      className="inline-flex items-baseline gap-1 rounded-full border border-line/70 bg-surface/70 px-2 py-0.5 text-[11px]"
                    >
                      <span className="text-ink-faint">{label}</span>
                      <span className="font-medium tabular-nums text-ink-mid">{value}</span>
                    </span>
                  ))}
              </div>
            )}

            <p className="ps-slide-up mt-3.5 text-[13.5px] leading-[1.8] text-ink-mid" style={step(3)}>
              {a?.story || '这张照片还没有生成故事。点下方「编辑」，可以让 AI 重写，或者自己动手写。'}
            </p>
          </div>

          <div className="px-5 pb-2 md:px-6">
            {/* 评分卡：有分显示分，没分显示入口 */}
            {a?.score ? (
              <div
                className="ps-slide-up mt-4 rounded-xl border border-line/60 bg-surface/70 p-3"
                style={step(3)}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
                    {a.score.overall.toFixed(1)}
                  </span>
                  <span className="text-[11px] text-ink-faint">/ 100 · 按赛事标准校准</span>
                  {onScore && (
                    <button
                      type="button"
                      onClick={() => void runScore()}
                      disabled={scoring}
                      className="ml-auto text-[11px] text-ink-faint underline-offset-2 transition-colors duration-200 hover:text-ink hover:underline"
                    >
                      {scoring ? '评分中…' : '重新评分'}
                    </button>
                  )}
                </div>

                <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {(
                    [
                      ['构图', a.score.breakdown.composition, 0.25],
                      ['光线', a.score.breakdown.lighting, 0.2],
                      ['调色', a.score.breakdown.color, 0.15],
                      ['主体', a.score.breakdown.subject, 0.2],
                      ['时机', a.score.breakdown.timing, 0.1],
                      ['技术', a.score.breakdown.technique, 0.1],
                    ] as const
                  ).map(([label, value, weight]) => (
                    <div key={label} className="grid gap-0.5">
                      <div className="flex items-baseline justify-between text-[10px]">
                        <span className="text-ink-faint">
                          {label}
                          <span className="ml-1 opacity-60">{(weight * 100).toFixed(0)}%</span>
                        </span>
                        <span className="tabular-nums text-ink-mid">{value.toFixed(1)}</span>
                      </div>
                      <div className="h-[3px] overflow-hidden rounded-full bg-ink/8">
                        <div
                          className="h-full rounded-full bg-ink/55 transition-[width] duration-700 ease-[var(--ease-out)]"
                          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {a.scoreAdvice && a.scoreAdvice.length > 0 && (
                  <ul className="mt-2.5 grid gap-1 border-t border-line/50 pt-2">
                    {a.scoreAdvice.map((tip) => (
                      <li key={tip} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-mid">
                        <span className="text-ink-faint">↗</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              onScore &&
              a && (
                <div
                  className="ps-slide-up mt-4 flex items-center gap-3 rounded-xl border border-dashed border-line/80 bg-surface-2/40 px-3 py-2.5"
                  style={step(3)}
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-ink-faint">
                    分
                  </span>
                  <div className="min-w-0">
                    <p className="text-[12px] text-ink">这张还没有评分</p>
                    <p className="text-[10.5px] text-ink-faint">
                      按赛事标准打分，并给出可执行的改进建议
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runScore()}
                    disabled={scoring}
                    className="ml-auto shrink-0 rounded-full bg-ink px-3 py-1 text-[11px] text-paper transition-opacity duration-200 hover:opacity-88 disabled:opacity-60"
                  >
                    {scoring ? '评分中…' : '开始评分'}
                  </button>
                </div>
              )
            )}

            {a && (
              <div className="ps-slide-up mt-3 rounded-xl border border-line/60 bg-surface/70 p-3" style={step(4)}>
                <p className="ps-eyebrow mb-1.5">拍摄手法</p>
                <dl className="grid gap-1">
                  {TECH_LABELS.map(({ key, label }) =>
                    a.technique[key] ? (
                      <div key={key} className="grid grid-cols-[2.75rem_1fr] gap-2 text-[12.5px] leading-relaxed">
                        <dt className="text-ink-faint">{label}</dt>
                        <dd className="text-ink-mid">{a.technique[key]}</dd>
                      </div>
                    ) : null,
                  )}
                </dl>
              </div>
            )}

            {a && (a.whyGood?.length || a.improve?.length || a.imitate?.length) ? (
              <div className="ps-slide-up mt-2.5 grid gap-2" style={step(5)}>
                <BulletCard title="为什么好看" items={a.whyGood ?? []} tone="good" />
                <BulletCard title="可以更好" items={a.improve ?? []} tone="plain" />
                <BulletCard title="下次这样拍" items={a.imitate ?? []} tone="plain" />
              </div>
            ) : null}

            {a && a.tags.length > 0 && (
              <div className="ps-slide-up mt-3 flex flex-wrap gap-1.5" style={step(6)}>
                {a.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full border border-line/70 bg-surface-2/60 px-2.5 py-0.5 text-[11px] text-ink-mid"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {a?.alt && (
              <p className="ps-slide-up mt-2.5 text-[11px] leading-relaxed text-ink-faint" style={step(7)}>
                无障碍描述：{a.alt}
              </p>
            )}
          </div>

          {/* 固定在列底：不用滑到底也能操作 */}
          <div className="sticky bottom-0 mt-auto flex items-center gap-2 border-t border-line/50 bg-paper/88 px-5 py-2.5 backdrop-blur md:px-6">
            {onSetCover && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full"
                onClick={() => onSetCover(photo.id)}
              >
                <Star className={cn('mr-1.5 h-3.5 w-3.5', isCover && 'fill-amber-400 text-amber-500')} />
                {isCover ? '已是封面' : '设为封面'}
              </Button>
            )}
            {onEdit && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 rounded-full"
                onClick={() => {
                  onEdit(photo.id);
                  requestClose();
                }}
              >
                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                编辑
              </Button>
            )}
            <Button size="sm" className="ml-auto h-8 rounded-full px-4" onClick={requestClose}>
              关闭
            </Button>
          </div>
        </div>

        <button
          type="button"
          onClick={requestClose}
          aria-label="关闭"
          className="absolute top-3 right-3 rounded-full bg-black/45 p-1.5 text-white/90 backdrop-blur-sm transition-[background-color,transform] duration-200 hover:scale-105 hover:bg-black/65 active:scale-95"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** 三块小卡：为什么好看 / 可以更好 / 下次这样拍 */
function BulletCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: 'good' | 'plain';
}) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-line/50 bg-surface-2/40 px-3 py-2">
      <p className="ps-eyebrow mb-1">{title}</p>
      <ul className="grid gap-1">
        {items.map((item) => (
          <li key={item} className="flex gap-1.5 text-[12px] leading-relaxed text-ink-mid">
            <span className={tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink-faint'}>
              {tone === 'good' ? '✓' : '·'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
