// src/app/flip/page.tsx
// 0.5.5：翻页预览 —— 把编排好的成书按「纸页」摆出来，印之前先翻一遍。
// 为什么要这一页：导出是一锤子买卖，打开 Word 才知道排版好不好太晚了；
// 这里用和 Word/PDF 相同的结构（封面 → 总览 → 章扉 → 图版 → 技术附录）和相同的图注规则，
// 让用户在软件里就看见「印出来是什么样」，也能判断图够不够大、章分得对不对。
'use client';

import { CalendarDays, ChevronLeft, ChevronRight, Images, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { cleanChapters, readBook, autoChapters, type BookChapter } from '@/lib/book/store';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { formatExifLine } from '@/lib/image/exif';
import { cn } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

type PageNode =
  | { kind: 'cover'; title: string; subtitle: string; date: string; url?: string }
  | { kind: 'overview'; items: { url?: string; index: number; title: string }[] }
  | { kind: 'chapter'; index: number; title: string; note: string }
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

const dateText = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
};

/** 章节 ≥4 张才单独给一页章扉，小章节用紧凑章头 —— 与 Word 导出的规则保持一致 */
const CHAPTER_OPENER_MIN = 4;

export default function FlipPage(): React.JSX.Element {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(0);
  /** spread = 左右对开的跨页；single = 一次一页（看细节用） */
  const [view, setView] = useState<'spread' | 'single'>('spread');
  const [zoom, setZoom] = useState<'fit' | '110' | '130'>('fit');
  const urlsRef = useRef<Record<string, string>>({});

  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projectId, projects],
  );

  // 项目列表
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await ProjectRepository.list();
        if (!alive) return;
        setProjects(list);
        setProjectId((prev) => prev || list[0]?.id || '');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 当前项目的照片 + 编排 + 缩略图
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const list = await PhotoRepository.listByProject(projectId);
        const book = await readBook(projectId);
        const valid = new Set(list.map((item) => item.id));
        const picked = list.filter((item) => item.selected);
        const base = book ? cleanChapters(book.chapters, valid) : [];
        const hasPhotos = base.some((chapter) => chapter.photoIds.length > 0);
        if (!alive) return;
        setPhotos(list);
        setChapters(hasPhotos ? base : autoChapters(picked.length > 0 ? picked : list));

        for (const old of Object.values(urlsRef.current)) URL.revokeObjectURL(old);
        urlsRef.current = {};
        setUrls({});
        const next: Record<string, string> = {};
        for (const photo of list) {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (!asset?.blob) continue;
          const url = URL.createObjectURL(asset.blob);
          next[photo.id] = url;
          urlsRef.current[photo.id] = url;
        }
        if (alive) setUrls(next);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  const byId = useMemo(() => new Map(photos.map((item) => [item.id, item])), [photos]);

  // 成书页序列：与 Word 导出的结构一一对应
  const pages = useMemo<PageNode[]>(() => {
    const ordered = chapters.flatMap((chapter) =>
      chapter.photoIds.map((id) => byId.get(id)).filter((item): item is Photo => Boolean(item)),
    );
    if (ordered.length === 0) return [];

    const out: PageNode[] = [
      {
        kind: 'cover',
        title: project?.name ?? '照片故事',
        subtitle: '照片故事 · 摄影集',
        date: dateText(ordered[0].takenAt ?? ordered[0].createdAt),
        url: urls[ordered[0].id],
      },
      {
        kind: 'overview',
        items: ordered.map((photo, index) => ({
          url: urls[photo.id],
          index: index + 1,
          title: photo.analysis?.title?.trim() || photo.fileName,
        })),
      },
    ];

    let figure = 0;
    for (const chapter of chapters) {
      const list = chapter.photoIds
        .map((id) => byId.get(id))
        .filter((item): item is Photo => Boolean(item));
      if (list.length === 0) continue;
      const label = chapter.title.trim() || '未命名章节';
      const opener = list.length >= CHAPTER_OPENER_MIN;
      if (opener) {
        out.push({ kind: 'chapter', index: out.filter((p) => p.kind === 'chapter').length + 1, title: label, note: chapter.note.trim() });
      }
      for (const photo of list) {
        figure += 1;
        out.push({
          kind: 'photo',
          index: figure,
          photo,
          url: urls[photo.id],
          chapterLabel: opener ? undefined : label,
        });
      }
    }

    out.push({
      kind: 'appendix',
      rows: ordered.map((photo, index) => ({
        index: index + 1,
        title: photo.analysis?.title?.trim() || photo.fileName,
        param: formatExifLine(photo.exif) || photo.analysis?.params?.colorGrade || '—',
      })),
    });
    return out;
  }, [byId, chapters, project, urls]);

  const totalPages = Math.max(1, pages.length);
  const step = view === 'spread' ? 2 : 1;
  const go = useCallback(
    (delta: number) => {
      setCursor((prev) => {
        const next = prev + delta * step;
        return Math.min(totalPages - 1, Math.max(0, next));
      });
    },
    [step, totalPages],
  );

  useEffect(() => {
    setCursor(0);
  }, [projectId]);

  // 跨页模式下始终从偶数页起（左页是偶数、右页是奇数，和真书一样）
  useEffect(() => {
    if (view !== 'spread') return;
    setCursor((prev) => prev - (prev % 2));
  }, [view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 0.5.6：J / K / 空格 / 退格 也能翻，和看漫画的习惯一致
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'k' || event.key === 'K' || event.key === ' ' || event.key === 'PageDown') {
        event.preventDefault();
        go(1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'j' || event.key === 'J' || event.key === 'Backspace' || event.key === 'PageUp') {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const visible =
    view === 'spread'
      ? [
          { node: pages[cursor], number: cursor + 1 },
          { node: pages[cursor + 1], number: cursor + 2 },
        ]
      : [{ node: pages[cursor], number: cursor + 1 }];

  // 印刷装订通常按 4 的倍数成帖；这里只做提示，不偷偷加页
  const pad4 = (4 - (pages.length % 4)) % 4;

  return (
    <AppShell>
      <div className="mx-auto grid w-full max-w-6xl gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="ps-display text-[26px] leading-tight">翻页预览</h1>
            <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-soft">
              结构和导出的成书一致：封面 → 总览 → 章扉 → 图版 → 技术附录。图注按「编号 · 标题」，
              参数收到书末附录。翻一遍就知道图够不够大、章分得对不对。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {projects.length > 1 ? (
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-8 w-52 rounded-full text-[12.5px]">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button asChild variant="ghost" size="sm">
              <Link href={ROUTES.book}>回到编排</Link>
            </Button>
          </div>
        </header>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[12.5px] text-ink-faint">
            <Loader2 className="size-4 animate-spin" />
            正在排版…
          </div>
        ) : pages.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-line/60 bg-surface/40 px-6 py-16 text-center">
            <Images className="size-7 text-ink-faint" />
            <p className="text-[13px] text-ink-soft">这个项目还没有照片可以成书。</p>
            <Button asChild size="sm">
              <Link href={ROUTES.projects}>去导入照片</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-soft">
              <span className="tabular-nums">
                {view === 'spread'
                  ? `第 ${cursor + 1}${cursor + 1 < totalPages ? `–${Math.min(cursor + 2, totalPages)}` : ''} 页 · 共 ${totalPages} 页`
                  : `第 ${cursor + 1} / ${totalPages} 页`}
                {pad4 > 0 ? (
                  <span className="text-ink-faint">（按装订成帖取 4 的倍数，还差 {pad4} 页）</span>
                ) : null}
              </span>
              <div className="flex items-center gap-2">
                <Segmented
                  ariaLabel="预览方式"
                  value={view}
                  onChange={(id) => setView(id === 'single' ? 'single' : 'spread')}
                  options={[
                    { value: 'spread', label: '跨页' },
                    { value: 'single', label: '单页' },
                  ]}
                />
                <Segmented
                  ariaLabel="缩放"
                  value={zoom}
                  onChange={(id) => setZoom(id === '110' ? '110' : id === '130' ? '130' : 'fit')}
                  options={[
                    { value: 'fit', label: '适应' },
                    { value: '110', label: '110%' },
                    { value: '130', label: '130%' },
                  ]}
                />
                <Button
                  aria-label={view === 'spread' ? '上一跨页' : '上一页'}
                  disabled={cursor === 0}
                  onClick={() => go(-1)}
                  size="sm"
                  variant="ghost"
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  aria-label={view === 'spread' ? '下一跨页' : '下一页'}
                  disabled={cursor + step >= totalPages}
                  onClick={() => go(1)}
                  size="sm"
                  variant="ghost"
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>

            <div
              className={cn(
                'grid gap-4 overflow-auto',
                view === 'spread' ? 'lg:grid-cols-2 [&>*]:min-w-0' : 'justify-items-center',
              )}
            >
              {visible.map((item) => (
                <BookPage
                  key={item.number}
                  node={item.node}
                  number={item.number}
                  zoom={zoom === '110' ? 1.1 : zoom === '130' ? 1.3 : 1}
                />
              ))}
            </div>

            <p className="text-center text-[11.5px] text-ink-faint">
              用 ← → 翻页。这里只是预览，正式文件请用「导出成书」生成 Word / PDF。
            </p>
          </>
        )}
      </div>
    </AppShell>
  );
}

function BookPage({
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
