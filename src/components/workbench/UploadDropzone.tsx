// src/components/workbench/UploadDropzone.tsx
// 0.5.1：有照片时收成一条极窄的「添加照片」横条（不再常年占掉 90px 首屏）；
// 拖拽经过时整条展开成虚线投放区，给出明确的落点反馈。

'use client';

import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { MAX_UPLOAD_MB, PHOTO_ERROR_LABELS } from '@/config/app';
import { uploadOnePhoto } from '@/lib/upload';
import { cn } from '@/lib/utils';
import type { Photo, PhotoErrorCode } from '@/types/domain';

interface UploadDropzoneProps {
  projectId: string;
  onUploaded: (photo: Photo) => void;
  /** 已经有照片时收成一条窄栏，把首屏还给照片 */
  compact?: boolean;
}

export function UploadDropzone({ projectId, onUploaded, compact = false }: UploadDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const busy = progress !== null;
  const expanded = dragging || !compact;

  const handleFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0 || busy) return;

    const list = Array.from(files);
    let succeeded = 0;
    setProgress({ done: 0, total: list.length });

    for (const [index, file] of list.entries()) {
      try {
        const photo = await uploadOnePhoto(file, projectId);
        onUploaded(photo);
        succeeded += 1;
      } catch (error) {
        const code = (error as { code?: PhotoErrorCode }).code ?? 'UPLOAD_FAILED';
        toast.error(`${file.name} 上传失败`, { description: PHOTO_ERROR_LABELS[code] });
      }
      setProgress({ done: index + 1, total: list.length });
    }

    setProgress(null);
    if (succeeded > 0) toast.success(`已添加 ${succeeded} 张照片`);
  };

  const percent = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-disabled={busy}
      aria-label="添加照片"
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'group relative flex items-center overflow-hidden border border-dashed transition-[padding,background-color,border-color,transform] duration-[320ms] ease-[var(--ease-out)]',
        expanded ? 'rounded-xl gap-3.5 px-4 py-3 border-dashed' : 'rounded-lg gap-2 px-2.5 py-[5px]',
        // 0.7.7：已有照片时（compact）不再画一整圈虚线——一条扁横杠横在照片上方太吵。
        // 保留整条的可拖放区域，只是平时把边框藏起来，拖东西进来时才亮成虚线。
        !expanded && !dragging && 'border-transparent',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        busy && 'cursor-progress',
        dragging
          ? 'scale-[1.005] border-ink/40 bg-ink/[0.045]'
          : 'hover:border-ink/20 hover:bg-surface',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full transition-all duration-[320ms] ease-[var(--ease-spring)]',
          expanded ? 'h-9 w-9' : 'h-5 w-5',
          dragging ? 'bg-ink text-paper' : 'bg-ink/6 text-ink-mid group-hover:bg-ink/10',
        )}
      >
        {busy ? (
          <Loader2 className={expanded ? 'h-4 w-4 animate-spin' : 'h-3 w-3 animate-spin'} />
        ) : (
          <ImagePlus
            className={expanded ? 'h-4 w-4' : 'h-3 w-3'}
            strokeWidth={1.7}
          />
        )}
      </span>

      <div className="min-w-0 flex-1">
        {progress ? (
          <div className="flex items-center gap-2">
            <p className="shrink-0 text-[12px] text-ink-mid tabular-nums">
              处理中 {progress.done}/{progress.total}
            </p>
            <div className="h-[3px] min-w-0 flex-1 overflow-hidden rounded-full bg-ink/10">
              <div
                className="h-full rounded-full bg-ink/60 transition-[width] duration-300 ease-[var(--ease-out)]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        ) : expanded ? (
          <>
            <p className="text-[12.5px] font-medium text-ink">
              {dragging ? '松手就放进来' : '拖入照片，或点击选择'}
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-ink-faint">
              JPG / PNG / WebP · 单张 ≤ {MAX_UPLOAD_MB}MB · 可多选
            </p>
          </>
        ) : (
          <p className="truncate text-[11.5px] text-ink-faint transition-colors group-hover:text-ink-mid">
            添加照片 · 也可直接拖进来
          </p>
        )}
      </div>

      {expanded && !progress && (
        <span className="shrink-0 rounded-full border border-line/70 bg-surface px-2.5 py-1 text-[11px] text-ink-mid transition-colors group-hover:border-ink/20 group-hover:text-ink">
          选择照片
        </span>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
