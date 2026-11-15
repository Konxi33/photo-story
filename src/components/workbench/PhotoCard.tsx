// src/components/workbench/PhotoCard.tsx
// 0.5.1：照片卡重做——图片按真实比例铺满、状态与操作改成悬浮时才浮现的玻璃控件，
// 常态只留「图 + 标题」，视觉噪音降到最低；悬停时卡片轻抬、图片缓推。

'use client';

import { useEffect, useRef, useState } from 'react';
import { Images, Loader2, Pencil, RotateCcw, Star, Trash2, ZoomIn } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { formatExifLine } from '@/lib/image/exif';
import type { ScreenRect } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { Photo, PhotoStatus } from '@/types/domain';

export type PhotoCardVariant = 'card' | 'wall';

interface PhotoCardProps {
  photo: Photo;
  index: number;
  previewUrl?: string;
  variant?: PhotoCardVariant;
  /** 是否是当前项目封面 */
  isCover?: boolean;
  onToggleSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onSetCover?: (id: string) => void;
  /** 点图片打开大图；把图片在屏幕上的位置带给预览层做 FLIP 放大 */
  onPreview?: (rect: ScreenRect) => void;
}

const STATUS_LABELS: Record<PhotoStatus, string> = {
  idle: '待处理',
  processing: '处理中',
  success: '成功',
  failed: '失败',
};

const STATUS_DOT: Record<PhotoStatus, string> = {
  idle: 'bg-ink-faint',
  processing: 'bg-blue-500',
  success: 'bg-emerald-500',
  failed: 'bg-red-500',
};

export function PhotoCard({
  photo,
  index,
  previewUrl,
  variant = 'card',
  isCover = false,
  onToggleSelect,
  onEdit,
  onRetry,
  onDelete,
  onSetCover,
  onPreview,
}: PhotoCardProps) {
  const title = getCardTitle(photo);
  const isWall = variant === 'wall';
  const exifLine = formatExifLine(photo.exif);
  const score = photo.analysis?.score?.overall;
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // 缓存命中的图片可能在 onLoad 绑定前就已解码完成，挂载后补一次检查
  useEffect(() => {
    const el = imgRef.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [previewUrl]);

  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-[10px] border bg-surface transition-[transform,box-shadow,border-color] duration-[var(--dur-3)] ease-[var(--ease-out)]',
        'hover:-translate-y-[3px] hover:border-ink/15 hover:shadow-[var(--elev-hover)]',
        photo.selected ? 'border-ink/25' : 'border-line/55',
        isWall && 'break-inside-avoid',
      )}
    >
      <div className={cn('relative overflow-hidden bg-surface-2', !isWall && 'aspect-4/3')}>
        {!loaded && previewUrl && (
          <span className="ps-skeleton absolute inset-0 block" aria-hidden />
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const el = imgRef.current ?? e.currentTarget;
            const rect = el.getBoundingClientRect();
            onPreview?.({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
          }}
          className="block h-full w-full cursor-zoom-in"
          aria-label={`查看 ${title} 大图`}
        >
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              ref={imgRef}
              src={previewUrl}
              alt={photo.analysis?.alt ?? photo.fileName}
              className={cn(
                'w-full transition-[transform,opacity] duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.045]',
                loaded ? 'opacity-100' : 'opacity-0',
                isWall ? 'h-auto' : 'h-full object-cover',
              )}
              draggable={false}
              loading="lazy"
              decoding="async"
              onLoad={() => setLoaded(true)}
            />
          ) : (
            <div
              className={cn(
                'flex w-full items-center justify-center',
                isWall ? 'h-48' : 'h-full',
              )}
            >
              <Images className="h-7 w-7 text-ink-faint" strokeWidth={1.4} />
            </div>
          )}

          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-[280ms] group-hover:bg-black/12 group-hover:opacity-100">
            <span className="translate-y-1 rounded-full bg-paper/90 px-2.5 py-1.5 text-ink shadow-[0_4px_14px_-6px_rgba(0,0,0,0.5)] transition-transform duration-[280ms] ease-[var(--ease-spring)] group-hover:translate-y-0">
              <ZoomIn className="h-3.5 w-3.5" />
            </span>
          </span>
        </button>

        {/* 序号：常态低调，悬浮时略微提亮 */}
        <span className="pointer-events-none absolute top-2 left-2 rounded-[4px] bg-black/40 px-1.5 py-0.5 font-mono text-[9.5px] leading-none text-white/85 backdrop-blur-[2px]">
          {String(index).padStart(2, '0')}
        </span>

        {/* 悬浮才出现的右上角操作组：封面 / 选择 */}
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-[240ms] group-hover:opacity-100 focus-within:opacity-100">
          {onSetCover && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSetCover(photo.id);
              }}
              title={isCover ? '已是封面' : '设为封面'}
              aria-label={isCover ? '已是封面' : '设为封面'}
              className={cn(
                'ps-pressable flex h-6 w-6 items-center justify-center rounded-[6px] backdrop-blur-sm transition-colors',
                isCover
                  ? 'bg-amber-400 text-white'
                  : 'bg-black/40 text-white/85 hover:bg-black/60 hover:text-white',
              )}
            >
              <Star className={cn('h-3 w-3', isCover && 'fill-current')} />
            </button>
          )}
          <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-black/40 backdrop-blur-sm">
            <Checkbox
              checked={photo.selected}
              onCheckedChange={() => onToggleSelect(photo.id)}
              aria-label={`选择第 ${index} 张照片参与导出`}
              className="border-white/70 data-[state=checked]:border-white data-[state=checked]:bg-white data-[state=checked]:text-ink"
            />
          </span>
        </div>

        {/* 已选：常驻细边框 + 角标，避免只靠悬浮才看得出 */}
        {photo.selected && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[10px] ring-1 ring-inset ring-ink/25"
          />
        )}

        {/* 底部信息：状态点 + 分数 / EXIF，悬浮时从下方浮出 */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex translate-y-full items-center gap-1.5 bg-gradient-to-t from-black/78 via-black/45 to-transparent px-2 pt-6 pb-1.5 text-[10px] leading-none text-white/90 transition-transform duration-[280ms] ease-[var(--ease-out)] group-hover:translate-y-0">
          <i className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[photo.status])} />
          <span className="shrink-0">{STATUS_LABELS[photo.status]}</span>
          {typeof score === 'number' && (
            <>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">{score.toFixed(1)}</span>
            </>
          )}
          {exifLine && (
            <>
              <span className="opacity-40">·</span>
              <span className="truncate">{exifLine}</span>
            </>
          )}
        </span>

        {photo.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 backdrop-blur-[1px]">
            <Loader2 className="h-5 w-5 animate-spin text-white" strokeWidth={2} />
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 px-2.5 pt-2 pb-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink" title={title}>
            {title}
          </p>
          <p className="mt-0.5 truncate text-[10.5px] text-ink-faint" title={photo.fileName}>
            {photo.fileName}
          </p>
        </div>

        {/* 操作：常态只有一个「编辑」入口，其余在悬浮时淡入 */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onEdit(photo.id)}
            title="编辑文案"
            aria-label={`编辑 ${title}`}
            className="ps-pressable flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-faint transition-colors hover:bg-ink/6 hover:text-ink"
          >
            <Pencil className="h-3 w-3" />
          </button>

          {photo.status === 'failed' && (
            <button
              type="button"
              onClick={() => onRetry(photo.id)}
              title="重试识别"
              aria-label={`重试 ${title}`}
              className="ps-pressable flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-faint transition-colors hover:bg-ink/6 hover:text-ink"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button
                type="button"
                title="删除这张照片"
                aria-label={`删除 ${title}`}
                className="ps-pressable flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-faint transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除这张照片？</AlertDialogTitle>
                <AlertDialogDescription>
                  「{photo.fileName}」会移到回收站，随时能恢复；要彻底清掉可以稍后在「回收站」里删除。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => onDelete(photo.id)}
                >
                  移到回收站
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}

function getCardTitle(photo: Photo): string {
  if (photo.status === 'success' && photo.analysis?.title) return photo.analysis.title;
  if (photo.status === 'processing') return '识别中…';
  if (photo.status === 'failed') return photo.fileName;
  return '待处理';
}
