// 0.8.0：从 /flip 里抽出来的「一张纸」渲染器。
// 单独成文件是为了能直接单测——呼吸页（kind: 'breath'）以前在预览里被整段跳过，
// 光靠点界面很难看出「书里有一页、预览里没有」。
import { CalendarDays } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { Photo } from '@/types/domain';

export type PageNode =
  | { kind: 'cover'; title: string; subtitle: string; date: string; url?: string }
  | { kind: 'overview'; items: { url?: string; index: number; title: string }[] }
  | { kind: 'chapter'; index: number; title: string; note: string }
  /** 0.8.0：呼吸页——空标题 + 有题记的章节，导出里是一整页留白，预览也要有 */
  | { kind: 'breath'; note: string }
  | {
      kind: 'photo';
      index: number;
      photo: Photo;
      url?: string;
      /** 小章节把章名压在图版页顶端，和 Word 里的紧凑章头一致 */
      chapterLabel?: string;
    }
  | { kind: 'appendix'; rows: { index: number; title: string; param: string }[] };

const pad2 = (n: number): string => String(n).padStart(2, '0');

export function BookPage({
  node,
  number,
  zoom = 1,
}: {
  node?: PageNode;
  number: number;
  /** 纸页放大倍数：用 CSS zoom，保持排版比例不变 */
  zoom?: number;
}): React.JSX.Element {
  if (!node) {
    return (
      <div
        aria-hidden
        className="hidden aspect-[210/297] w-full rounded-xl border border-dashed border-line/40 lg:block"
      />
    );
  }

  return (
    <div className="flex min-w-0 justify-center" style={{ zoom }}>
      <article
        key={number}
        className={cn(
          'ps-enter relative flex aspect-[210/297] h-auto w-full max-w-full flex-col overflow-hidden rounded-xl border border-line/60',
          // 让整张纸页落在视口里：高度跟着窗口走，宽度由纸的比例反推
          'lg:h-[calc(100vh-15rem)] lg:max-h-[780px] lg:w-auto',
          'bg-[#fbfaf7] px-[7%] py-[6%] text-[#1b1a17] shadow-[0_18px_44px_-30px_rgba(0,0,0,0.5)]',
        )}
        style={{ '--ps-delay': '0ms' } as React.CSSProperties}
      >
      {node.kind === 'cover' ? (
        <div className="flex h-full flex-col justify-between">
          <div className="grid gap-2">
            <p className="text-[9px] tracking-[0.24em] text-[#8a8578] uppercase">Photo Story</p>
            <h2 className="text-[clamp(18px,3.2vw,30px)] leading-tight font-semibold">{node.title}</h2>
            <p className="text-[10.5px] text-[#6c6759]">{node.subtitle}</p>
          </div>
          {node.url ? (
            <img
              alt={`${node.title} 的封面照片`}
              className="mx-auto max-h-[52%] w-auto rounded-sm object-contain"
              src={node.url}
            />
          ) : null}
          <p className="text-[9.5px] text-[#8a8578]">{node.date}</p>
        </div>
      ) : null}

      {node.kind === 'overview' ? (
        <div className="flex h-full flex-col gap-3">
          <div className="flex items-baseline justify-between border-b border-[#ded9cc] pb-1.5">
            <span className="text-[8.5px] tracking-[0.2em] text-[#8a8578] uppercase">总览</span>
            <span className="text-[9px] text-[#8a8578]">共 {node.items.length} 张</span>
          </div>
          <div className="grid grid-cols-4 gap-x-2 gap-y-2.5">
            {node.items.map((item) => (
              <figure className="grid gap-1" key={item.index}>
                {item.url ? (
                  <img
                    alt={item.title}
                    className="aspect-[3/2] w-full rounded-[2px] object-cover"
                    src={item.url}
                  />
                ) : (
                  <span className="aspect-[3/2] w-full rounded-[2px] bg-[#e8e4da]" />
                )}
                <figcaption className="truncate text-center text-[7.5px] text-[#6c6759]">
                  {pad2(item.index)} · {item.title}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      {node.kind === 'breath' ? (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
          <span className="h-px w-8 bg-[#c9c3b4]" />
          <p className="max-w-[78%] text-[clamp(10px,1.5vw,13px)] leading-[1.9] text-[#3d3a33]">
            {node.note}
          </p>
          <span className="h-px w-8 bg-[#c9c3b4]" />
        </div>
      ) : null}

      {node.kind === 'chapter' ? (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-[9px] tracking-[0.24em] text-[#8a8578]">第 {pad2(node.index)} 章</p>
          <h2 className="max-w-[86%] text-[clamp(16px,2.6vw,24px)] leading-snug font-semibold">
            {node.title}
          </h2>
          <span className="h-px w-10 bg-[#c9c3b4]" />
          {node.note ? <p className="max-w-[80%] text-[10px] text-[#6c6759]">{node.note}</p> : null}
        </div>
      ) : null}

      {node.kind === 'photo' ? (
        <div className="flex h-full flex-col">
          {node.chapterLabel ? (
            <p className="mb-1.5 flex items-center gap-1.5 text-[8.5px] tracking-[0.18em] text-[#8a8578] uppercase">
              <CalendarDays className="size-2.5" />
              {node.chapterLabel}
            </p>
          ) : null}
          <p className="text-[8.5px] tracking-[0.24em] text-[#8a8578]">图 {pad2(node.index)}</p>
          <h2 className="mt-0.5 truncate text-[clamp(12px,1.7vw,16px)] leading-tight font-semibold">
            {node.photo.analysis?.title?.trim() || node.photo.fileName}
          </h2>
          <span className="mt-1.5 mb-2 h-px w-full bg-[#e2ddd0]" />
          <div className="flex min-h-0 flex-1 items-start justify-center">
            {node.url ? (
              <img
                alt={node.photo.analysis?.title || node.photo.fileName}
                className="max-h-full max-w-full object-contain"
                src={node.url}
              />
            ) : (
              <span className="h-32 w-full bg-[#e8e4da]" />
            )}
          </div>
          <p className="mt-2 text-left text-[8.5px] text-[#6c6759]">
            图 {pad2(node.index)} · {node.photo.analysis?.title?.trim() || node.photo.fileName}
          </p>
          {node.photo.analysis?.story ? (
            <p className="mt-1.5 line-clamp-4 text-[8.5px] leading-[1.6] text-[#3d3a33]">
              {node.photo.analysis.story}
            </p>
          ) : null}
        </div>
      ) : null}

      {node.kind === 'appendix' ? (
        <div className="flex h-full flex-col gap-2">
          <p className="text-[8.5px] tracking-[0.2em] text-[#8a8578] uppercase">Appendix · 技术附录</p>
          <span className="h-px w-full bg-[#ded9cc]" />
          <p className="text-[8.5px] text-[#6c6759]">
            按图版顺序列出每张照片的标题与拍摄参数，便于对照与复盘。
          </p>
          <div className="grid gap-1 overflow-hidden">
            {node.rows.map((row) => (
              <div className="flex items-baseline gap-1.5 text-[8px] text-[#3d3a33]" key={row.index}>
                <span className="w-9 shrink-0 tabular-nums text-[#8a8578]">图 {pad2(row.index)}</span>
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                <span className="shrink-0 text-[#6c6759]">{row.param}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <span className="absolute bottom-[3%] left-1/2 -translate-x-1/2 text-[7.5px] text-[#a8a294] tabular-nums">
        {number > 1 ? `第 ${number - 1} 页` : ''}
      </span>
      </article>
    </div>
  );
}

