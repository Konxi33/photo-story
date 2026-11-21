// src/app/gallery/page.tsx
// 照片库：一整面可以随手拖动的照片墙。
// 分类筛选 + 模糊搜索 + 时间排序（添加/拍摄，正倒序）保留在墙上方的工具条里，
// 网格/分页换成一张可无限平移、带惯性的画布（见 src/components/photo-wall/）。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Hand, ImageOff, Images, LayoutGrid, Maximize2, Mouse, Search, Waves, X } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { PhotoWall } from '@/components/photo-wall/photo-wall';
import { loadPreview, peekPreview } from '@/components/photo-wall/preview-cache';
import { PhotoStoryPreview } from '@/components/workbench/PhotoStoryPreview';
import { FadeImg } from '@/components/ui/fade-img';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { CATEGORY_GROUPS, matchCategories } from '@/config/categories';
import { ROUTES, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { KvRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, formatDateTime, withTimeout } from '@/lib/utils';
import type { ScreenRect } from '@/lib/motion';
import type { AppSettings, Photo } from '@/types/domain';

interface Item {
  photo: Photo;
  projectName: string;
  projectId: string;
  haystack: string;
  categories: string[];
  when: number;
}

type SortKey = 'added' | 'taken';

/**
 * 0.7.1：照片墙是这一版的新玩法，但网格是大家用惯的方式 —— 两种都留着。
 * 视图选择存在 localStorage（跟外观一样，切页面不丢，也不必等数据库）。
 */
type GalleryView = 'wall' | 'grid';
const VIEW_STORAGE_KEY = 'ps:gallery-view';

/**
 * 0.7.2：照片墙方块大小可调。
 * 原来方块边长写死 208 / 126 两档，用户反馈「不能调节照片墙大小」——
 * 现在给一条滑条，范围与当前值都存在 localStorage。
 */
const WALL_SIZE_KEY = 'ps:wall-size';
const WALL_MIN = 120;
const WALL_MAX = 300;

const SORT_LABELS: Record<SortKey, string> = {
  added: '添加时间',
  taken: '拍摄时间',
};

/** 模糊匹配：字序子序列 + 连续命中加权；返回 -1 表示不匹配 */
function fuzzyScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  const direct = haystack.indexOf(needle);
  if (direct >= 0) return 100 + needle.length * 2;

  let score = 0;
  let cursor = 0;
  let streak = 0;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, cursor);
    if (found < 0) return -1;
    streak = found === cursor ? streak + 1 : 0;
    score += 1 + streak * 2;
    cursor = found + 1;
  }
  return score;
}

export default function GalleryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [category, setCategory] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('added');
  const [desc, setDesc] = useState(true);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // 点开照片时记下缩略图在屏幕上的位置，预览层从这一块放大出来（FLIP）
  const [previewOrigin, setPreviewOrigin] = useState<ScreenRect | null>(null);
  const [view, setView] = useState<GalleryView>('wall');
  const [tileSize, setTileSize] = useState<number>(200);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === 'grid' || saved === 'wall') setView(saved);
      // 0.7.2：方块大小也沿用上次的选择
      const size = Number(window.localStorage.getItem(WALL_SIZE_KEY));
      if (Number.isFinite(size) && size >= WALL_MIN && size <= WALL_MAX) setTileSize(size);
    } catch {
      // 隐私模式下拿不到 localStorage，用默认的墙
    }
  }, []);

  const changeTileSize = useCallback((next: number) => {
    const clamped = Math.min(WALL_MAX, Math.max(WALL_MIN, Math.round(next)));
    setTileSize(clamped);
    try {
      window.localStorage.setItem(WALL_SIZE_KEY, String(clamped));
    } catch {
      // 存不上不影响本次使用
    }
  }, []);

  const changeView = useCallback((next: GalleryView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // 存不上不影响本次使用
    }
  }, []);

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
          setSortKey(saved.gallerySort ?? 'added');
          setDesc((saved.gallerySortDir ?? 'desc') === 'desc');
        }

        // listAll 一次跨项目取齐，比逐个项目 listByProject 少 N 次事务
        const [projects, allPhotos] = await Promise.all([
          withTimeout(ProjectRepository.list(), 5000, []),
          withTimeout(PhotoRepository.listAll(), 6000, []),
        ]);
        if (cancelled) return;

        const nameById = new Map<string, string>();
        for (const p of projects) nameById.set(p.id, p.name);

        const all: Item[] = allPhotos.map((photo) => {
          const a = photo.analysis;
          const projectName = nameById.get(photo.projectId) ?? '';
          const haystack = [
            a?.title ?? '',
            photo.fileName,
            projectName,
            ...(a?.tags ?? []),
            a?.mood ?? '',
            a?.params?.colorGrade ?? '',
            a?.params?.focalLength ?? '',
            a?.technique.lens ?? '',
          ]
            .join(' ')
            .toLowerCase();

          return {
            photo,
            projectId: photo.projectId,
            projectName,
            haystack,
            categories: matchCategories(haystack),
            when: photo.takenAt ?? photo.createdAt,
          };
        });

        setItems(all);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
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

  const photos = useMemo(() => visible.map((it) => it.photo), [visible]);

  /**
   * 大图预览要 objectURL。墙上的方块各自懒加载自己的预览，这里只把
   * 当前这一张 ±2 的邻居补进 previews，翻页时不会白屏。
   */
  const hydratePreviews = useCallback(async (list: Photo[], around: number) => {
    const slice = list.slice(Math.max(0, around - 2), around + 3);
    const pairs = await Promise.all(
      slice.map(async (p) => [p.id, (await loadPreview(p.id)) ?? ''] as const),
    );
    setPreviews((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, url] of pairs) {
        if (url && !next[id]) {
          next[id] = url;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** 预览层需要的 id → url 表：缓存里已经有的 + 临时补的 */
  const previewMap = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of photos) {
      const url = peekPreview(p.id);
      if (url) out[p.id] = url;
    }
    return { ...out, ...previews };
  }, [photos, previews]);

  const openPreview = useCallback(
    (index: number, rect: DOMRect) => {
      setPreviewOrigin({ x: rect.x, y: rect.y, w: rect.width, h: rect.height });
      setPreviewIndex(index);
      void hydratePreviews(photos, index);
    },
    [hydratePreviews, photos],
  );

  const navigatePreview = useCallback(
    (index: number) => {
      setPreviewIndex(index);
      void hydratePreviews(photos, index);
    },
    [hydratePreviews, photos],
  );

  /** 「加入选片」：沿用数据层原来的 selected 字段 */
  const addSelection = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const set = new Set(ids);
    try {
      await PhotoRepository.updateMany(ids, { selected: true });
      setItems((prev) =>
        prev
          ? prev.map((it) =>
              set.has(it.photo.id) ? { ...it, photo: { ...it.photo, selected: true } } : it,
            )
          : prev,
      );
      toast.success(`已把 ${ids.length} 张加入选片`);
    } catch {
      toast.error('加入选片失败，请再试一次');
    }
  }, []);

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
      {/* 0.7.2：照片库改成「满屏工作台」——整页不滚，墙面吃满剩余高度。
          以前这一页是普通文档流：页首 + 说明书 + 分类 + 排序把墙推下去，
          墙面只有 198–509px 露在屏幕里，看起来就像「照片墙是空的」。 */}
      <div className="flex h-[calc(100dvh-var(--header-h))] min-h-0 flex-col px-5 pt-4 pb-4 md:px-8">
        {/* 紧凑页首：一行说完「这是什么 + 有几张」 */}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <p className="ps-cap">Gallery</p>
            <h1 className="ps-serif ps-display mt-1.5 text-[26px] leading-[1.05] tracking-[0.01em] text-ink">
              照片库
            </h1>
          </div>
          <p className="ps-num pb-1 text-[11.5px] text-ink-faint">
            {items === null ? '读取中…' : `${visible.length} / ${items.length} 张`}
            <span className="mx-2 text-line">|</span>
            按住拖动 · 双击看大图
          </p>
        </div>

        {/* 说明书（收起态是一枚 chip）+ 用法提示，合并成一行，不再各占一段 */}
        <div className="mt-3 mb-3 flex flex-wrap items-center gap-1.5">
          <ModuleGuide moduleId="gallery" autoOpen={false} />
          {view === 'wall' && (
            <>
              <WallHint icon={Hand} text="按住拖动" />
              <WallHint icon={Mouse} text="滚轮缩放" />
              <WallHint icon={Maximize2} text="双击看大图" />
            </>
          )}
        </div>

        {/* 分类：横向可滚动 + 两端渐隐 */}
        <div className="ps-edge-fade -mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-1 ps-no-scrollbar">
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

        {/* 排序 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
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

          {/* 0.7.2：方块大小。照片墙的疏密应该由人决定，而不是写死 208px */}
          {view === 'wall' && (
            <label className="ml-auto flex items-center gap-2 text-[11.5px] text-ink-faint">
              <span className="hidden sm:inline">方块</span>
              <input
                type="range"
                min={WALL_MIN}
                max={WALL_MAX}
                step={4}
                value={tileSize}
                onChange={(e) => changeTileSize(Number(e.target.value))}
                aria-label="照片墙方块大小"
                className="ps-slider w-24 sm:w-32"
              />
              <span className="w-7 text-right tabular-nums">{tileSize}</span>
            </label>
          )}

          {/* 视图切换：照片墙（0.7 新玩法）/ 网格（原来那种） */}
          <div
            className={cn(
              'flex items-center gap-0.5 rounded-full border border-line/60 bg-surface-2/70 p-0.5',
              view !== 'wall' && 'ml-auto',
            )}
            role="group"
            aria-label="照片展示方式"
          >
            {(
              [
                { id: 'wall' as GalleryView, label: '照片墙', hint: '拖动查看，像推一块冰', Icon: Waves },
                { id: 'grid' as GalleryView, label: '网格', hint: '铺成格子，一眼看完', Icon: LayoutGrid },
              ]
            ).map(({ id, label, hint, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => changeView(id)}
                aria-pressed={view === id}
                title={hint}
                className={cn(
                  'ps-pressable flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] transition-colors duration-[200ms]',
                  view === id
                    ? 'bg-ink text-paper shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
                    : 'text-ink-mid hover:bg-surface hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {items === null ? (
          <div className="ps-wall ps-wall--fill">
            <div className="flex h-full flex-wrap content-start gap-3 overflow-hidden p-4">
              {Array.from({ length: 30 }).map((_, i) => (
                <div key={i} className="ps-skeleton h-[150px] w-[150px] rounded-[11px]" />
              ))}
            </div>
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
        ) : view === 'wall' ? (
          <div className="relative min-h-0 flex-1">
            <PhotoWall
              photos={photos}
              onOpen={openPreview}
              onAddSelected={(ids) => void addSelection(ids)}
              tileBase={tileSize}
              fill
            />
          </div>
        ) : (
          <div className="ps-enter grid h-full min-h-0 grid-cols-2 gap-3 overflow-y-auto pb-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((item, index) => (
              <GalleryTile
                key={item.photo.id}
                item={item}
                url={previewMap[item.photo.id]}
                onOpen={(rect) => openPreview(index, rect)}
              />
            ))}
          </div>
        )}
      </div>

      {previewIndex !== null && photos.length > 0 && (
        <PhotoStoryPreview
          photos={photos}
          index={Math.min(previewIndex, photos.length - 1)}
          previews={previewMap}
          origin={previewOrigin}
          onClose={() => setPreviewIndex(null)}
          onNavigate={navigatePreview}
        />
      )}
    </AppShell>
  );
}

function WallHint({ icon: Icon, text }: { icon: typeof Hand; text: string }) {
  return (
    <span
      className="inline-flex select-none items-center gap-1 rounded-full border border-line/50 bg-surface-2/50 px-2 py-1 text-[11px] leading-none text-ink-faint"
      aria-hidden
    >
      <Icon className="h-3 w-3" strokeWidth={1.8} />
      {text}
    </span>
  );
}

function GalleryTile({ item, url, onOpen }: { item: Item; url: string | undefined; onOpen: (rect: DOMRect) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [own, setOwn] = useState<string | undefined>(url);
  const photo = item.photo;
  const title = photo.analysis?.title || photo.fileName;
  const src = url ?? own;
  const params = photo.analysis?.params;

  // 预览图按需加载：网格一次能看到几十张，不能一进页面就把 blob 全拉出来
  useEffect(() => {
    if (url) {
      setOwn(url);
      return;
    }
    const cached = peekPreview(photo.id);
    if (cached) {
      setOwn(cached);
      return;
    }
    let cancelled = false;
    void loadPreview(photo.id).then((next) => {
      if (!cancelled && next) setOwn(next);
    });
    return () => {
      cancelled = true;
    };
  }, [photo.id, url]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) onOpen(rect);
      }}
      title={`${title}\n${formatDateTime(item.when)}`}
      aria-label={`打开 ${title}`}
      className="ps-tile group relative aspect-square overflow-hidden rounded-xl border border-line/50 bg-surface-2 text-left"
    >
      {src ? (
        <FadeImg
          src={src}
          alt={photo.analysis?.alt ?? photo.fileName}
          className="h-full w-full object-cover transition-transform duration-[420ms] ease-[var(--ease-out)] group-hover:scale-[1.03]"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <ImageOff className="h-5 w-5 text-ink-faint" />
        </span>
      )}

      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[#0a0a0c] opacity-0 transition-opacity duration-[380ms] ease-[var(--ease-out)] group-hover:opacity-25"
      />

      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-xl ring-2 ring-white/70 opacity-0 transition-opacity duration-[300ms] ease-[var(--ease-out)] group-hover:opacity-100"
      />

      {photo.selected && (
        <span className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-ink/85 px-1.5 py-0.5 text-[9px] font-medium text-paper">
          已选
        </span>
      )}

      {params?.focalLength && (
        <span className="pointer-events-none absolute top-1.5 right-1.5 rounded-md bg-black/45 px-1.5 py-0.5 text-[9px] text-white/85 opacity-0 backdrop-blur-sm transition-opacity duration-300 group-hover:opacity-100">
          {params.focalLength}
        </span>
      )}

      <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/72 to-transparent px-2.5 pt-7 pb-1.5 opacity-0 transition-all duration-[280ms] ease-[var(--ease-out)] group-hover:translate-y-0 group-hover:opacity-100">
        <span className="block truncate text-[11.5px] font-medium text-white">{title}</span>
        <span className="block truncate text-[9px] text-white/60">{item.projectName}</span>
      </span>
    </button>
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
