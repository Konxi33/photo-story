// src/app/gallery/page.tsx
// 照片库：分类筛选 + 模糊搜索 + 时间排序（添加/拍摄，正倒序）+ 悬停级联放大。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarDays,
  ImageOff,
  Images,
  Search,
  X,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { PhotoStoryPreview } from '@/components/workbench/PhotoStoryPreview';
import { Input } from '@/components/ui/input';
import { FadeImg } from '@/components/ui/fade-img';
import { Segmented } from '@/components/ui/segmented';
import { CATEGORY_GROUPS, matchCategories } from '@/config/categories';
import { ROUTES, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { AssetRepository, KvRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { ScreenRect } from '@/lib/motion';
import type { AppSettings, Photo, ProjectSummary } from '@/types/domain';

interface Item {
  photo: Photo;
  projectName: string;
  projectId: string;
  haystack: string;
  categories: string[];
  when: number;
}

type SortKey = 'added' | 'taken';

/** 悬停级联里单个方块的最终外观（数值化，落成 transform / opacity） */
interface TileLook {
  scale: number;
  /** 压暗遮罩的不透明度 0–0.52 */
  dim: number;
  /** 是否是当前悬停的那一张（白环 + 投影） */
  lift: boolean;
}

const SORT_LABELS: Record<SortKey, string> = {
  added: '添加时间',
  taken: '拍摄时间',
};

/** 模糊匹配：字序子序列 + 连续命中加权；返回 -1 表示不匹配 */
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const direct = haystack.indexOf(needle);
  if (direct !== -1) return 100 + needle.length * 2;

  let cursor = 0;
  let score = 0;
  let streak = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, cursor);
    if (found === -1) return -1;
    streak = found === cursor ? streak + 1 : 0;
    score += 1 + streak;
    cursor = found + 1;
  }
  return score;
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatClock(ts: number): string {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 单张照片的方块：分组与紧凑排列两种模式共用，保证悬停行为完全一致 */
function GalleryTile({
  item,
  url,
  look,
  delay,
  onOpen,
  onHover,
  onCapture,
}: {
  item: Item;
  url: string | undefined;
  look: TileLook;
  delay: number;
  onOpen: () => void;
  onHover: (id: string | null) => void;
  /** 打开大图前把方块位置交给预览层做 FLIP 放大 */
  onCapture: (rect: DOMRect) => void;
}): React.JSX.Element {
  const id = item.photo.id;
  const title = item.photo.analysis?.title || item.photo.fileName;
  const params = item.photo.analysis?.params;
  const ref = useRef<HTMLButtonElement | null>(null);

  return (
    <button
      ref={ref}
      type="button"
      onMouseEnter={() => onHover(id)}
      onFocus={() => onHover(id)}
      onMouseLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onCapture(rect);
        onOpen();
      }}
      style={{
        transform: `scale(${look.scale})`,
        zIndex: look.lift ? 20 : 1,
        transitionDelay: `${delay}ms`,
        boxShadow: look.lift
          ? '0 30px 64px -22px rgba(0,0,0,0.62)'
          : '0 8px 20px -20px rgba(0,0,0,0.5)',
      }}
      className="ps-tile group relative aspect-square overflow-hidden rounded-xl border border-line/50 bg-surface-2 text-left"
      title={`${title}\n${formatWhen(item.when)}`}
    >
      {url ? (
        <FadeImg
          src={url}
          alt={item.photo.analysis?.alt ?? item.photo.fileName}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-5 w-5 text-ink-faint" />
        </span>
      )}

      {/* 压暗用一层纯黑遮罩的 opacity 做（合成器属性），不再对图片本身下 filter */}
      <span
        aria-hidden
        style={{ opacity: look.dim, transitionDelay: `${delay}ms` }}
        className="pointer-events-none absolute inset-0 bg-[#0a0a0c] transition-opacity duration-[380ms] ease-[var(--ease-out)]"
      />

      {/* 中心高亮的白环也用 opacity 淡入，避免 box-shadow 从 none 跳变 */}
      <span
        aria-hidden
        style={{
          opacity: look.lift ? 1 : 0,
          transitionDelay: `${delay}ms`,
        }}
        className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-white/70 transition-opacity duration-[300ms] ease-[var(--ease-out)]"
      />

      <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/72 to-transparent px-2.5 pt-7 pb-1.5 opacity-0 transition-all duration-[280ms] ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100">
        <span className="block truncate text-[11.5px] font-medium text-white">{title}</span>
        <span className="block text-[9px] text-white/60 tabular-nums">
          {formatClock(item.when)}
        </span>
      </span>

      {(params?.focalLength || params?.colorGrade) && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] text-white/85 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
          {params?.focalLength}
          {params?.colorGrade ? ' · ' + params.colorGrade : ''}
        </span>
      )}
    </button>
  );
}

/** 今天 / 昨天 / 2026年11月6日 周四（像 MIUI 相册那样一眼看清） */
function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const startOf = (x: Date): number =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / 86400000);

  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';

  const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return date + ' ' + WEEKDAYS[d.getDay()];
}

export default function GalleryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [desc, setDesc] = useState(true);
  const [columns, setColumns] = useState(4);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 0.5.2：点开照片时记下缩略图在屏幕上的位置，预览层从这一块放大出来（FLIP）
  const [previewOrigin, setPreviewOrigin] = useState<ScreenRect | null>(null);
  const urlsRef = useRef<Record<string, string>>({});
  // 0.3.6：悬停动效按真实行列位置计算（见下方 positions），分组不会算错
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showDates, setShowDates] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const saved = await withTimeout(
          KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS),
          3000,
          null,
        );
        if (!cancelled && saved) {
          setColumns(saved.galleryColumns ?? 4);
          setSortKey(saved.gallerySort ?? 'added');
          setDesc((saved.gallerySortDir ?? 'desc') === 'desc');
          setShowDates(saved.galleryShowDates ?? true);
        }

        const projects: ProjectSummary[] = await withTimeout(
          ProjectRepository.list(),
          5000,
          [],
        );
        const all: Item[] = [];
        for (const p of projects) {
          const photos = await withTimeout(PhotoRepository.listByProject(p.id), 4000, []);
          for (const photo of photos) {
            const a = photo.analysis;
            const haystack = [
              a?.title ?? '',
              photo.fileName,
              p.name,
              ...(a?.tags ?? []),
              a?.mood ?? '',
              a?.params?.colorGrade ?? '',
              a?.params?.focalLength ?? '',
              a?.technique.lens ?? '',
            ]
              .join(' ')
              .toLowerCase();
            all.push({
              photo,
              projectId: p.id,
              projectName: p.name,
              haystack,
              categories: matchCategories(haystack),
              when: photo.takenAt ?? photo.createdAt,
            });
          }
        }
        if (cancelled) return;
        setItems(all);

        const urls: Record<string, string> = {};
        for (const item of all) {
          try {
            const asset = await AssetRepository.get(item.photo.id, 'preview');
            if (asset) urls[item.photo.id] = URL.createObjectURL(asset.blob);
          } catch {
            // 单张失败忽略
          }
        }
        if (!cancelled) {
          urlsRef.current = urls;
          setPreviews(urls);
        }
      } catch {
        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  const persistence = useCallback((next: Partial<AppSettings>) => {
    void (async () => {
      try {
        const saved = (await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS)) ?? {
          concurrency: 2,
          timeoutMs: 60000,
          maxRetries: 1,
          aiImageMaxEdge: 1024,
          previewMaxEdge: 640,
          storageNoticeDismissed: false,
        };
        await KvRepository.set(STORAGE_KEY_APP_SETTINGS, { ...saved, ...next });
      } catch {
        // 存不上不影响使用
      }
    })();
  }, []);

  const toggleSort = (): void => {
    const next = !desc;
    setDesc(next);
    persistence({ gallerySortDir: next ? 'desc' : 'asc' });
  };

  const visible = useMemo(() => {
    const terms = keyword.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (items ?? []).filter((item) => {
      if (category !== 'all' && !item.categories.includes(category)) return false;
      if (terms.length === 0) return true;
      return terms.every((term) => fuzzyScore(item.haystack, term) > 0);
    });

    const sorted = [...list].sort((a, b) =>
      sortKey === 'taken' ? a.when - b.when : a.photo.createdAt - b.photo.createdAt,
    );
    return desc ? sorted.reverse() : sorted;
  }, [items, category, keyword, sortKey, desc]);

  const photos = visible.map((it) => it.photo);

  // 0.3.6：按天分组；同时算出每张照片在网格里的真实行列。
  // 之前用「全局 index ÷ 列数」算行列，遇到日期分组头就会错位，
  // 导致向下第 N 张突然变成距离 0（跟着放大变亮）——这就是那个 bug 的根因。
  // 0.5.1：每组列数自适应——只有 1~2 张的那天用 3 列，照片不至于缩成 1/6 宽、
  // 右边留一大片空白；照片多的那天仍按用户选的列数铺满。
  const { groups, positions } = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        cols: number;
        items: { item: Item; index: number; row: number; col: number }[];
      }
    >();
    const pos = new Map<string, { row: number; col: number }>();

    let rowOffset = 0;
    visible.forEach((item, index) => {
      const key = dayKey(item.when);
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { key, label: dayLabel(item.when), cols: columns, items: [] };
        map.set(key, bucket);
      }
      bucket.items.push({ item, index, row: 0, col: 0 });
    });

    // 收齐照片后才定得下每组的列数，再据此回填真实行列
    const out = [...map.values()].map((group) => {
      const cols = Math.min(columns, Math.max(3, group.items.length));
      group.cols = cols;
      group.items.forEach((entry, i) => {
        entry.row = rowOffset + Math.floor(i / cols);
        entry.col = i % cols;
        pos.set(entry.item.photo.id, { row: entry.row, col: entry.col });
      });
      rowOffset += Math.ceil(group.items.length / cols);
      return group;
    });

    return { groups: out, positions: pos };
  }, [visible, columns]);

  /**
   * 时间线版式里每张照片的固定宽度（按用户选的列数换算）。
   * 用固定宽度 + auto-fill：某天只有 1 张时它就是正常尺寸靠左，
   * 不会像「1/6 宽 + 一大片空白」那样显得稀碎（0.5.1）。
   * 某天只有 1~2 张时放大一档，避免一行只有一个小方块、右边全是空。
   */
  const TILE_WIDTHS: Record<number, number> = { 3: 232, 4: 190, 5: 160, 6: 138 };
  const baseTileWidth = TILE_WIDTHS[columns] ?? 190;
  const tileWidthFor = (count: number): number => {
    if (count <= 1) return Math.min(380, Math.round(baseTileWidth * 2.2));
    if (count === 2) return Math.min(300, Math.round(baseTileWidth * 1.6));
    return baseTileWidth;
  };

  /**
   * 以悬停照片为圆心向外扩散：距离越远越小、越暗。
   * 0.5.2：只输出数值（scale / dim / lift），由 GalleryTile 用 transform + 遮罩
   * opacity 落地——这两样都是合成器属性，滑过一排照片时不会整层重绘。
   */
  const tileLook = (id: string): TileLook => {
    if (!focusId) return { scale: 1, dim: 0, lift: false };
    if (focusId === id) return { scale: 1.16, dim: 0, lift: true };

    const center = positions.get(focusId);
    const self = positions.get(id);
    if (!center || !self) return { scale: 1, dim: 0, lift: false };

    const d = Math.hypot(self.row - center.row, self.col - center.col);
    const scale = d <= 1 ? 0.99 : Math.max(0.84, 0.99 - (d - 1) * 0.05);
    const dim = d <= 1 ? 0.05 : Math.min(0.52, 0.15 + (d - 1) * 0.09);
    return { scale: Number(scale.toFixed(3)), dim: Number(dim.toFixed(3)), lift: false };
  };

  /** 级联按距离给一点延迟，鼠标划过时像一圈涟漪推开 */
  const tileDelay = (id: string): number => {
    if (!focusId) return 0;
    const center = positions.get(focusId);
    const self = positions.get(id);
    if (!center || !self) return 0;
    return Math.min(70, Math.round(Math.hypot(self.row - center.row, self.col - center.col) * 16));
  };

  return (
    <AppShell
      actions={
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="模糊搜索：标题 / 标签 / 调色 / 文件名"
            className="h-8 w-64 pr-8 pl-8 text-xs"
          />
          {keyword && (
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      }
    >
      <div className="px-5 py-8 md:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ps-eyebrow">Gallery</p>
            <h1 className="ps-display mt-2 text-[26px] text-ink">照片库</h1>
            <p className="mt-2 max-w-[38rem] text-[13px] leading-relaxed text-ink-mid">
              所有项目的照片都在这里，按场景分类、按时间排序，点开看照片与文字。
            </p>
          </div>
          <span className="text-[11px] text-ink-faint tabular-nums">
            {items === null ? '读取中…' : `${visible.length} / ${items.length} 张`}
          </span>
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="gallery" className="mb-5" />

        {/* 分类：横向可滚动 + 两端渐隐，避免右侧被裁 */}
        <div className="ps-edge-fade -mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 ps-no-scrollbar">
          <CategoryChip
            active={category === 'all'}
            onClick={() => setCategory('all')}
            label="全部"
            mark="◍"
          />
          {CATEGORY_GROUPS.map((group) => {
            const count = (items ?? []).filter((i) => i.categories.includes(group.id)).length;
            return (
              <CategoryChip
                key={group.id}
                active={category === group.id}
                onClick={() => setCategory(group.id)}
                label={group.label}
                mark={group.mark}
                count={count}
              />
            );
          })}
        </div>

        {/* 排序与列数：全部换成同一套分段控件，视觉噪音降到最低 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel="排序方式"
            value={sortKey}
            onChange={(key) => {
              setSortKey(key);
              persistence({ gallerySort: key });
            }}
            options={[
              { value: 'added' as SortKey, label: SORT_LABELS.added },
              { value: 'taken' as SortKey, label: SORT_LABELS.taken },
            ]}
          />

          <button
            type="button"
            onClick={toggleSort}
            title={desc ? '当前：从新到旧' : '当前：从旧到新'}
            aria-label={desc ? '当前从新到旧，点击切换' : '当前从旧到新，点击切换'}
            className="ps-pressable flex h-8 w-8 items-center justify-center rounded-full border border-line/60 bg-surface-2/80 text-ink-mid transition-colors hover:border-ink/20 hover:bg-surface hover:text-ink"
          >
            {desc ? (
              <ArrowDownWideNarrow className="h-3.5 w-3.5" />
            ) : (
              <ArrowUpNarrowWide className="h-3.5 w-3.5" />
            )}
          </button>

          <span className="mx-0.5 h-4 w-px bg-line/70" />

          {/* 0.3.6：时间分组可关掉，关掉后照片紧凑排列 */}
          <button
            type="button"
            onClick={() => {
              const next = !showDates;
              setShowDates(next);
              persistence({ galleryShowDates: next });
            }}
            title={showDates ? '关闭后照片紧凑排列、不显示日期' : '按日期分组显示'}
            className={cn(
              'ps-pressable flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12px] transition-colors',
              showDates
                ? 'border-ink/15 bg-ink text-paper'
                : 'border-line/60 bg-surface-2/80 text-ink-mid hover:border-ink/20 hover:text-ink',
            )}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            {showDates ? '时间分组' : '紧凑排列'}
          </button>

          <div className="ml-auto">
            <Segmented
              size="sm"
              ariaLabel="每行列数"
              value={String(columns)}
              onChange={(value) => {
                const n = Number(value) as 3 | 4 | 5 | 6;
                setColumns(n);
                persistence({ galleryColumns: n });
              }}
              options={[
                { value: '3', label: '3' },
                { value: '4', label: '4' },
                { value: '5', label: '5' },
                { value: '6', label: '6' },
              ]}
            />
          </div>
        </div>

        {items === null ? (
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: columns * 2 }).map((_, i) => (
              <div key={i} className="ps-skeleton aspect-square rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="ps-enter flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line/80 bg-surface-2/40 px-6 py-20 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
              <Images className="h-5 w-5" strokeWidth={1.4} />
            </span>
            <p className="text-[15px] font-medium text-ink">
              {items.length === 0 ? '这里还没有照片' : '没有符合条件的照片'}
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-faint">
              {items.length === 0
                ? '去项目里上传照片后，它们会出现在这里。'
                : '换个分类或缩短搜索词试试（支持只打几个字）。'}
            </p>
            {items.length === 0 && (
              <Link
                href={ROUTES.projects}
                className="ps-pressable mt-5 rounded-full bg-ink px-4 py-1.5 text-[12px] text-paper"
              >
                去项目列表
              </Link>
            )}
          </div>
        ) : !showDates ? (
          /* 紧凑排列：不分日期，整片一个网格，列数严格等于用户选择 */
          <div
            className="grid gap-2.5"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            onMouseLeave={() => setFocusId(null)}
          >
            {visible.map((item, index) => (
              <GalleryTile
                key={item.photo.id}
                item={item}
                url={previews[item.photo.id]}
                look={tileLook(item.photo.id)}
                delay={tileDelay(item.photo.id)}
                onOpen={() => setPreviewIndex(index)}
                onHover={setFocusId}
                onCapture={(rect) =>
                  setPreviewOrigin({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })
                }
              />
            ))}
          </div>
        ) : (
          /* 0.5.1：时间线版式 —— 左边一栏放日期，右边照片按固定尺寸左对齐排开。
             某天只有 1 张时不会把照片拉成半屏，右侧留白也读作时间线的留白。 */
          <div className="mt-1" onMouseLeave={() => setFocusId(null)}>
            {groups.map((group) => (
              <section
                key={group.key}
                className="grid grid-cols-[104px_minmax(0,1fr)] gap-x-6 gap-y-2 border-t border-line/40 py-5 first:border-t-0 first:pt-0"
              >
                <div className="sticky top-4 self-start pt-0.5">
                  <p className="text-[13px] font-semibold tracking-[-0.01em] text-ink">
                    {group.label}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-ink-faint tabular-nums">
                    {group.items.length} 张
                  </p>
                </div>

                <div
                  className="grid gap-2.5"
                  style={{ gridTemplateColumns: `repeat(auto-fill, ${tileWidthFor(group.items.length)}px)` }}
                >
                  {group.items.map(({ item, index }) => (
                    <GalleryTile
                      key={item.photo.id}
                      item={item}
                      url={previews[item.photo.id]}
                      look={tileLook(item.photo.id)}
                      delay={tileDelay(item.photo.id)}
                      onOpen={() => setPreviewIndex(index)}
                      onHover={setFocusId}
                      onCapture={(rect) =>
                        setPreviewOrigin({ x: rect.x, y: rect.y, w: rect.width, h: rect.height })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {previewIndex !== null && (
        <PhotoStoryPreview
          photos={photos}
          index={Math.min(previewIndex, photos.length - 1)}
          previews={previews}
          origin={previewOrigin}
          onClose={() => setPreviewIndex(null)}
          onNavigate={setPreviewIndex}
        />
      )}
    </AppShell>
  );
}

function CategoryChip({
  label,
  mark,
  count,
  active,
  onClick,
}: {
  label: string;
  mark: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'ps-pressable flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition-all duration-[240ms] ease-[var(--ease-out)]',
        active
          ? 'border-ink/15 bg-ink text-paper shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
          : 'border-line/60 bg-surface-2/60 text-ink-mid hover:border-ink/20 hover:bg-surface hover:text-ink',
      )}
    >
      <span className="text-[11px] opacity-80">{mark}</span>
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className={cn('tabular-nums text-[10px]', active ? 'text-paper/55' : 'text-ink-faint')}>
          {count}
        </span>
      )}
    </button>
  );
}
