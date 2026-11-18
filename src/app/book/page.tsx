// src/app/book/page.tsx
// 0.5.2 新模块：编排台。
// 把一本照片故事从「一堆入选照片」变成「有章节、有顺序、有题记的一本书」。
// 这里的章节结构会写进 Word：章节顺序 = 成书顺序，每章开头插一页章节页。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  LayoutTemplate,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
  Wind,
  X,
} from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FadeImg } from '@/components/ui/fade-img';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import {
  autoChapters,
  cleanChapters,
  createChapter,
  estimatePages,
  flattenChapters,
  readBook,
  writeBook,
  type BookChapter,
} from '@/lib/book/store';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

export default function BookPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [chapters, setChapters] = useState<BookChapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const urlsRef = useRef<Record<string, string>>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedFor = useRef<string>('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // 项目列表
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await withTimeout(ProjectRepository.list(), 5000, []);
      if (cancelled) return;
      setProjects(list);
      if (list.length > 0) setProjectId((current) => current || (list[0]?.id ?? ''));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 选中项目 → 照片 + 预览图 + 已存编排
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      const list = await withTimeout(PhotoRepository.listByProject(projectId), 5000, []);
      if (cancelled) return;
      setPhotos(list);

      const urls: Record<string, string> = {};
      for (const photo of list) {
        try {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (asset) urls[photo.id] = URL.createObjectURL(asset.blob);
        } catch {
          // 单张失败忽略
        }
      }
      if (cancelled) return;
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = urls;
      setPreviews(urls);

      const saved = await readBook(projectId);
      if (cancelled) return;

      const validIds = new Set(list.filter((p) => p.selected).map((p) => p.id));
      const fallbackIds = validIds.size > 0 ? validIds : new Set(list.map((p) => p.id));
      const cleaned = saved ? cleanChapters(saved.chapters, fallbackIds) : [];
      setChapters(cleaned);
      setActiveId(cleaned[0]?.id ?? null);
      loadedFor.current = projectId;
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    return () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    };
  }, []);

  // 自动保存（防抖），只在这个项目的数据真的加载完之后才写
  const persist = useCallback(
    (next: BookChapter[]) => {
      if (!projectId || loadedFor.current !== projectId) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaving(true);
      saveTimer.current = setTimeout(() => {
        void (async () => {
          try {
            await writeBook({ projectId, chapters: next, updatedAt: Date.now() });
          } catch {
            toast.error('保存失败', { description: '本地存储写入异常，改动可能丢失' });
          } finally {
            setSaving(false);
          }
        })();
      }, 450);
    },
    [projectId],
  );

  const update = useCallback(
    (next: BookChapter[]) => {
      setChapters(next);
      persist(next);
    },
    [persist],
  );

  const byId = useMemo(() => {
    const map = new Map<string, Photo>();
    for (const photo of photos) map.set(photo.id, photo);
    return map;
  }, [photos]);

  const usedIds = useMemo(() => new Set(flattenChapters(chapters)), [chapters]);
  const pool = useMemo(() => photos.filter((p) => !usedIds.has(p.id)), [photos, usedIds]);
  const totalInBook = usedIds.size;
  const pages = estimatePages(chapters, totalInBook);

  const activeChapter = chapters.find((c) => c.id === activeId) ?? chapters[0] ?? null;

  const handleAuto = (): void => {
    const source = photos.filter((p) => p.selected);
    const list = source.length >= 3 ? source : photos;
    if (list.length === 0) {
      toast.error('这个项目还没有照片');
      return;
    }
    const next = autoChapters(list);
    update(next);
    setActiveId(next[0]?.id ?? null);
    toast.success(`已按拍摄日期分成 ${next.length} 章`, {
      description: '每章可以改标题、写一句题记，也可以继续拖拽调整顺序',
    });
  };

  const handleAddChapter = (): void => {
    const next = [...chapters, createChapter(`第 ${chapters.length + 1} 章`)];
    update(next);
    setActiveId(next[next.length - 1]?.id ?? null);
  };

  /**
   * 0.5.6：呼吸页——标题留空、只写一句题记。
   * 导出时它就是一整页留白 + 居中一行字，用来把两组照片隔开、让节奏喘口气。
   */
  const handleAddBreath = (): void => {
    const chapter = {
      ...createChapter(''),
      note: '在两组照片之间留一页白，只放一行字。',
      photoIds: [] as string[],
    };
    const next = [...chapters, chapter];
    update(next);
    setActiveId(chapter.id);
    toast.success('已加一页留白', {
      description: '标题留空、只写题记，导出就是一张呼吸页',
    });
  };

  const addPhoto = (photoId: string): void => {
    const target = activeChapter ?? chapters[0];
    if (!target) {
      const chapter = createChapter('第 1 章', [photoId]);
      update([chapter]);
      setActiveId(chapter.id);
      return;
    }
    if (usedIds.has(photoId)) return;
    update(
      chapters.map((c) =>
        c.id === target.id ? { ...c, photoIds: [...c.photoIds, photoId] } : c,
      ),
    );
  };

  const removePhoto = (chapterId: string, photoId: string): void => {
    update(
      chapters.map((c) =>
        c.id === chapterId
          ? { ...c, photoIds: c.photoIds.filter((id) => id !== photoId) }
          : c,
      ),
    );
  };

  const moveChapter = (id: string, dir: -1 | 1): void => {
    const index = chapters.findIndex((c) => c.id === id);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= chapters.length) return;
    update(arrayMove(chapters, index, target));
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = chapters.findIndex((c) => c.id === active.id);
    const to = chapters.findIndex((c) => c.id === over.id);
    if (from < 0 || to < 0) return;
    update(arrayMove(chapters, from, to));
  };

  const emptyBook = chapters.length === 0;

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-1.5">
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 rounded-full px-3"
            title="按排好的顺序翻页看一遍成书效果"
          >
            <Link href={ROUTES.flip}>
              <BookOpenCheck className="mr-1.5 h-3.5 w-3.5" />
              翻页预览
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-8 rounded-full px-3"
            title="这一页的积木摆在哪，去排版台自己拖"
          >
            <Link href={ROUTES.studio}>
              <LayoutTemplate className="mr-1.5 h-3.5 w-3.5" />
              排版台
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full px-3.5"
            onClick={handleAddBreath}
            disabled={loading}
            title="加一页留白：标题留空、只写一句题记，导出时就是一张呼吸页"
          >
            <Wind className="mr-1.5 h-3.5 w-3.5" />
            呼吸页
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-full px-3.5"
            onClick={handleAuto}
            disabled={loading || photos.length === 0}
            title="按拍摄日期自动分章，之后可以逐章改"
          >
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            自动分章
          </Button>
        </div>
      }
    >
      <div className="px-5 py-8 md:px-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="ps-eyebrow">Book</p>
            <h1 className="ps-display mt-2 text-[26px] text-ink">编排</h1>
            <p className="mt-2 max-w-[40rem] text-[13px] leading-relaxed text-ink-mid">
              把入选照片分进章节、排好先后、写一句题记。导出的 Word 会按这个结构走：章节页 → 照片页。
            </p>
          </div>
          {projects && projects.length > 0 && (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-8 w-48 rounded-full text-[12.5px]">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}（{p.successCount}/{p.photoCount}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="book" className="mb-5" />

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-[13px] text-ink-faint">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在读取编排…
          </div>
        ) : !projects || projects.length === 0 ? (
          <EmptyState
            title="还没有项目"
            hint="先建一个项目、导入照片，再回来编排。"
            href={ROUTES.projects}
            cta="去建项目"
          />
        ) : photos.length === 0 ? (
          <EmptyState
            title="这个项目还没有照片"
            hint="导入照片并生成文字之后，这里就能按章节排了。"
            href={`/projects/${projectId}`}
            cta="去添加照片"
          />
        ) : (
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
            {/* 章节列表 */}
            <div className="min-w-0">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="ps-eyebrow">
                  章节 · {chapters.length} 段 · {totalInBook} 张
                </h2>
                <div className="flex items-center gap-2">
                  {saving && <span className="text-[11px] text-ink-faint">保存中…</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 rounded-full px-2.5 text-[12px]"
                    onClick={handleAddChapter}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    加一章
                  </Button>
                </div>
              </div>

              {emptyBook ? (
                <div className="rounded-[14px] border border-dashed border-line/80 bg-surface-2/40 px-6 py-14 text-center">
                  <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
                    <BookOpen className="h-5 w-5 text-ink-faint" strokeWidth={1.5} />
                  </span>
                  <p className="text-[14px] font-medium text-ink">还没有章节</p>
                  <p className="mt-1.5 text-[12.5px] text-ink-faint">
                    点右上「自动分章」按拍摄日期切，或者手动加一章。
                  </p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button size="sm" className="h-8 rounded-full" onClick={handleAuto}>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                      自动分章
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-full"
                      onClick={handleAddChapter}
                    >
                      手动加一章
                    </Button>
                  </div>
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={chapters.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    <div className="grid gap-2.5">
                      {chapters.map((chapter, index) => (
                        <ChapterCard
                          key={chapter.id}
                          chapter={chapter}
                          index={index}
                          total={chapters.length}
                          active={chapter.id === activeChapter?.id}
                          previews={previews}
                          photos={byId}
                          onActivate={() => setActiveId(chapter.id)}
                          onTitle={(title) =>
                            update(chapters.map((c) => (c.id === chapter.id ? { ...c, title } : c)))
                          }
                          onNote={(note) =>
                            update(chapters.map((c) => (c.id === chapter.id ? { ...c, note } : c)))
                          }
                          onRemovePhoto={(photoId) => removePhoto(chapter.id, photoId)}
                          onMove={(dir) => moveChapter(chapter.id, dir)}
                          onDelete={() => {
                            update(chapters.filter((c) => c.id !== chapter.id));
                            if (activeId === chapter.id) setActiveId(null);
                          }}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>

            {/* 右栏：统计 + 待编排照片 */}
            <aside className="grid gap-3">
              <div className="rounded-[14px] border border-line/60 bg-surface/60 p-4">
                <p className="ps-eyebrow">这本书</p>
                <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                  <Stat label="章节" value={String(chapters.length)} />
                  <Stat label="收录" value={`${totalInBook} 张`} />
                  <Stat label="未编排" value={`${pool.length} 张`} tone={pool.length > 0 ? 'warn' : 'plain'} />
                  <Stat label="约" value={`${pages} 页`} />
                </div>

                {/* 结构条：封面 / 目录 / 章节 / 照片页，一眼看出节奏 */}
                <div className="mt-3.5 flex items-end gap-1" aria-hidden>
                  <span className="h-6 w-3 rounded-[2px] bg-ink/20" title="封面" />
                  <span className="h-4 w-2 rounded-[2px] bg-ink/15" title="目录" />
                  {chapters.map((c) => (
                    <span
                      key={c.id}
                      className="h-2 w-1.5 rounded-[2px] bg-ink/45"
                      title={`${c.title} · ${c.photoIds.length} 张`}
                    />
                  ))}
                  <span className="ml-auto text-[10.5px] text-ink-faint">
                    {totalInBook === 0 ? '空' : `${pages} 页`}
                  </span>
                </div>

                {pool.length === 0 && totalInBook > 0 && (
                  <p className="mt-3 border-t border-line/50 pt-2.5 text-[11.5px] leading-relaxed text-ink-faint">
                    全部照片都已编排。导出时章节顺序就是成书顺序。
                  </p>
                )}
              </div>

              <div className="rounded-[14px] border border-line/60 bg-surface/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="ps-eyebrow">待编排 · {pool.length}</p>
                  {activeChapter && (
                    <span className="truncate text-[10.5px] text-ink-faint">
                      加入「{activeChapter.title || '未命名'}」
                    </span>
                  )}
                </div>
                {pool.length === 0 ? (
                  <p className="py-3 text-center text-[11.5px] text-ink-faint">没有待编排的照片</p>
                ) : (
                  <div className="grid max-h-[420px] grid-cols-3 gap-1.5 overflow-y-auto pr-0.5">
                    {pool.map((photo) => (
                      <button
                        key={photo.id}
                        type="button"
                        onClick={() => addPhoto(photo.id)}
                        title={photo.analysis?.title ?? photo.fileName}
                        className="group relative aspect-square overflow-hidden rounded-md border border-line/50 bg-surface-2 transition-transform duration-200 hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-ink/40 focus-visible:outline-none"
                      >
                        {previews[photo.id] ? (
                          <FadeImg
                            src={previews[photo.id]!}
                            alt={photo.analysis?.title ?? photo.fileName}
                            className="h-full w-full object-cover opacity-85 transition-opacity duration-200 group-hover:opacity-100"
                          />
                        ) : (
                          <span className="block h-full w-full" />
                        )}
                        <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/35">
                          <Plus className="h-4 w-4 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {photos.length > 0 && (
                <Link
                  href={`/projects/${projectId}`}
                  className="rounded-[14px] border border-line/60 bg-surface/60 px-4 py-3 text-[12px] text-ink-mid transition-colors duration-200 hover:border-ink/20 hover:text-ink"
                >
                  回到工作台导出成书 →
                </Link>
              )}
            </aside>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function ChapterCard({
  chapter,
  index,
  total,
  active,
  previews,
  photos,
  onActivate,
  onTitle,
  onNote,
  onRemovePhoto,
  onMove,
  onDelete,
}: {
  chapter: BookChapter;
  index: number;
  total: number;
  active: boolean;
  previews: Record<string, string>;
  photos: Map<string, Photo>;
  onActivate: () => void;
  onTitle: (title: string) => void;
  onNote: (note: string) => void;
  onRemovePhoto: (photoId: string) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chapter.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
  };

  return (
    <section
      ref={setNodeRef}
      style={style}
      onMouseDown={onActivate}
      className={cn(
        'group/chapter rounded-[14px] border bg-surface/70 transition-[border-color,box-shadow] duration-200',
        active ? 'border-ink/25 shadow-[var(--elev-2)]' : 'border-line/60 hover:border-ink/15',
        isDragging && 'shadow-[var(--elev-3)]',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`拖动「${chapter.title || '未命名'}」调整顺序`}
          className="cursor-grab touch-none text-ink-faint/60 transition-colors hover:text-ink active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span className="w-6 shrink-0 text-center font-mono text-[11px] text-ink-faint">
          {String(index + 1).padStart(2, '0')}
        </span>

        <Input
          value={chapter.title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="章节标题"
          className="h-7 max-w-[220px] border-none bg-transparent px-1 text-[13.5px] font-medium shadow-none focus-visible:ring-0"
        />

        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-ink-faint">
          {chapter.photoIds.length} 张
        </span>

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-200 group-hover/chapter:opacity-100 focus-within:opacity-100">
          <IconButton label="上移" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="下移" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="删除章节" onClick={onDelete} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <Input
        value={chapter.note}
        onChange={(e) => onNote(e.target.value)}
        placeholder="一句题记（可留空）"
        className="mx-3 mt-1 h-7 w-[calc(100%-1.5rem)] border-none bg-transparent px-1 text-[12px] text-ink-faint shadow-none focus-visible:ring-0"
      />

      <div className="flex flex-wrap gap-1.5 px-3 pt-1 pb-3">
        {chapter.photoIds.length === 0 && (
          <p className="py-2 text-[11.5px] text-ink-faint">这一章还是空的，从右侧点照片加进来。</p>
        )}
        {chapter.photoIds.map((id, i) => {
          const photo = photos.get(id);
          if (!photo) return null;
          return (
            <div
              key={id}
              className="group/thumb relative h-[54px] w-[54px] overflow-hidden rounded-md border border-line/50 bg-surface-2"
              title={photo.analysis?.title ?? photo.fileName}
            >
              {previews[id] ? (
                <FadeImg
                  src={previews[id]!}
                  alt={photo.analysis?.title ?? photo.fileName}
                  className="h-full w-full object-cover"
                />
              ) : null}
              <span className="pointer-events-none absolute bottom-0 left-0 rounded-tr bg-black/50 px-1 font-mono text-[9px] text-white/80">
                {String(i + 1).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={() => onRemovePhoto(id)}
                aria-label="从本章移除"
                className="absolute top-0.5 right-0.5 rounded-full bg-black/55 p-0.5 text-white/85 opacity-0 transition-opacity duration-150 group-hover/thumb:opacity-100 hover:bg-black/75"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'rounded-md p-1 text-ink-faint transition-colors duration-150',
        'hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-30',
        danger && 'hover:bg-destructive/10 hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}

function Stat({
  label,
  value,
  tone = 'plain',
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'warn';
}) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-2.5 py-1.5">
      <p className="text-[10.5px] text-ink-faint">{label}</p>
      <p
        className={cn(
          'mt-0.5 text-[15px] font-medium tabular-nums',
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({
  title,
  hint,
  href,
  cta,
}: {
  title: string;
  hint: string;
  href: string;
  cta: string;
}) {
  return (
    <div className="rounded-[16px] border border-dashed border-line/80 bg-surface-2/30 px-6 py-20 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
        <BookOpen className="h-5 w-5 text-ink-faint" strokeWidth={1.4} />
      </span>
      <p className="text-[15px] font-medium text-ink">{title}</p>
      <p className="mt-1.5 text-[12.5px] text-ink-faint">{hint}</p>
      <Link href={href}>
        <Button size="sm" className="mt-5 h-8 rounded-full px-4">
          {cta}
        </Button>
      </Link>
    </div>
  );
}
