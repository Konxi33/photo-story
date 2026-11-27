// src/app/flip/page.tsx
// 0.5.5：翻页预览 —— 把编排好的成书按「纸页」摆出来，印之前先翻一遍。
// 为什么要这一页：导出是一锤子买卖，打开 Word 才知道排版好不好太晚了；
// 这里用和 Word/PDF 相同的结构（封面 → 总览 → 章扉 → 图版 → 技术附录）和相同的图注规则，
// 让用户在软件里就看见「印出来是什么样」，也能判断图够不够大、章分得对不对。
'use client';

import { ChevronLeft, ChevronRight, Images, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { BookPage, type PageNode } from '@/components/book-preview/book-page';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { cleanChapters, readBook, autoChapters, type BookChapter } from '@/lib/book/store';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { formatExifLine } from '@/lib/image/exif';
import { cn } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

const dateText = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
};

/** 章节 ≥4 张才单独给一页章扉，小章节用紧凑章头 —— 与 Word 导出的规则保持一致 */
const CHAPTER_OPENER_MIN = 4;

/** 上次翻到第几页，按项目存在本地（换项目各自独立） */
const cursorKey = (projectId: string): string => `ps:flip:${projectId}`;

const readCursor = (projectId: string): number | null => {
  if (!projectId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cursorKey(projectId));
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  } catch {
    return null;
  }
};

const writeCursor = (projectId: string, page: number): void => {
  if (!projectId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cursorKey(projectId), String(page));
  } catch {
    /* 隐私模式下写不进去就算了，不影响翻页 */
  }
};

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
  /** 0.8.1：放映模式 —— 全屏只留纸页，给客户看稿时不用看软件界面 */
  const [presenting, setPresenting] = useState(false);
  /** 放映时可以自动往下翻：摆着给客户看，人不用守在键盘前 */
  const [autoPlay, setAutoPlay] = useState(false);
  const presentRef = useRef<HTMLDivElement>(null);
  /** 上次看到第几页：按项目存在本地，回来能从原处接着翻 */
  const restoreRef = useRef<number | null>(null);
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
      if (list.length === 0) {
        // 0.8.0：空标题 + 有题记 = 呼吸页。导出里它是一整页留白（chapter.ts 的 buildQuietPage），
        // 预览以前一路 `continue` 掉，于是「书里明明有一页，翻页预览里找不到」。
        const note = chapter.note.trim();
        if (!chapter.title.trim() && note) out.push({ kind: 'breath', note });
        continue;
      }
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
    // 换项目时先记下「上次看到第几页」，等页序列排好再落到那页（此刻 pages 还是空的）
    restoreRef.current = readCursor(projectId);
  }, [projectId]);

  // 页序列排好后把位置还原一次；页码过期（删了照片）就收到最后一页
  useEffect(() => {
    const want = restoreRef.current;
    if (want == null || pages.length === 0) return;
    restoreRef.current = null;
    setCursor(Math.min(want, pages.length - 1));
  }, [pages.length]);

  // 当前位置随时写回本地：下次进来从这一页接着看
  useEffect(() => {
    if (pages.length === 0) return;
    writeCursor(projectId, cursor);
  }, [cursor, projectId, pages.length]);

  // 跨页模式下始终从偶数页起（左页是偶数、右页是奇数，和真书一样）
  useEffect(() => {
    if (view !== 'spread') return;
    setCursor((prev) => prev - (prev % 2));
  }, [view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 放映模式下不给 F 之外的快捷键加干扰；Esc 由浏览器先退全屏，这里兜一层状态
      if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        setPresenting((prev) => !prev);
        return;
      }
      if (event.key === 'Escape' && presenting) {
        setPresenting(false);
        return;
      }
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
  }, [go, presenting]);

  // 进放映就真全屏；用户按浏览器自己的 Esc 退出全屏时，把状态一起收回，不留一层空壳
  useEffect(() => {
    if (!presenting) return;
    const node = presentRef.current;
    void node?.requestFullscreen?.().catch(() => {
      /* Electron / 权限不给全屏时，放映层仍然是满屏遮罩，照样能看 */
    });
    const onFsChange = (): void => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    };
  }, [presenting]);

  /** 放映时自动翻页：翻到最后一张就停住，不绕回封面（绕回会让人以为出错了） */
  useEffect(() => {
    if (!presenting || !autoPlay) return;
    const timer = window.setInterval(() => {
      setCursor((prev) => {
        const next = prev + step;
        if (next >= totalPages) {
          setAutoPlay(false);
          return prev;
        }
        return next;
      });
    }, 4200);
    return () => window.clearInterval(timer);
  }, [autoPlay, presenting, step, totalPages]);

  // 退出放映时顺手停掉自动播放
  useEffect(() => {
    if (!presenting) setAutoPlay(false);
  }, [presenting]);

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
      <div className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-8 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1.5">
            <h1 className="ps-page-title">翻页预览</h1>
            <p className="ps-page-desc">
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
                  aria-label={presenting ? '退出放映' : '放映'}
                  title="放映（快捷键 F）"
                  onClick={() => setPresenting((prev) => !prev)}
                  size="sm"
                  variant="ghost"
                >
                  {presenting ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </Button>
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
              用 ← → 翻页，F 全屏放映给客户看。这里只是预览，正式文件请用「导出成书」生成 Word / PDF。
            </p>
          </>
        )}

        {/* 0.8.1：放映层铺满整个窗口（并尽量真全屏），只留纸页、页码和一行快捷键 */}
        {presenting ? (
          <div ref={presentRef} className="ps-present" role="dialog" aria-label="放映成书">
            <div className="ps-present-bar">
              <span className="truncate">{project?.name ?? '照片故事'}</span>
              <span className="tabular-nums">
                {cursor + 1}
                {step > 1 ? `–${Math.min(cursor + step, totalPages)}` : ''} / {totalPages}
              </span>
              <span className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setAutoPlay((prev) => !prev)}
                  className="ps-present-exit"
                  aria-pressed={autoPlay}
                >
                  {autoPlay ? '暂停自动翻页' : '自动翻页'}
                </button>
                <button type="button" onClick={() => setPresenting(false)} className="ps-present-exit">
                  退出（Esc）
                </button>
              </span>
            </div>
            <div className="ps-present-stage" onClick={() => go(1)}>
              {visible.map((item) => (
                <BookPage key={item.number} node={item.node} number={item.number} present />
              ))}
            </div>
            <div className="ps-present-foot">← → 翻页 · F 退出放映 · 点纸页也能往后翻</div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
