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
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  Grid3x3,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Move,
  MousePointerClick,
  Redo2,
  RotateCcw,
  Ruler,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  Wand2,
} from 'lucide-react';

import { AppShell } from '@/components/app-shell';
import { BLOCK_DRAG_MIME, BlockTile } from '@/components/studio/block-tile';
import { MiniLayout } from '@/components/studio/mini-layout';
import { PaperFacts } from '@/components/studio/paper-facts';
import { PresetCard } from '@/components/studio/preset-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { DEFAULT_APP_SETTINGS, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { WORD_PAPER } from '@/config/wordLayout';
import { KvRepository } from '@/lib/db';
import type { AppSettings } from '@/types/domain';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { reviewLayout } from '@/lib/ai/layoutReview';
import { ModuleGuide } from '@/components/module-guide';
import { BLOCK_MAP, type PhotoBlockId } from '@/lib/export/blocks';
import { exportContentCm, exportContentHeightCm, exportMarginCm } from '@/lib/export/metrics';
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
import {
  listLayouts,
  removeLayout,
  saveLayout,
  suggestLayoutName,
  type SavedLayout,
} from '@/lib/export/layout-store';
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
  // 0.6.3：拖到「放不下」的位置时给出红色虚框反馈 —— 之前是静默不动，用户以为拖不动
  const [ghost, setGhost] = useState<{ item: LayoutItem; ok: boolean } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [advice, setAdvice] = useState<{ summary: string; issues: string[]; changes: string[] } | null>(null);
  const [fromTemplate, setFromTemplate] = useState(true);

  // 0.6.1：方案库 + 换一张样片看效果
  const [layouts, setLayouts] = useState<SavedLayout[]>([]);
  const [layoutName, setLayoutName] = useState('');
  const [busyLayout, setBusyLayout] = useState(false);
  const [sampleId, setSampleId] = useState<string>('');

  // 0.7.2：从右侧「积木」面板拖到纸上的落位预览（半透明块 + 能不能放）
  const [dropGhost, setDropGhost] = useState<{ id: PhotoBlockId; item: LayoutItem; ok: boolean } | null>(
    null,
  );
  const draggingBlockRef = useRef<PhotoBlockId | null>(null);

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
  // 0.6.1：画布上展示「哪一张照片」可以由用户换，方便看不同比例的照片在这套版式里什么样
  const renderable = useMemo(
    () => photos.filter((photo) => photo.status === 'success'),
    [photos],
  );
  const sample = useMemo<Photo | undefined>(() => {
    if (sampleId) {
      const hit = renderable.find((photo) => photo.id === sampleId);
      if (hit) return hit;
    }
    return renderable.find((photo) => photo.analysis) ?? renderable[0] ?? photos[0];
  }, [renderable, photos, sampleId]);
  const sampleIndex = sample ? renderable.findIndex((photo) => photo.id === sample.id) : -1;
  const sampleAnalysis = sample?.status === 'success' ? sample.analysis : undefined;

  const switchSample = useCallback(
    (delta: number) => {
      if (renderable.length < 2) return;
      const current = sampleIndex >= 0 ? sampleIndex : 0;
      const next = (current + delta + renderable.length) % renderable.length;
      setSampleId(renderable[next].id);
    },
    [renderable, sampleIndex],
  );
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
      // 没存过版式时用「设置 → 外观/排版」里选的默认模板（默认还是摄影集）
      let preset = getLayoutPreset('photobook')!;
      try {
        const settings = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
        const wanted = { ...DEFAULT_APP_SETTINGS, ...(settings ?? {}) }.defaultLayoutPreset;
        if (wanted) preset = getLayoutPreset(wanted) ?? preset;
      } catch {
        /* 读不到设置就用摄影集，不影响使用 */
      }
      const nextLayout =
        saved && saved.items.length > 0 ? resolveLayout(full!.exportSettings) : preset.layout;
      setLayout(nextLayout);
      setFromTemplate(!(saved && saved.items.length > 0));
      setDirty(false);
      setAdvice(null);
      historyRef.current = [];
      futureRef.current = [];

      const first = list.find((photo) => photo.status === 'success');
      setSampleId(first?.id ?? '');
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
        setPreviewUrl(null);
      }
    })().catch(() => toast.error('读取项目内容失败'));
    return () => {
      alive = false;
    };
  }, [projectId]);

  // 画布上的样片换人时重新取图（preview 变体最长边 640，够看版式）
  useEffect(() => {
    const id = sample?.id;
    if (!id) {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      setPreviewUrl(null);
      return;
    }
    let alive = true;
    (async () => {
      const asset = await AssetRepository.get(id, 'preview');
      if (!alive || !asset) return;
      const url = URL.createObjectURL(asset.blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = url;
      setPreviewUrl(url);
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sample?.id]);

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

  /** 这块积木「默认占多大」——拖到纸上时的初始尺寸，也是面板缩略图上画的那块 */
  const defaultSize = (id: PhotoBlockId) => {
    const box = DEFAULT_BOX[id];
    const min = MIN_BOX[id];
    return {
      colSpan: Math.max(box.colSpan, min.colSpan),
      rowSpan: Math.max(box.rowSpan, min.rowSpan),
    };
  };

  const previewItem = (id: PhotoBlockId): LayoutItem => ({ id, col: 0, row: 0, ...defaultSize(id) });

  /* --------------------- 从积木面板拖到纸上（0.7.2） --------------------- */

  const onCanvasDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    const id = draggingBlockRef.current;
    const canvas = canvasRef.current;
    if (!id || !canvas) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    const rect = canvas.getBoundingClientRect();
    const { colSpan, rowSpan } = defaultSize(id);
    // 让块的中心跟着光标落，比左上角跟着光标更符合直觉
    const col = Math.round((event.clientX - rect.left) / (rect.width / GRID_COLS) - colSpan / 2);
    const row = Math.round((event.clientY - rect.top) / (rect.height / GRID_ROWS) - rowSpan / 2);

    const current = layoutRef.current;
    const proposed = clampItem({ id, col, row, colSpan, rowSpan }, current);
    const others = current.items.filter((item) => item.id !== id);
    const ok = !others.some((item) => overlaps(item, proposed));
    setDropGhost((prev) =>
      prev &&
      prev.id === id &&
      prev.ok === ok &&
      prev.item.col === proposed.col &&
      prev.item.row === proposed.row &&
      prev.item.colSpan === proposed.colSpan
        ? prev
        : { id, item: proposed, ok },
    );
  };

  const onCanvasDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropGhost(null);
  };

  const onCanvasDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const id = (event.dataTransfer.getData(BLOCK_DRAG_MIME) || draggingBlockRef.current) as
      | PhotoBlockId
      | null;
    const target = dropGhost;
    draggingBlockRef.current = null;
    setDropGhost(null);
    if (!id || !target || target.id !== id) return;

    const current = layoutRef.current;
    if (!target.ok) {
      const blocker = current.items.find(
        (item) => item.id !== id && overlaps(item, target.item),
      );
      toast.error(
        blocker ? `「${BLOCK_MAP[blocker.id].label}」占着这里，换个地方放` : '这里放不下这一块',
      );
      return;
    }

    // 已经在纸上的块：拖一下就是挪位置；没在纸上的：当成新增
    const exists = current.items.some((item) => item.id === id);
    commit({
      ...current,
      items: exists
        ? current.items.map((item) => (item.id === id ? target.item : item))
        : [...current.items, target.item],
    });
    setSelected(id);
  };

  const onTileDragStart = (id: PhotoBlockId) => {
    draggingBlockRef.current = id;
  };

  const onTileDragEnd = () => {
    draggingBlockRef.current = null;
    setDropGhost(null);
  };

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

  /* ---------------------------- 方案库 ---------------------------- */

  useEffect(() => {
    listLayouts()
      .then(setLayouts)
      .catch(() => undefined);
  }, []);

  const handleSaveLayout = useCallback(async () => {
    if (!project) return;
    setBusyLayout(true);
    try {
      const merged = await saveLayout(layoutName || suggestLayoutName(layoutRef.current), layoutRef.current, project.id);
      setLayouts(merged);
      setLayoutName(merged[0]?.name ?? '');
      toast.success('已存进方案库', { description: '换项目也能套用这套版式' });
    } catch (error) {
      toast.error('保存方案失败', { description: (error as Error).message });
    } finally {
      setBusyLayout(false);
    }
  }, [layoutName, project]);

  const handleApplyLayout = useCallback(
    (id: string) => {
      const hit = layouts.find((row) => row.id === id);
      if (!hit) return;
      commit({ ...hit.layout });
      setSelected(null);
      toast.success(`已套用「${hit.name}」`);
    },
    [commit, layouts],
  );

  const handleRemoveLayout = useCallback(async (id: string) => {
    setBusyLayout(true);
    try {
      const merged = await removeLayout(id);
      setLayouts(merged);
      toast.success('方案已删除');
    } catch (error) {
      toast.error('删除方案失败', { description: (error as Error).message });
    } finally {
      setBusyLayout(false);
    }
  }, []);

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
      const others = current.items.filter((item) => item.id !== drag.id);
      const blocked =
        clamped.colSpan < min.colSpan ||
        clamped.rowSpan < min.rowSpan ||
        others.some((item) => overlaps(item, clamped));

      if (blocked) {
        setGhost({ item: clamped, ok: false });
        return;
      }
      setGhost(null);

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
      setGhost(null);
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

  /* ------------------------ 键盘微调（0.6.1） ------------------------ */

  // 选中一块后：方向键挪一格，Shift+方向键改大小，Delete 移除，Ctrl+Z 撤销。
  // 拖拽虽然直观，但想「正好对齐到第 3 列」时按一次方向键更省事。
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (!selected) return;

      const current = layoutRef.current;
      const item = current.items.find((row) => row.id === selected);
      if (!item) return;

      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeBlock(selected);
        return;
      }

      const delta = deltas[event.key];
      if (!delta) return;
      event.preventDefault();

      const nextItem: LayoutItem = event.shiftKey
        ? { ...item, colSpan: item.colSpan + delta[0], rowSpan: item.rowSpan + delta[1] }
        : { ...item, col: item.col + delta[0], row: item.row + delta[1] };
      const fitted = clampItem(nextItem, current);
      const others = current.items.filter((row) => row.id !== selected);
      if (others.some((row) => overlaps(row, fitted))) return;
      commit({ ...current, items: current.items.map((row) => (row.id === selected ? fitted : row)) });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, redo, removeBlock, selected, undo]);

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

  // 0.7.2：14 块积木全都进面板（已经在纸上的实心、还没摆上的虚线+加号），不再分两个列表
  const blocks = useMemo(() => toolboxBlocks().flatMap((group) => group.items), []);
  const activePreset = useMemo(
    () =>
      LAYOUT_PRESETS.find((preset) => layoutSignature(preset.layout) === layoutSignature(layout)) ??
      null,
    [layout],
  );
  const activeSaved = useMemo(
    () => layouts.find((row) => layoutSignature(row.layout) === layoutSignature(layout)) ?? null,
    [layouts, layout],
  );
  const currentLayoutName = activeSaved?.name ?? activePreset?.name ?? '自己摆的版式';

  const paperMeta = project ? project.exportSettings : null;
  const paper = WORD_PAPER[paperMeta?.paperSize ?? 'a4'] ?? WORD_PAPER.a4;
  const marginCm = paperMeta ? exportMarginCm(paperMeta) : 2.2;
  const gutterCm = paperMeta?.gutter ?? 0;
  const orientation = paperMeta?.orientation ?? 'portrait';

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
      <div className="grid gap-6 px-5 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_344px]">
        {/* 左：纸 */}
        <div className="min-w-0">
          <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink-faint">排版台</p>
              <h1 className="ps-page-title-compact mt-1">这一页，你自己摆</h1>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                <span className="inline-flex items-center gap-1">
                  <Move className="size-3.5 text-copper" aria-hidden />
                  拖块身挪位置
                </span>
                <span className="inline-flex items-center gap-1">
                  <Maximize2 className="size-3.5 text-copper" aria-hidden />
                  拖右下角改大小
                </span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="size-3.5 text-copper" aria-hidden />
                  点「AI 检查」排错
                </span>
                <span
                  className="inline-flex items-center gap-1 text-ink-faint"
                  title="这里只决定每一页照片长什么样，封面、总览、章节页不受影响。"
                >
                  <MousePointerClick className="size-3.5" aria-hidden />
                  只作用于照片页
                </span>
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

          <ModuleGuide moduleId="studio" className="mb-3" />

          {/* 一条 bar 说清三件事：用的是哪套版式、存没存进项目、画布上是哪张样片 */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line/60 bg-surface px-2.5 py-1.5">
            <span
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-2/60 px-1.5 py-1"
              title={activePreset ? `${activePreset.name} —— ${activePreset.hint}` : '自己摆的版式'}
            >
              <MiniLayout items={layout.items} className="w-[14px]" />
              <span className="text-[11.5px] font-medium text-ink">{currentLayoutName}</span>
            </span>
            {fromTemplate ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] text-amber-700 dark:text-amber-400"
                title="摆好点右上角「保存排版」"
              >
                <TriangleAlert className="size-3" aria-hidden />
                还没存进项目
              </span>
            ) : null}

            <span className="mx-0.5 h-4 w-px shrink-0 bg-line" />

            <ImageIcon className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
            <button
              type="button"
              onClick={() => switchSample(-1)}
              disabled={renderable.length < 2}
              aria-label="上一张样片"
              className="grid size-5 shrink-0 place-items-center rounded-full text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" aria-hidden />
            </button>
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-soft">
              {sample
                ? `${sampleAnalysis?.title || sample.fileName}${sampleIndex >= 0 ? ` · 第 ${sampleIndex + 1}/${renderable.length} 张` : ''}`
                : '这个项目还没有可显示的照片'}
            </span>
            <button
              type="button"
              onClick={() => switchSample(1)}
              disabled={renderable.length < 2}
              aria-label="下一张样片"
              className="grid size-5 shrink-0 place-items-center rounded-full text-ink-faint transition hover:bg-surface-2 hover:text-ink disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" aria-hidden />
            </button>
          </div>

          {/* A4 纸 */}
          <div className="rounded-2xl border border-line/60 bg-surface-2/60 p-4">
            <div
              ref={canvasRef}
              data-paper="1"
              className="relative mx-auto w-full max-w-[560px] overflow-hidden rounded-lg bg-[#fbfaf7] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.45)] ring-1 ring-black/5"
              style={{ aspectRatio: `${contentCm} / ${contentHeightCm}` }}
              onPointerDown={() => setSelected(null)}
              onDragOver={onCanvasDragOver}
              onDragLeave={onCanvasDragLeave}
              onDrop={onCanvasDrop}
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

              {/* 从右侧积木面板拖进来时的落位预览：半透明块 + 能不能放的提示 */}
              {dropGhost ? (
                <div
                  aria-hidden
                  className={[
                    'pointer-events-none absolute z-40 rounded-[3px]',
                    dropGhost.ok ? 'ps-drop-ok' : 'ps-drop-bad',
                  ].join(' ')}
                  style={{
                    left: `${(dropGhost.item.col / GRID_COLS) * 100}%`,
                    top: `${(dropGhost.item.row / GRID_ROWS) * 100}%`,
                    width: `${(dropGhost.item.colSpan / GRID_COLS) * 100}%`,
                    height: `${(dropGhost.item.rowSpan / GRID_ROWS) * 100}%`,
                  }}
                >
                  <span
                    className={[
                      'absolute left-1 whitespace-nowrap rounded bg-black/70 px-1 py-0.5 text-[9px] text-white',
                      // 贴近纸底时把角标翻到块的上面，免得被纸边裁掉
                      dropGhost.item.row + dropGhost.item.rowSpan > GRID_ROWS - 2 ? 'bottom-full mb-0.5' : 'top-1',
                    ].join(' ')}
                  >
                    {dropGhost.item.colSpan}×{dropGhost.item.rowSpan}
                    {dropGhost.ok ? '' : ' 放不下'}
                  </span>
                </div>
              ) : null}

              {ghost ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute z-30 rounded-[3px] border-2 border-dashed border-rose-400/80 bg-rose-400/10"
                  style={{
                    left: `${(ghost.item.col / GRID_COLS) * 100}%`,
                    top: `${(ghost.item.row / GRID_ROWS) * 100}%`,
                    width: `${(ghost.item.colSpan / GRID_COLS) * 100}%`,
                    height: `${(ghost.item.rowSpan / GRID_ROWS) * 100}%`,
                  }}
                >
                  <span className="absolute left-1 top-1 rounded bg-rose-500/90 px-1 py-0.5 text-[9px] text-white">
                    这里放不下
                  </span>
                </div>
              ) : null}

              {layout.items.map((item) => {
                const active = selected === item.id;
                return (
                  <div
                    key={item.id}
                    data-block={item.id}
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
                      <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-ink/80 px-1 py-0.5 text-[9px] font-medium text-white">
                        {item.col + 1} 列 · {item.row + 1} 行 · {item.colSpan}×{item.rowSpan}
                      </span>
                    ) : null}
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
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
              <span className="inline-flex items-center gap-1">
                <Move className="size-3" aria-hidden />
                拖动改位置 · 方向键微调 1 格
              </span>
              <span className="inline-flex items-center gap-1">
                <Ruler className="size-3" aria-hidden />
                {contentCm.toFixed(1)} × {contentHeightCm.toFixed(1)} cm · {GRID_COLS}×{GRID_ROWS} 格
              </span>
              {plan && plan.warnings.length > 0 ? (
                <span
                  className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"
                  title={plan.warnings.join(' / ')}
                >
                  <TriangleAlert className="size-3" aria-hidden />
                  {plan.warnings[0]}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* 右：工具箱 */}
        <aside className="min-w-0 space-y-3">
          <section className="rounded-2xl border border-line/60 bg-surface p-2.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Grid3x3 className="size-4 text-ink-faint" aria-hidden />
              积木
              <span className="ml-auto text-[10.5px] font-normal tabular-nums text-ink-faint">
                {layout.items.length}/{blocks.length} 在纸上
              </span>
            </h2>
            <p className="mt-0.5 text-[10.5px] text-ink-faint">
              点一下放上去 · 或者拖到纸上挑位置
            </p>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {blocks.map((block) => (
                <BlockTile
                  key={block.id}
                  id={block.id}
                  item={layout.items.find((item) => item.id === block.id)}
                  preview={previewItem(block.id)}
                  selected={selected === block.id}
                  onPick={(id) => {
                    if (layoutRef.current.items.some((item) => item.id === id)) setSelected(id);
                    else addBlock(id);
                  }}
                  onDragStart={onTileDragStart}
                  onDragEnd={onTileDragEnd}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-line/60 bg-surface p-2.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <FolderOpen className="size-4 text-ink-faint" aria-hidden />
              方案库
              <span className="ml-auto text-[10.5px] font-normal tabular-nums text-ink-faint">
                {layouts.length} 套我存的
              </span>
            </h2>

            <div className="ps-scroll-thin mt-2 max-h-[440px] space-y-2 overflow-y-auto pr-1">
              <div>
                <p className="ps-cap mb-1">内置模板</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {LAYOUT_PRESETS.map((preset) => (
                    <PresetCard
                      key={preset.id}
                      name={preset.name}
                      items={preset.layout.items}
                      hint={preset.hint}
                      active={
                        activePreset?.id === preset.id &&
                        layoutSignature(preset.layout) === layoutSignature(layout)
                      }
                      onApply={() => applyPreset(preset.id)}
                    />
                  ))}
                </div>
              </div>

              <div>
                <p className="ps-cap mb-1">我存的</p>
                {layouts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-line/70 px-2 py-2 text-[10.5px] text-ink-faint">
                    摆好一套，下面起个名字存起来 —— 换项目、换册子都能一键套用
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5">
                    {layouts.map((row) => (
                      <PresetCard
                        key={row.id}
                        name={row.name}
                        items={row.layout.items}
                        active={layoutSignature(row.layout) === layoutSignature(layout)}
                        onApply={() => handleApplyLayout(row.id)}
                        onRemove={() => void handleRemoveLayout(row.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <Input
                value={layoutName}
                onChange={(event) => setLayoutName(event.target.value)}
                placeholder={suggestLayoutName(layout)}
                aria-label="方案名字"
                className="h-8 text-[12px]"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 shrink-0"
                onClick={() => void handleSaveLayout()}
                disabled={busyLayout || !project}
              >
                存为方案
              </Button>
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

          <section className="rounded-2xl border border-line/60 bg-surface p-2.5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Ruler className="size-4 text-ink-faint" aria-hidden />
              纸面的规矩
            </h2>
            <div className="mt-2">
              <PaperFacts
                paperLabel={paper.label}
                paperWidthCm={paper.widthCm}
                paperHeightCm={paper.heightCm}
                orientation={orientation}
                marginCm={marginCm}
                gutterCm={gutterCm}
                cols={GRID_COLS}
                rows={GRID_ROWS}
              />
            </div>
            <Link
              href={ROUTES.projects}
              className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-ink-soft underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              回项目列表
            </Link>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}

/* ------------------------------ 积木预览 ------------------------------ */

/** 版式的指纹：只比「谁、在哪、多大」，用来判断当前画布对应哪一套模板 */
function layoutSignature(value: PageLayout): string {
  return value.items
    .map((item) => `${item.id}:${item.col},${item.row},${item.colSpan},${item.rowSpan}`)
    .sort()
    .join('|');
}

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
