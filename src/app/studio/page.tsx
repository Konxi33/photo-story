'use client';

// src/app/studio/page.tsx
// 0.6.0 排版台：一张 A4 纸，12 列 × 24 行的积木画布。
//
// 0.5.7 把「板块顺序」做成了竖着的一列开关，用户说那不是他要的：
// 他要的是像俄罗斯方块一样**摆**出来，摆完让 AI 检查有没有排错。
// 于是有了这个页面：
//   · 左边是纸（版心），格线淡淡的，只是辅助，不打印；
//   · 右边是工具箱，没摆上的积木点一下就能放上去；
//   · 拖块身移动、拖右下角改大小，松手即吸附到格子；
//   · 摆完点「AI 检查」，模型会指出问题并给一版修正后的排版。

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Check,
  Grid3x3,
  Loader2,
  MousePointer2,
  Redo2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { reviewLayout } from '@/lib/ai/layoutReview';
import { ModuleGuide } from '@/components/module-guide';
import { BLOCK_MAP, type PhotoBlockId } from '@/lib/export/blocks';
import { exportContentCm, exportContentHeightCm } from '@/lib/export/metrics';
import {
  DEFAULT_BOX,
  GRID_COLS,
  GRID_ROWS,
  LAYOUT_PRESETS,
  MIN_BOX,
  applyLayout,
  clampItem,
  getLayoutPreset,
  overlaps,
  planLayoutPage,
  resolveLayout,
  toolboxBlocks,
  type LayoutItem,
  type PageLayout,
} from '@/lib/export/layout';
import type { Photo, PhotoAnalysis, Project, ProjectSummary } from '@/types/domain';

interface DragState {
  id: PhotoBlockId;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origin: LayoutItem;
  cellW: number;
  cellH: number;
}

export default function StudioPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [project, setProject] = useState<Project | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [layout, setLayout] = useState<PageLayout>(getLayoutPreset('photobook')!.layout);
  const [selected, setSelected] = useState<PhotoBlockId | null>(null);
  const [dirty, setDirty] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advice, setAdvice] = useState<{ summary: string; issues: string[]; changes: string[] } | null>(null);
  const [fromTemplate, setFromTemplate] = useState(true);

  const historyRef = useRef<PageLayout[]>([]);
  const futureRef = useRef<PageLayout[]>([]);
  const [, forceRender] = useState(0);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const layoutRef = useRef<PageLayout>(layout);
  const urlRef = useRef<string | null>(null);

  layoutRef.current = layout;

  const contentCm = project ? exportContentCm(project.exportSettings) : 16.6;
  const contentHeightCm = project ? exportContentHeightCm(project.exportSettings) : 25.2;
  const sample = useMemo<Photo | undefined>(
    () => photos.find((photo) => photo.status === 'success' && photo.analysis) ?? photos[0],
    [photos],
  );
  const sampleAnalysis = sample?.status === 'success' ? sample.analysis : undefined;

  /* ------------------------------ 载入 ------------------------------ */

  useEffect(() => {
    let alive = true;
    ProjectRepository.list()
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        setProjectId((prev) => prev || list[0]?.id || '');
      })
      .catch(() => toast.error('读取项目失败'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    (async () => {
      const [full, list] = await Promise.all([
        ProjectRepository.get(projectId),
        PhotoRepository.listByProject(projectId),
      ]);
      if (!alive) return;
      setProject(full ?? null);
      setPhotos(list);
      // 已经有自己的 grid 就照用；否则先给一版好看的模板，
      // 别拿 0.5.x 那套竖排（图片格又高又窄，画布上看像排错了）。
      const saved = full?.exportSettings.grid;
      const nextLayout =
        saved && saved.items.length > 0 ? resolveLayout(full!.exportSettings) : getLayoutPreset('photobook')!.layout;
      setLayout(nextLayout);
      setFromTemplate(!(saved && saved.items.length > 0));
      setDirty(false);
      setAdvice(null);
      historyRef.current = [];
      futureRef.current = [];

      const first = list.find((photo) => photo.status === 'success');
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
        setPreviewUrl(null);
      }
      if (first) {
        const asset = await AssetRepository.get(first.id, 'preview');
        if (alive && asset) {
          const url = URL.createObjectURL(asset.blob);
          urlRef.current = url;
          setPreviewUrl(url);
        }
      }
    })().catch(() => toast.error('读取项目内容失败'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  /* ---------------------------- 排版操作 ---------------------------- */

  const commit = useCallback((next: PageLayout) => {
    historyRef.current = [...historyRef.current.slice(-40), layoutRef.current];
    futureRef.current = [];
    setLayout(next);
    setDirty(true);
    forceRender((n) => n + 1);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.pop();
    if (!prev) return;
    futureRef.current = [...futureRef.current, layoutRef.current];
    setLayout(prev);
    setDirty(true);
    forceRender((n) => n + 1);
  }, []);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();
    if (!next) return;
    historyRef.current = [...historyRef.current, layoutRef.current];
    setLayout(next);
    setDirty(true);
    forceRender((n) => n + 1);
  }, []);

  const addBlock = useCallback(
    (id: PhotoBlockId) => {
      const current = layoutRef.current;
      if (current.items.some((item) => item.id === id)) return;
      const box = DEFAULT_BOX[id];
      const cols = MIN_BOX[id].colSpan;
      const rows = MIN_BOX[id].rowSpan;
      const width = Math.max(box.colSpan, cols);
      const height = Math.max(box.rowSpan, rows);

      // 找一个能放下的空位：从上到下扫
      for (let row = 0; row + height <= GRID_ROWS; row += 1) {
        for (let col = 0; col + width <= GRID_COLS; col += 1) {
          const candidate: LayoutItem = { id, col, row, colSpan: width, rowSpan: height };
          if (!current.items.some((item) => overlaps(item, candidate))) {
            commit({ ...current, items: [...current.items, candidate] });
            setSelected(id);
            return;
          }
        }
      }
      toast.error('纸面上没有这么大的空位了，先挪一挪或者删掉一块');
    },
    [commit],
  );

  const removeBlock = useCallback(
    (id: PhotoBlockId) => {
      const current = layoutRef.current;
      if (current.items.length <= 1) {
        toast.error('至少留一块');
        return;
      }
      commit({ ...current, items: current.items.filter((item) => item.id !== id) });
      setSelected((prev) => (prev === id ? null : prev));
    },
    [commit],
  );

  const applyPreset = useCallback(
    (presetId: string) => {
      const preset = getLayoutPreset(presetId);
      if (!preset) return;
      commit({ ...preset.layout });
      setSelected(null);
      toast.success(`已套用「${preset.name}」：${preset.hint}`);
    },
    [commit],
  );

  /* ---------------------------- 拖拽逻辑 ---------------------------- */

  const onPointerDown = (
    event: React.PointerEvent,
    item: LayoutItem,
    mode: 'move' | 'resize',
  ) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      id: item.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...item },
      cellW: rect.width / GRID_COLS,
      cellH: rect.height / GRID_ROWS,
    };
    setSelected(item.id);
    event.stopPropagation();
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const current = layoutRef.current;
      const dx = Math.round((event.clientX - drag.startX) / drag.cellW);
      const dy = Math.round((event.clientY - drag.startY) / drag.cellH);

      const candidate: LayoutItem =
        drag.mode === 'move'
          ? {
              ...drag.origin,
              col: drag.origin.col + dx,
              row: drag.origin.row + dy,
            }
          : {
              ...drag.origin,
              colSpan: drag.origin.colSpan + dx,
              rowSpan: drag.origin.rowSpan + dy,
            };

      const clamped = clampItem(candidate, current);
      const min = MIN_BOX[drag.id];
      if (clamped.colSpan < min.colSpan || clamped.rowSpan < min.rowSpan) return;

      const others = current.items.filter((item) => item.id !== drag.id);
      if (others.some((item) => overlaps(item, clamped))) return;

      const same =
        clamped.col === drag.origin.col &&
        clamped.row === drag.origin.row &&
        clamped.colSpan === drag.origin.colSpan &&
        clamped.rowSpan === drag.origin.rowSpan;
      if (same) return;

      drag.origin = clamped;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      const next: PageLayout = {
        ...current,
        items: current.items.map((item) => (item.id === drag.id ? clamped : item)),
      };
      setLayout(next);
      setDirty(true);
      forceRender((n) => n + 1);
    };

    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      historyRef.current = [...historyRef.current.slice(-40), layoutRef.current];
      futureRef.current = [];
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  /* ------------------------------ 保存 ------------------------------ */

  const save = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    try {
      const exportSettings = applyLayout(project.exportSettings, layout);
      const next = await ProjectRepository.update(project.id, { exportSettings });
      setProject(next ?? project);
      setDirty(false);
      setFromTemplate(false);
      toast.success('已保存到项目，下次导出就用这套排版');
    } catch {
      toast.error('保存失败，本地存储可能满了');
    } finally {
      setSaving(false);
    }
  }, [layout, project]);

  const askAi = useCallback(async () => {
    setChecking(true);
    setAdvice(null);
    try {
      const result = await reviewLayout({
        layout: {
          cols: GRID_COLS,
          rows: GRID_ROWS,
          items: layout.items.map((item) => ({ ...item })),
        },
        sample: sampleAnalysis
          ? {
              title: sampleAnalysis.title,
              story: sampleAnalysis.story,
              tags: sampleAnalysis.tags,
              hasScore: Boolean(sampleAnalysis.score),
            }
          : undefined,
        contentCm,
        contentHeightCm,
      });
      if (!result.ok) {
        toast.error(result.error.message || 'AI 检查失败');
        return;
      }
      const suggestion = result.suggestion;
      setAdvice({
        summary: suggestion.summary,
        issues: suggestion.issues,
        changes: suggestion.changes,
      });
      if (suggestion.layout) {
        commit({
          cols: suggestion.layout.cols,
          rows: suggestion.layout.rows,
          items: suggestion.layout.items as LayoutItem[],
        });
        toast.success('AI 给了一版修正，已经放到纸上了，不满意可以撤销');
      } else {
        toast.success('AI 看过了，没有需要改的地方');
      }
    } catch {
      toast.error('AI 检查请求失败，检查一下设置里的密钥');
    } finally {
      setChecking(false);
    }
  }, [commit, contentCm, contentHeightCm, layout, sampleAnalysis]);

  /* ------------------------------ 渲染 ------------------------------ */

  const unused = toolboxBlocks()
    .flatMap((group) => group.items)
    .filter((block) => !layout.items.some((item) => item.id === block.id));
  const plan = useMemo(
    () =>
      sample
        ? planLayoutPage({
            photo: sample,
            index: 1,
            settings: project ? applyLayout(project.exportSettings, layout) : ({} as never),
            contentCm,
            contentHeightCm,
          })
        : null,
    [sample, project, layout, contentCm, contentHeightCm],
  );

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={undo} disabled={historyRef.current.length === 0}>
            <Undo2 className="size-4" />
            撤销
          </Button>
          <Button variant="ghost" size="sm" onClick={redo} disabled={futureRef.current.length === 0}>
            <Redo2 className="size-4" />
            <span className="sr-only">重做</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => applyPreset('photobook')}>
            <RotateCcw className="size-4" />
            回到摄影集
          </Button>
          <Button variant="outline" size="sm" onClick={askAi} disabled={checking}>
            {checking ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            AI 检查
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {dirty ? '保存排版' : '已保存'}
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* 左：纸 */}
        <div className="min-w-0">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">排版台</p>
              <h1 className="mt-1 text-[26px] font-semibold tracking-tight">这一页，你自己摆</h1>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-ink-soft">
                拖块身挪位置，拖右下角改大小，松手自动吸到格子上。摆完点「AI 检查」，让它看看有没有排错。
                这里只决定每一页照片长什么样，封面、总览、章节页不受影响。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="h-9 w-[200px]">
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}（{item.photoCount} 张）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </header>

          <ModuleGuide moduleId="studio" className="mb-4" />

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] text-ink-faint">模板：</span>
            {LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.hint}
                onClick={() => applyPreset(preset.id)}
                className="rounded-full border border-line/70 px-2.5 py-1 text-[12px] text-ink-soft transition hover:border-ink/30 hover:bg-surface-2 hover:text-ink"
              >
                {preset.name}
              </button>
            ))}
            {fromTemplate ? (
              <span className="ml-1 text-[11px] text-amber-600 dark:text-amber-400">
                现在是「摄影集」模板，还没存进项目 —— 摆好点右上角「保存排版」
              </span>
            ) : null}
          </div>

          {/* A4 纸 */}
          <div className="rounded-2xl border border-line/60 bg-surface-2/60 p-4">
            <div
              ref={canvasRef}
              className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-lg bg-[#fbfaf7] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
              style={{ aspectRatio: `${contentCm} / ${contentHeightCm}` }}
              onPointerDown={() => setSelected(null)}
            >
              {/* 格线只在编辑时可见，不打印 */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.5]"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgba(0,0,0,0.055) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.045) 1px, transparent 1px)',
                  backgroundSize: `${100 / GRID_COLS}% ${100 / GRID_ROWS}%`,
                }}
              />

              {layout.items.map((item) => {
                const active = selected === item.id;
                return (
                  <div
                    key={item.id}
                    onPointerDown={(event) => onPointerDown(event, item, 'move')}
                    className={[
                      'absolute cursor-grab touch-none select-none overflow-hidden rounded-[3px] p-[2.5%] text-[10px] leading-snug',
                      'transition-[box-shadow,background-color] duration-150',
                      active
                        ? 'z-20 bg-[#fff8e6] ring-2 ring-amber-400/80 shadow-lg'
                        : 'z-10 bg-transparent ring-1 ring-dashed ring-black/10 hover:ring-black/25',
                    ].join(' ')}
                    style={{
                      left: `${(item.col / GRID_COLS) * 100}%`,
                      top: `${(item.row / GRID_ROWS) * 100}%`,
                      width: `${(item.colSpan / GRID_COLS) * 100}%`,
                      height: `${(item.rowSpan / GRID_ROWS) * 100}%`,
                    }}
                  >
                    <BlockPreview id={item.id} analysis={sampleAnalysis} imageUrl={previewUrl} index={1} />
                    {active ? (
                      <>
                        <button
                          type="button"
                          aria-label={`移除「${BLOCK_MAP[item.id].label}」`}
                          onClick={(event) => {
                            event.stopPropagation();
                            removeBlock(item.id);
                          }}
                          className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-ink-soft shadow ring-1 ring-black/10 hover:text-red-600"
                        >
                          <Trash2 className="size-3" />
                        </button>
                        <span
                          onPointerDown={(event) => onPointerDown(event, item, 'resize')}
                          className="absolute bottom-0 right-0 size-4 cursor-nwse-resize rounded-tl bg-amber-400/90"
                        />
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-center text-[11px] text-ink-faint">
              {contentCm.toFixed(1)} × {contentHeightCm.toFixed(1)} cm 版心 · {GRID_COLS} 列 × {GRID_ROWS} 行
              {plan && plan.warnings.length > 0 ? ` · ${plan.warnings[0]}` : ''}
            </p>
          </div>
        </div>

        {/* 右：工具箱 */}
        <aside className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-line/60 bg-surface p-3">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Grid3x3 className="size-4 text-ink-faint" />
              纸上的积木
            </h2>
            <ul className="mt-2 space-y-1">
              {layout.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    className={[
                      'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[12px] transition',
                      selected === item.id ? 'bg-amber-50 text-ink ring-1 ring-amber-300/70' : 'hover:bg-surface-2',
                    ].join(' ')}
                  >
                    <span className="truncate">{BLOCK_MAP[item.id].label}</span>
                    <span className="ml-2 shrink-0 text-[10px] text-ink-faint">
                      {item.colSpan}×{item.rowSpan}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-line/60 bg-surface p-3">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <MousePointer2 className="size-4 text-ink-faint" />
              还没摆上的
            </h2>
            <p className="mt-1 text-[11px] text-ink-faint">点一下就放到纸上的空位。</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {unused.length === 0 ? (
                <span className="text-[11px] text-ink-faint">全都摆上了</span>
              ) : (
                unused.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    title={block.hint}
                    onClick={() => addBlock(block.id)}
                    className="rounded-full border border-line/70 px-2.5 py-1 text-[11.5px] text-ink-soft transition hover:border-ink/30 hover:bg-surface-2 hover:text-ink"
                  >
                    + {block.label}
                  </button>
                ))
              )}
            </div>
          </section>

          {advice ? (
            <section className="rounded-2xl border border-amber-300/60 bg-amber-50/60 p-3">
              <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
                <Wand2 className="size-4" />
                AI 的看法
              </h2>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ink">{advice.summary}</p>
              {advice.issues.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11.5px] text-ink-soft">
                  {advice.issues.map((issue) => (
                    <li key={issue} className="flex gap-1.5">
                      <span className="text-amber-600">·</span>
                      {issue}
                    </li>
                  ))}
                </ul>
              ) : null}
              {advice.changes.length > 0 ? (
                <ul className="mt-2 space-y-1 text-[11.5px] text-ink-soft">
                  {advice.changes.map((change) => (
                    <li key={change} className="flex gap-1.5">
                      <span className="text-emerald-600">→</span>
                      {change}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-line/60 bg-surface p-3 text-[11.5px] leading-relaxed text-ink-soft">
            <h2 className="mb-1 text-[13px] font-semibold text-ink">纸面上的规矩</h2>
            <p>· 积木不能互相压住，压住的话拖不动（会原地弹回）。</p>
            <p>· 格子太小会先缩字号，缩到 7.5pt 还放不下就截断，并在导出报告里说明。</p>
            <p>· 一张照片连同它的文字永远只占一页，不会被拆到两页。</p>
            <Link
              href={ROUTES.projects}
              className="mt-2 inline-flex items-center gap-1 text-ink underline decoration-dotted underline-offset-4"
            >
              <ArrowLeft className="size-3.5" />
              回项目列表
            </Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

/* ------------------------------ 积木预览 ------------------------------ */

function BlockPreview({
  id,
  analysis,
  imageUrl,
  index,
}: {
  id: PhotoBlockId;
  analysis?: PhotoAnalysis;
  imageUrl: string | null;
  index: number;
}) {
  const label = BLOCK_MAP[id]?.label ?? id;

  if (id === 'image') {
    return imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={imageUrl} alt="" className="h-full w-full object-contain" draggable={false} />
    ) : (
      <div className="grid h-full place-items-center rounded bg-black/5 text-[10px] text-ink-faint">照片</div>
    );
  }

  if (id === 'index') {
    return <div className="text-[16px] font-semibold text-ink-faint">{String(index).padStart(2, '0')}</div>;
  }

  if (id === 'title') {
    return (
      <div className="truncate text-center text-[15px] font-semibold leading-tight">
        {analysis?.title || '（标题）'}
      </div>
    );
  }

  if (id === 'caption') {
    return <div className="truncate text-center text-[9.5px] text-ink-faint">图 {String(index).padStart(2, '0')} · {analysis?.title || '标题'}</div>;
  }

  if (id === 'story') {
    return <div className="line-clamp-[10] text-[10px] leading-[1.6] text-ink-soft">{analysis?.story || '（正文）'}</div>;
  }

  if (id === 'score') {
    const score = analysis?.score;
    return (
      <div className="space-y-0.5">
        <div className="text-[14px] font-semibold">{score ? score.overall.toFixed(1) : '—'} 分</div>
        <div className="text-[9px] text-ink-faint">
          构图 {score?.breakdown.composition ?? '—'} · 光线 {score?.breakdown.lighting ?? '—'}
        </div>
      </div>
    );
  }

  if (id === 'advice') {
    return (
      <div className="grid grid-cols-3 gap-1 text-[9px] text-ink-soft">
        {['为什么好', '可以更好', '下次这样拍'].map((title) => (
          <div key={title} className="rounded-sm bg-black/[0.035] p-1">
            <div className="mb-0.5 font-medium text-ink">{title}</div>
            <div className="line-clamp-3 text-ink-faint">……</div>
          </div>
        ))}
      </div>
    );
  }

  if (id === 'technique') {
    const t = analysis?.technique;
    return (
      <div className="space-y-0.5 text-[9.5px] text-ink-soft">
        {[
          ['构图', t?.composition],
          ['光线', t?.lighting],
          ['色彩', t?.color],
          ['镜头', t?.lens],
          ['后期', t?.post],
        ].map(([name, value]) => (
          <div key={name} className="flex gap-1">
            <span className="shrink-0 text-ink-faint">{name}</span>
            <span className="truncate">{value || '—'}</span>
          </div>
        ))}
      </div>
    );
  }

  if (id === 'tags') {
    return (
      <div className="line-clamp-2 text-[9.5px] text-ink-soft">
        {(analysis?.tags ?? []).map((tag) => `#${tag}`).join('  ') || '#标签'}
      </div>
    );
  }

  if (id === 'params') {
    const p = analysis?.params;
    return (
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] text-ink-soft">
        <span>焦段 {p?.focalLength || '—'}</span>
        <span>光圈 {p?.aperture || '—'}</span>
        <span>快门 {p?.shutter || '—'}</span>
        <span>ISO {p?.iso || '—'}</span>
      </div>
    );
  }

  return (
    <div className="text-[9.5px] text-ink-soft">
      {id === 'mood'
        ? analysis?.mood || '（氛围）'
        : id === 'alt'
          ? analysis?.alt || '（无障碍描述）'
          : id === 'category'
            ? `类别：${analysis?.tags?.[0] ?? '—'}`
            : id === 'exif'
              ? '机身 · 镜头 · 拍摄时间'
              : label}
    </div>
  );
}
