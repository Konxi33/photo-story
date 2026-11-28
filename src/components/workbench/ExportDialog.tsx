// src/components/workbench/ExportDialog.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
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
import {
  FileText,
  FolderOpen,
  GripVertical,
  LayoutTemplate,
  Loader2,
  ChevronDown,
  Minus,
  Plus,
  Presentation,
  Printer,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ProjectRepository } from '@/lib/db';
import { readBook } from '@/lib/book/store';
import { padForBook } from '@/lib/book/signature';
import { PAGE_STYLES } from '@/lib/export/typography';
import { StylePreview } from '@/components/workbench/style-preview';
import { clearImageCache, exportToDocx, exportToPdf, exportToPptx } from '@/lib/export';
import {
  BLOCKS,
  BLOCK_MAP,
  DEFAULT_BLOCKS,
  TEMPLATES,
  applyBlocks,
  getTemplate,
  planPhotoPage,
  resolveBlocks,
  type PhotoBlockId,
} from '@/lib/export/blocks';
import {
  BODY_FONT_OPTIONS,
  PAPER_TINY_OPTIONS,
  type BookBodyFont,
  type PaperTintId,
} from '@/lib/export/bookStyle';
import { exportContentCm, exportContentHeightCm } from '@/lib/export/metrics';
import { planLayoutPage, type PageLayout } from '@/lib/export/layout';
import Link from 'next/link';
import { ROUTES } from '@/config/app';
import { FRAME_PRESETS } from '@/lib/export/frame';
import { listPresets, removePreset, savePreset, type ExportPreset } from '@/lib/export/presets';
import {
  readExportDir,
  readRevealAfterExport,
  revealFile,
  writeExportDir,
} from '@/lib/export/output';
import { cn, formatBytes } from '@/lib/utils';
import type {
  ExportProgress,
  ExportSettings,
  FrameStyle,
  ImageQuality,
  LayoutMode,
  Photo,
  Project,
} from '@/types/domain';

type Format = 'docx' | 'pptx' | 'pdf';

const FORMATS: { id: Format; label: string; desc: string; icon: typeof FileText }[] = [
  { id: 'docx', label: 'Word', desc: '.docx 可继续编辑', icon: FileText },
  { id: 'pptx', label: 'PPT', desc: '.pptx 一页一张', icon: Presentation },
  { id: 'pdf', label: 'PDF', desc: '.pdf 适合打印', icon: Printer },
];

interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  photos: Photo[];
  selectedPhotos: Photo[];
}

export function ExportDialog({
  open,
  onOpenChange,
  project,
  photos,
  selectedPhotos,
}: ExportDialogProps) {
  const [format, setFormat] = useState<Format>('docx');

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [includeCover, setIncludeCover] = useState(true);
  const [includeOverview, setIncludeOverview] = useState(true);
  const [pageBreakPerPhoto, setPageBreakPerPhoto] = useState(true);
  const [layout, setLayout] = useState<LayoutMode>('compact');
  const [imageQuality, setImageQuality] = useState<ImageQuality>('high');
  const [overviewColumns, setOverviewColumns] = useState<'2' | '3'>('3');

  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [margins, setMargins] = useState<'narrow' | 'normal' | 'wide'>('normal');
  const [bodyColumns, setBodyColumns] = useState<'1' | '2'>('1');
  const [lineSpacing, setLineSpacing] = useState<'1.4' | '1.6' | '1.8'>('1.6');
  const [showIndex, setShowIndex] = useState(true);

  // 0.5.4 打印向：纸张 / 装订线 / 图下参数行
  const [paperSize, setPaperSize] = useState<'a4' | 'a5'>('a4');
  const [gutter, setGutter] = useState<'0' | '0.5' | '1'>('0');
  const [captionUnderImage, setCaptionUnderImage] = useState(true);
  // 0.5.5：图注写什么 —— 摄影集默认只写编号 + 标题，参数进书末技术附录
  const [captionStyle, setCaptionStyle] = useState<'title' | 'param' | 'both'>('title');
  const [includeScoreDetail, setIncludeScoreDetail] = useState(false);
  /** 0.8.1：末尾补白页，把页数凑成 4 的倍数（印刷厂按印张装订） */
  const [padSignature, setPadSignature] = useState(false);

  // 0.6.3：整本书的「字」与「纸」——字体、纸色、卷首语、后记
  const [bodyFont, setBodyFont] = useState<BookBodyFont>('song');
  const [paper, setPaper] = useState<PaperTintId>('white');
  // 0.6.4：版式预设与照片圆角
  const [pageStyleId, setPageStyleId] = useState<'album' | 'essay' | 'archive'>('album');
  const [photoRadius, setPhotoRadius] = useState<0 | 2 | 4>(0);
  /** 0.8.3：封面上要不要印导出日期（送人的册子常常不想让日期占住封面） */
  const [showDate, setShowDate] = useState(true);
  const [prefaceTitle, setPrefaceTitle] = useState('');
  const [preface, setPreface] = useState('');
  const [afterword, setAfterword] = useState('');

  // 0.5.7：这一页印哪些板块、按什么顺序 —— 用户拖出来的就是它
  const [blocks, setBlocks] = useState<PhotoBlockId[]>(DEFAULT_BLOCKS);
  const [templateId, setTemplateId] = useState('');

  // 0.6.0：排版台摆好的位置。有它就以画布为准，下面的顺序只在关掉它时才生效。
  const [studioGrid, setStudioGrid] = useState<PageLayout | null>(null);
  const [useStudio, setUseStudio] = useState(false);

  // 0.5.6：导出预设——把一整套排版选项存成「方案」，换项目也能一键套用
  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetId, setPresetId] = useState('');

  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  // 0.3.1 相框与水印
  const [frame, setFrame] = useState<FrameStyle>('none');
  const [watermark, setWatermark] = useState(false);
  const [watermarkText, setWatermarkText] = useState('Xiaomi 14 Ultra');
  const [watermarkAuthor, setWatermarkAuthor] = useState('');
  const [chapterCount, setChapterCount] = useState(0);
  // 0.5.4：PDF 版也要按编排分章，所以整份章节结构都留着（不只是数量）
  const [chapters, setChapters] = useState<
    { id: string; title: string; note: string; photoIds: string[] }[]
  >([]);

  // 0.5.4：固定的导出目录（设置页里配一次，之后导出不再问位置）
  const [outputDir, setOutputDir] = useState('');
  const [revealAfter, setRevealAfter] = useState(true);

  // 0.5.6：印前提示用的暗部统计（只看有评分、且光线分偏低的照片）
  const darkPhotos = useMemo(
    () =>
      selectedPhotos.filter((photo) => {
        const lighting = photo.analysis?.score?.breakdown?.lighting;
        return typeof lighting === 'number' && lighting > 0 && lighting < 70;
      }),
    [selectedPhotos],
  );

  // 0.6.1：印刷账 —— 一张纸两面的书，页数得取 4 的倍数才好装订成帖
  const pageEstimate = useMemo(() => {
    if (selectedPhotos.length === 0) return null;
    const picked = new Set(selectedPhotos.map((photo) => photo.id));
    const openers = chapters.filter(
      (chapter) => chapter.photoIds.filter((id) => picked.has(id)).length >= 4,
    ).length;
    const appendix = (captionStyle ?? 'title') !== 'both';
    const total =
      (includeCover ? 1 : 0) + (includeOverview ? 1 : 0) + selectedPhotos.length + openers + (appendix ? 1 : 0);
    return { total, appendix, pad4: (4 - (total % 4)) % 4 };
  }, [selectedPhotos, chapters, includeCover, includeOverview, captionStyle]);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setOutputDir(await readExportDir());
      setRevealAfter(await readRevealAfterExport());
    })();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setChapterCount(0);
    setChapters([]);
    void (async () => {
      try {
        const book = await readBook(project.id);
        setChapterCount(book?.chapters.length ?? 0);
        setChapters(book?.chapters ?? []);
      } catch {
        setChapterCount(0);
        setChapters([]);
      }
    })();
  }, [open, project.id]);

  /** 0.5.6：把一整套设置灌进表单——打开对话框时用项目存档，选预设时用预设 */
  const applySettings = (s: ExportSettings): void => {
    setIncludeCover(s.includeCover);
    setIncludeOverview(s.includeOverview);
    setPageBreakPerPhoto(s.pageBreakPerPhoto);
    setLayout(s.layout);
    setImageQuality(s.imageQuality);
    setOverviewColumns(s.overviewColumns === 2 ? '2' : '3');
    setOrientation(s.orientation ?? 'portrait');
    setMargins(s.margins ?? 'normal');
    setBodyColumns(s.bodyColumns === 2 ? '2' : '1');
    setLineSpacing(String(s.lineSpacing ?? 1.6) as '1.4' | '1.6' | '1.8');
    setShowIndex(s.showIndex ?? true);
    setFrame(s.frame ?? 'none');
    setWatermark(s.watermark ?? false);
    setWatermarkText(s.watermarkText ?? 'Xiaomi 14 Ultra');
    setWatermarkAuthor(s.watermarkAuthor ?? '');
    setPaperSize(s.paperSize ?? 'a4');
    setGutter(String(s.gutter ?? 0) as '0' | '0.5' | '1');
    setCaptionUnderImage(s.captionUnderImage !== false);
    setCaptionStyle(s.captionStyle ?? 'title');
    setBodyFont((s.bodyFont as BookBodyFont) ?? 'song');
    setPaper((s.paper as PaperTintId) ?? 'white');
    setPageStyleId((s.pageStyle as 'album' | 'essay' | 'archive') ?? 'album');
    setPhotoRadius(((s.photoRadius ?? 0) as 0 | 2 | 4));
    setShowDate(s.showDate !== false);
    setPrefaceTitle(s.prefaceTitle ?? '');
    setPreface(s.preface ?? '');
    setAfterword(s.afterword ?? '');
    setIncludeScoreDetail(s.includeScoreDetail === true);
    setPadSignature(s.padSignature === true);
    setBlocks(resolveBlocks(s));
    setTemplateId(s.templateId ?? '');
    const grid = s.grid && Array.isArray(s.grid.items) && s.grid.items.length > 0 ? s.grid : null;
    setStudioGrid(grid);
    setUseStudio(grid ? s.useCanvas === true : false);
  };

  useEffect(() => {
    if (!open) return;
    applySettings(project.exportSettings);
    setProgress(null);
    setDetail(null);
    // 记住上次选的格式：常印稿子的人每次都要重新点一下 PDF 很烦
    try {
      const saved = window.localStorage.getItem('ps:export-format');
      if (saved === 'docx' || saved === 'pdf' || saved === 'pptx') setFormat(saved);
    } catch {
      /* 隐私模式下 localStorage 可能不可用，忽略 */
    }
  }, [open, project.exportSettings]);

  useEffect(() => {
    if (!open) return;
    setPresetId('');
    void (async () => setPresets(await listPresets()))();
  }, [open]);

  /** 预设的默认名字：一眼能认出这套方案是什么 */
  const suggestPresetName = (): string => {
    const paper = paperSize.toUpperCase();
    const cols = bodyColumns === '2' ? '双栏' : '单栏';
    const cap = captionUnderImage ? '带图注' : '无图注';
    return `${paper} ${cols} · ${cap}`;
  };

  const handleSavePreset = async (): Promise<void> => {
    try {
      const next = await savePreset(suggestPresetName(), buildSettings());
      setPresets(next);
      setPresetId(next[0]?.id ?? '');
      toast.success('已存为预设', { description: next[0]?.name });
    } catch (error) {
      toast.error('保存预设失败', { description: (error as Error).message });
    }
  };

  const handlePickPreset = (id: string): void => {
    setPresetId(id);
    const preset = presets.find((row) => row.id === id);
    if (preset) applySettings(preset.settings);
  };

  const handleRemovePreset = async (): Promise<void> => {
    if (!presetId) return;
    const next = await removePreset(presetId);
    setPresets(next);
    setPresetId('');
    toast.success('预设已删除');
  };

  const disabled = selectedPhotos.length === 0 || exporting;

  const buildSettings = (): ExportSettings =>
    applyBlocks(
      {
        ...project.exportSettings,
        includeCover,
        includeOverview,
        pageBreakPerPhoto,
        layout,
        imageQuality,
        overviewColumns: overviewColumns === '2' ? 2 : 3,
        orientation,
        margins,
        bodyColumns: bodyColumns === '2' ? 2 : 1,
        lineSpacing: Number(lineSpacing) as 1.4 | 1.6 | 1.8,
        showIndex,
        frame,
        watermark,
        watermarkText,
        watermarkAuthor,
        paperSize,
        gutter: Number(gutter) as 0 | 0.5 | 1,
        captionUnderImage,
        captionStyle,
        includeScoreDetail,
        padSignature,
        blocks,
        templateId,
        // grid 始终留着（排版台的位置不能因为这次关掉开关就丢），
        // 用 useCanvas 记录「这次按不按画布印」。
        grid: studioGrid ?? undefined,
        useGrid: useStudio,
        useCanvas: useStudio,
        pageStyle: pageStyleId,
        photoRadius,
        // 0.8.5：纸面底色一直漏写 —— 用户选米白，buildSettings 却没带上 paper，
        // 落盘的永远是项目默认的纯白，所以「选米白导出还是白纸」。
        paper,
        showDate,
      },
      blocks,
    );

  /** 套用固定模板：把板块顺序与相关开关一起灌进去 */
  const handlePickTemplate = (id: string): void => {
    const template = getTemplate(id);
    if (!template) return;
    const next: ExportSettings = {
      ...buildSettings(),
      ...template.patch,
      blocks: template.blocks,
      templateId: id,
    };
    applySettings(next);
    setBlocks(template.blocks);
    setTemplateId(id);
    // 模板给的是「竖着排」的一套顺序，跟画布上的自由摆位冲突，所以套模板就关掉画布
    if (useStudio) {
      setUseStudio(false);
      toast.info('已按模板重排', { description: '想保留排版台的位置，把它上面的开关再打开。' });
    }
    toast.success(`已套用「${template.name}」`, { description: template.hint });
  };

  const toggleBlock = (id: PhotoBlockId): void => {
    setTemplateId('');
    setUseStudio(false);
    setBlocks((prev) => {
      if (prev.includes(id)) {
        if (prev.length <= 1) {
          toast.error('至少留一个板块');
          return prev;
        }
        return prev.filter((item) => item !== id);
      }
      // 新增的板块按 BLOCKS 的推荐顺序插入，避免用户手动拖到底部
      const recommended = BLOCKS.findIndex((meta) => meta.id === id);
      const out = [...prev];
      const insertAt = out.findIndex((item) => BLOCKS.findIndex((meta) => meta.id === item) > recommended);
      out.splice(insertAt < 0 ? out.length : insertAt, 0, id);
      return out;
    });
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = blocks.indexOf(active.id as PhotoBlockId);
    const to = blocks.indexOf(over.id as PhotoBlockId);
    if (from < 0 || to < 0) return;
    setTemplateId('');
    if (useStudio) {
      setUseStudio(false);
      toast.info('改成按这个顺序排', { description: '想回到画布的位置，把上面的开关再打开。' });
    }
    setBlocks(arrayMove(blocks, from, to));
  };

  const pickOutputDir = async (): Promise<void> => {
    const api = typeof window !== 'undefined' ? window.photoStory : undefined;
    if (!api?.chooseDirectory) {
      toast.error('只有在桌面版里才能选文件夹');
      return;
    }
    const result = await api.chooseDirectory(outputDir);
    if (!result?.ok || !result.path) return;
    setOutputDir(result.path);
    await writeExportDir(result.path).catch(() => undefined);
    toast.success('导出位置已固定', { description: result.path });
  };

  const clearOutputDir = async (): Promise<void> => {
    setOutputDir('');
    await writeExportDir('').catch(() => undefined);
    toast.success('已改为每次导出时询问位置');
  };

  const handleExport = async (): Promise<void> => {
    if (disabled) return;
    setExporting(true);
    setProgress(null);
    setDetail(null);

    const settings = buildSettings();
    try {
      window.localStorage.setItem('ps:export-format', format);
    } catch {
      /* 忽略：存不下不影响这次导出 */
    }
    // 保存到项目时永远保留排版台画布（哪怕这次临时关掉了），
    // 否则「关掉开关导一次」会把在排版台摆好的位置永久清掉。
    await ProjectRepository.update(project.id, {
      exportSettings: { ...settings, grid: studioGrid ?? settings.grid },
    }).catch(() => undefined);

    try {
      if (format === 'docx') {
        const result = await exportToDocx({
          project,
          photos: selectedPhotos,
          settings,
          onProgress: setProgress,
          outputDir,
        });
        if (!result.ok) {
          toast.error('导出失败', { description: result.error?.message ?? '未知错误' });
          return;
        }
        if (result.filePath) setDetail(result.filePath);
        toast.success('已导出 ' + formatBytes(result.bytes ?? 0), {
          description: result.downgraded
            ? '为控制体积已自动降低画质'
            : (result.filePath ?? result.fileName ?? ''),
        });
        if (revealAfter && result.filePath) void revealFile(result.filePath);
      } else if (format === 'pptx') {
        const result = await exportToPptx({
          project,
          photos: selectedPhotos,
          settings,
          imageEdge: imageQuality === 'ultra' ? 2200 : imageQuality === 'high' ? 1600 : 1100,
          outputDir,
          onProgress: (done, total) =>
            setProgress({
              stage: 'rendering',
              current: done,
              total,
              message: '正在生成第 ' + done + '/' + total + ' 页…',
            }),
        });
        toast.success('已导出 PPT', { description: result.filePath ?? formatBytes(result.bytes) });
        if (revealAfter && result.filePath) void revealFile(result.filePath);
      } else {
        const result = await exportToPdf({
          project,
          photos: selectedPhotos,
          settings,
          chapters,
          outputDir,
          onProgress: (done, total) =>
            setProgress({
              stage: 'encoding',
              current: done,
              total,
              message: '正在准备第 ' + done + '/' + total + ' 张…',
            }),
        });
        if (!result.ok) {
          if (result.canceled) return;
          toast.error('导出 PDF 失败', { description: result.error ?? '未知错误' });
          return;
        }
        setDetail(result.filePath ?? '已生成 PDF');
        toast.success(result.fallback ? '已打开打印窗口' : 'PDF 已保存', {
          description: result.fallback ? '在打印对话框里选择「另存为 PDF」' : result.filePath,
        });
        if (revealAfter && result.filePath) void revealFile(result.filePath);
      }

      onOpenChange(false);
    } catch (error) {
      toast.error('导出失败', { description: (error as Error).message });
    } finally {
      setExporting(false);
      clearImageCache();
    }
  };

  const isWordLike = format !== 'pptx';

  /** 用一张真实照片试算：图上还能剩多高、会不会被迫让位 */
  const pageFit = useMemo(() => {
    if (!isWordLike || selectedPhotos.length === 0) return null;
    const sample = selectedPhotos.find((photo) => photo.status === 'success') ?? selectedPhotos[0];
    const settings: ExportSettings = applyBlocks(
      {
        ...project.exportSettings,
        layout,
        orientation,
        margins,
        showIndex,
        paperSize,
        gutter: Number(gutter) as 0 | 0.5 | 1,
        captionUnderImage,
        captionStyle,
        includeScoreDetail,
        blocks,
      },
      blocks,
    );
    const contentCm = exportContentCm(settings);
    const contentHeightCm = exportContentHeightCm(settings);
    // 有画布时试算也要按画布算，否则提示的「图片最高约 Xcm」跟印出来不一致
    if (useStudio && studioGrid) {
      const plan = planLayoutPage({ photo: sample, index: 0, settings, contentCm, contentHeightCm });
      const imageItem = plan.items.find((item) => item.item.id === 'image');
      return {
        mode: 'grid' as const,
        dropped: [] as PhotoBlockId[],
        imageRoomCm: imageItem ? imageItem.heightCm : 0,
        fillRatio: 1,
        warnings: plan.warnings,
        contentHeightCm,
      };
    }
    const fit = planPhotoPage({
      photo: sample,
      settings,
      contentCm,
      contentHeightCm,
    });
    return {
      mode: 'flow' as const,
      dropped: fit.dropped,
      imageRoomCm: fit.imageRoomCm,
      fillRatio: fit.fillRatio,
      warnings: [] as string[],
      contentHeightCm,
    };
  }, [
    isWordLike,
    selectedPhotos,
    project.exportSettings,
    layout,
    orientation,
    margins,
    showIndex,
    paperSize,
    gutter,
    captionUnderImage,
    captionStyle,
    includeScoreDetail,
    blocks,
    useStudio,
    studioGrid,
  ]);

  const unusedBlocks = BLOCKS.filter((meta) => !blocks.includes(meta.id));

  // 提示「会补几页」：和导出时用的是同一个函数，不会两处算得不一样
  const padPagesForExport = useMemo(
    () =>
      padForBook(
        chapters.map((chapter) => ({
          title: chapter.title,
          note: chapter.note,
          photoIds: chapter.photoIds,
        })),
        {
          flatPhotoCount: selectedPhotos.length,
          hasCover: includeCover,
          hasOverview: includeOverview,
          hasAppendix: true,
        },
      ),
    [chapters, selectedPhotos.length, includeCover, includeOverview],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导出</DialogTitle>
          <DialogDescription>选择格式与排版，导出后自动下载或保存到本机</DialogDescription>
        </DialogHeader>

        {/* 格式：同一套分段控件，选中即切换下方选项，带药丸滑动 */}
        <Segmented
          block
          ariaLabel="导出格式"
          value={format}
          onChange={(next) => setFormat(next as Format)}
          options={FORMATS.map((f) => {
            const Icon = f.icon;
            return {
              value: f.id,
              label: (
                <span className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {f.label}
                </span>
              ),
              title: f.desc,
            };
          })}
        />

        <p className="-mt-1 text-[11px] text-ink-faint">
          {FORMATS.find((f) => f.id === format)?.desc}
        </p>

        {/* 0.5.6：预设——常用的排版组合存下来，下次一步到位 */}
        {isWordLike && (
          <div className="flex items-center gap-2 rounded-xl border border-line/60 bg-surface-2/50 px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-ink-faint" />
            <Select value={presetId} onValueChange={handlePickPreset}>
              <SelectTrigger className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 text-[12.5px] shadow-none">
                <SelectValue placeholder={presets.length > 0 ? '套用已保存的方案' : '还没有保存的方案'} />
              </SelectTrigger>
              <SelectContent>
                {presets.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[12px]"
              onClick={() => void handleSavePreset()}
            >
              存为方案
            </Button>
            {presetId && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 shrink-0 px-2 text-[12px] text-ink-faint"
                onClick={() => void handleRemovePreset()}
              >
                删除
              </Button>
            )}
          </div>
        )}

        {/* 0.5.4：输出位置 —— 设一次就不再每次问 */}
        <div className="flex items-center gap-3 rounded-xl border border-line/60 bg-surface-2/50 px-3 py-2.5">
          <FolderOpen className="h-4 w-4 shrink-0 text-ink-faint" />
          <div className="min-w-0 flex-1">
            <p className="text-[12.5px] font-medium">
              {outputDir ? '保存到固定文件夹' : '每次导出时询问位置'}
            </p>
            <p
              className="truncate text-[11px] text-ink-faint"
              title={outputDir || undefined}
            >
              {outputDir || '在设置里可以固定一个导出位置，之后一键导出'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {outputDir ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[12px]"
                onClick={() => void revealFile(outputDir)}
              >
                打开
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[12px]"
              onClick={() => void pickOutputDir()}
            >
              {outputDir ? '更改' : '选择'}
            </Button>
            {outputDir ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[12px] text-ink-faint"
                onClick={() => void clearOutputDir()}
              >
                取消固定
              </Button>
            ) : null}
          </div>
        </div>

        {isWordLike && (
          <div className="ps-enter grid gap-2.5">
            <SettingRow label="封面页">
              <Switch aria-label="封面页" checked={includeCover} onCheckedChange={setIncludeCover} />
            </SettingRow>
            <SettingRow label="总览页">
              <Switch aria-label="总览页" checked={includeOverview} onCheckedChange={setIncludeOverview} />
            </SettingRow>
            <SettingRow label="每张另起一页">
              <Switch aria-label="每张另起一页" checked={pageBreakPerPhoto} onCheckedChange={setPageBreakPerPhoto} />
            </SettingRow>
            {/* 0.8.1：印刷厂一张纸正反四面，页数凑成 4 的倍数装订出来才不空帖 */}
            <SettingRow label="末尾补白页">
              <Switch
                aria-label="末尾补白页凑成印张"
                checked={padSignature}
                onCheckedChange={setPadSignature}
              />
            </SettingRow>
            {padSignature ? (
              <p className="-mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                会补 {padPagesForExport} 页空白，把整本凑成 4 的倍数。自己打印、不装订的话可以关掉。
              </p>
            ) : null}

            {/* 页面拼装：拖出来的顺序就是印出来的顺序 */}
            <div className="rounded-[12px] border border-line/60 bg-surface/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                  <LayoutTemplate className="h-3.5 w-3.5 text-ink-faint" />
                  一页印什么
                </span>
                <span className="text-[10.5px] text-ink-faint">
                  {useStudio && studioGrid ? '位置来自排版台' : '拖动左侧手柄调顺序'}
                </span>
              </div>

              {studioGrid ? (
                <div
                  className={cn(
                    'mt-2 rounded-lg border px-2.5 py-2',
                    useStudio
                      ? 'border-amber-500/35 bg-amber-500/[0.07]'
                      : 'border-line/60 bg-surface-2/40',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[10.5px] leading-relaxed text-ink-soft">
                      {useStudio
                        ? '现在按「排版台」画布上的位置印：每块在哪、多大，都以画布为准，下面的顺序不生效。'
                        : '这个项目已经在排版台摆过位置，但现在按下面这个顺序竖着排。'}
                    </p>
                    <Switch
                      aria-label="按排版台的位置印"
                      checked={useStudio}
                      onCheckedChange={setUseStudio}
                    />
                  </div>
                  <Link
                    href={ROUTES.studio}
                    onClick={() => onOpenChange(false)}
                    className="mt-1 inline-block text-[10.5px] text-ink-faint underline decoration-line underline-offset-2 hover:text-ink"
                  >
                    去排版台改位置
                  </Link>
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1.5">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    title={template.hint}
                    onClick={() => handlePickTemplate(template.id)}
                    className={cn(
                      'rounded-full border px-2.5 py-[5px] text-[11px] leading-none transition-colors duration-150',
                      templateId === template.id
                        ? 'border-ink/70 bg-ink text-surface'
                        : 'border-line/70 text-ink-soft hover:border-ink/25 hover:text-ink',
                    )}
                  >
                    {template.name}
                  </button>
                ))}
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={blocks} strategy={verticalListSortingStrategy}>
                  <ul className="mt-2.5 grid gap-1">
                    {blocks.map((id, index) => (
                      <BlockRow
                        key={id}
                        id={id}
                        index={index}
                        dropped={pageFit?.dropped.includes(id) ?? false}
                        onRemove={() => toggleBlock(id)}
                        canRemove={blocks.length > 1}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>

              {unusedBlocks.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line/40 pt-2">
                  <span className="text-[10.5px] text-ink-faint">加一块：</span>
                  {unusedBlocks.map((meta) => (
                    <button
                      key={meta.id}
                      type="button"
                      title={meta.hint}
                      onClick={() => toggleBlock(meta.id)}
                      className="flex items-center gap-0.5 rounded-full border border-line/60 px-2 py-[3px] text-[10.5px] text-ink-soft transition-colors duration-150 hover:border-ink/25 hover:text-ink"
                    >
                      <Plus className="h-2.5 w-2.5" />
                      {meta.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {pageFit ? (
                <p
                  className={cn(
                    'mt-2 text-[10.5px] leading-relaxed',
                    pageFit.dropped.length > 0 || pageFit.warnings.length > 0
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-ink-faint',
                  )}
                >
                  {pageFit.mode === 'grid'
                    ? pageFit.warnings.length > 0
                      ? `按画布排：${pageFit.warnings[0]}${pageFit.warnings.length > 1 ? ` 等 ${pageFit.warnings.length} 处` : ''}`
                      : `按画布排：图片格约 ${pageFit.imageRoomCm.toFixed(1)}cm 高，每张照片占满一页，位置与你摆的一致。`
                    : pageFit.dropped.length > 0
                      ? `按这个顺序排，最近那张照片的「${pageFit.dropped
                          .map((id) => BLOCK_MAP[id]?.label ?? id)
                          .join('、')}」放不下，导出时会自动省掉 —— 想全留着就少勾几块。`
                      : `试算：图片最高约 ${pageFit.imageRoomCm.toFixed(1)}cm，整页填充 ${Math.round(
                          pageFit.fillRatio * 100,
                        )}%。一张照片连同文字只占一页，不会被拆到两页。`}
                </p>
              ) : null}

              {/* 想要像素级自由摆放的，去排版台 */}
              <div className="mt-2 border-t border-line/40 pt-2">
                <Link
                  href={ROUTES.studio}
                  onClick={() => onOpenChange(false)}
                  className="flex items-center gap-1 text-[10.5px] text-ink-soft underline decoration-dotted underline-offset-4 transition-colors hover:text-ink"
                >
                  <LayoutTemplate className="h-3 w-3" />
                  想要自己摆位置？去「排版台」把积木拖到纸上
                </Link>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
              <SettingRow label="纸张">
                <Select value={paperSize} onValueChange={(v) => setPaperSize(v === 'a5' ? 'a5' : 'a4')}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4">A4</SelectItem>
                    <SelectItem value="a5">A5</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow label="装订线">
                <Select value={gutter} onValueChange={(v) => setGutter(v as '0' | '0.5' | '1')}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">不预留</SelectItem>
                    <SelectItem value="0.5">0.5cm</SelectItem>
                    <SelectItem value="1">1cm</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              {/* 0.6.3：字与纸 —— 画册像不像一本书，八成看这两项 */}
              <SettingRow label="正文字体">
                <Select value={bodyFont} onValueChange={(v) => setBodyFont(v as BookBodyFont)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BODY_FONT_OPTIONS.map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <p className="-mt-1 mb-1 text-[11px] leading-relaxed text-ink-faint">
                {BODY_FONT_OPTIONS.find((f) => f.id === bodyFont)?.hint}
              </p>

              <SettingRow label="纸面底色">
                <Select value={paper} onValueChange={(v) => setPaper(v as PaperTintId)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PAPER_TINY_OPTIONS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </SettingRow>
              <p className="-mt-1 mb-1 text-[11px] leading-relaxed text-ink-faint">
                {PAPER_TINY_OPTIONS.find((p) => p.id === paper)?.hint}
              </p>

              {/* 0.6.4：版式预设 —— 换的是「这一页怎么组织」，不是换个皮肤 */}
              <div className="col-span-2 grid gap-1.5">
                <span className="text-[13px] font-medium text-ink">版式</span>
                {/* 0.7.1：三选改成三张纸面缩略图，一眼看出「图多大、字在哪」 */}
                <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="版式">
                  {PAGE_STYLES.map((s) => (
                    <StylePreview
                      key={s.id}
                      id={s.id}
                      label={s.label}
                      active={pageStyleId === s.id}
                      onPick={() => setPageStyleId(s.id)}
                    />
                  ))}
                </div>
                <p className="text-[11px] leading-relaxed text-ink-faint">
                  {PAGE_STYLES.find((s) => s.id === pageStyleId)?.hint}
                </p>
              </div>

              <SettingRow label="照片圆角">
                <Select
                  value={String(photoRadius)}
                  onValueChange={(v) => setPhotoRadius(Number(v) as 0 | 2 | 4)}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">直角</SelectItem>
                    <SelectItem value="2">2mm</SelectItem>
                    <SelectItem value="4">4mm</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
              <p className="-mt-1 mb-1 text-[11px] leading-relaxed text-ink-faint">
                摄影画册惯例是直角；生活类册子可以给一点圆角
              </p>

              {/* 0.8.3：封面日期可选 —— 送人的册子不想让「导出日期」印在封面上 */}
              <SettingRow label="封面印日期">
                <Switch
                  checked={showDate}
                  onCheckedChange={setShowDate}
                  aria-label="封面上印导出日期"
                />
              </SettingRow>
              <p className="-mt-1 mb-1 text-[11px] leading-relaxed text-ink-faint">
                关掉后封面只留书名与张数
              </p>

              <div className="mt-2 grid gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-ink">卷首语</span>
                  <Input
                    value={prefaceTitle}
                    onChange={(e) => setPrefaceTitle(e.target.value)}
                    placeholder="标题（默认「写在前面」）"
                    className="h-8 flex-1"
                    aria-label="卷首语标题"
                  />
                </div>
                <Textarea
                  value={preface}
                  onChange={(e) => setPreface(e.target.value)}
                  placeholder="写一段“为什么拍这些照片”，导出时会单独占一页放在图版之前。留空就不印。"
                  className="min-h-[76px] text-[13px]"
                  aria-label="卷首语正文"
                />
                <Textarea
                  value={afterword}
                  onChange={(e) => setAfterword(e.target.value)}
                  placeholder="后记（可留空）。导出时排在最后一套图版之后。"
                  className="min-h-[56px] text-[13px]"
                  aria-label="后记"
                />
              </div>
              <SettingRow label="排版密度">
                <Select value={layout} onValueChange={(v) => setLayout(v as LayoutMode)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="compact">紧凑</SelectItem>
                    <SelectItem value="loose">舒展</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow label="图片质量">
                <Select value={imageQuality} onValueChange={(v) => setImageQuality(v as ImageQuality)}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">标准</SelectItem>
                    <SelectItem value="high">高清</SelectItem>
                    <SelectItem value="ultra">超清</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="flex items-center gap-1.5 self-start rounded-lg px-1 py-1 text-[11.5px] text-ink-faint transition-colors hover:text-ink"
                aria-expanded={showAdvanced}
              >
                <ChevronDown
                  className={cn('h-3.5 w-3.5 transition-transform duration-200', showAdvanced && 'rotate-180')}
                  strokeWidth={1.8}
                />
                {showAdvanced ? '收起更多选项' : '更多选项（纸张方向、页边距、分栏、行距）'}
              </button>

              {showAdvanced && (
                <>
              <SettingRow label="纸张方向">
                <Select
                  value={orientation}
                  onValueChange={(v) => setOrientation(v as 'portrait' | 'landscape')}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portrait">纵向</SelectItem>
                    <SelectItem value="landscape">横向</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow label="页边距">
                <Select
                  value={margins}
                  onValueChange={(v) => setMargins(v as 'narrow' | 'normal' | 'wide')}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narrow">窄</SelectItem>
                    <SelectItem value="normal">标准</SelectItem>
                    <SelectItem value="wide">宽</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow label="正文分栏">
                <Select value={bodyColumns} onValueChange={(v) => setBodyColumns(v === '2' ? '2' : '1')}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">单栏</SelectItem>
                    <SelectItem value="2">双栏</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>

              <SettingRow label="正文行距">
                <Select
                  value={lineSpacing}
                  onValueChange={(v) => setLineSpacing(v as '1.4' | '1.6' | '1.8')}
                >
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1.4">1.4</SelectItem>
                    <SelectItem value="1.6">1.6</SelectItem>
                    <SelectItem value="1.8">1.8</SelectItem>
                  </SelectContent>
                </Select>
              </SettingRow>
                </>
              )}
            </div>

            {showAdvanced && (
            <SettingRow label="总览列数">
              <Select
                value={overviewColumns}
                onValueChange={(v) => setOverviewColumns(v === '2' ? '2' : '3')}
              >
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 列</SelectItem>
                  <SelectItem value="3">3 列</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            )}
          </div>
        )}

        {format === 'pptx' && (
          <div className="grid gap-2.5">
            <SettingRow label="图片质量">
              <Select value={imageQuality} onValueChange={(v) => setImageQuality(v as ImageQuality)}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">标准</SelectItem>
                  <SelectItem value="high">高清</SelectItem>
                  <SelectItem value="ultra">超清</SelectItem>
                </SelectContent>
              </Select>
            </SettingRow>
            <p className="text-[11px] text-ink-faint">
              PPT 为 16:9，一张照片一页：左侧大图，右侧标题、故事与拍摄手法。
            </p>
          </div>
        )}

        {/* 相框与水印 */}
        <div className="grid gap-2.5 rounded-xl border border-line/60 bg-surface-2/40 p-3">
          <p className="ps-eyebrow">相框与水印</p>
          <div className="grid grid-cols-4 gap-1.5">
            {FRAME_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setFrame(preset.id)}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-left transition-[background-color,border-color,transform] duration-200 ease-[var(--ease-out)] active:scale-[0.97]',
                  frame === preset.id
                    ? 'border-ink/25 bg-surface shadow-[var(--elev-1)]'
                    : 'border-line/70 hover:border-ink/15 hover:bg-surface/70',
                )}
              >
                <span className="block text-[11px] font-medium text-ink">{preset.label}</span>
                <span className="mt-0.5 block text-[9px] leading-tight text-ink-faint">
                  {preset.note}
                </span>
              </button>
            ))}
          </div>

          <SettingRow label="加水印文字">
            <Switch aria-label="加水印文字" checked={watermark} onCheckedChange={setWatermark} />
          </SettingRow>

          {(watermark || frame === 'leica' || frame === 'film') && (
            <div className="ps-fade-in grid grid-cols-2 gap-2">
              <Input
                value={watermarkText}
                onChange={(e) => setWatermarkText(e.target.value)}
                placeholder="机型，如 Xiaomi 14 Ultra"
                className="h-8 text-[12px]"
              />
              <Input
                value={watermarkAuthor}
                onChange={(e) => setWatermarkAuthor(e.target.value)}
                placeholder="署名（可选）"
                className="h-8 text-[12px]"
              />
            </div>
          )}
          <p className="text-[10.5px] leading-relaxed text-ink-faint">
            水印会带上焦段、光圈、快门、ISO 与调色风格；相框会直接画进照片，三种格式都生效。
          </p>
        </div>

        {exporting && (
          <div className="grid gap-1.5">
            <Progress
              value={
                progress && progress.total > 0
                  ? Math.round((progress.current / progress.total) * 100)
                  : 0
              }
              className="h-1.5"
            />
            <p className="text-[11.5px] text-ink-faint">
              {(progress?.message ?? '准备中…') + (detail ? ' · ' + detail : '')}
            </p>
          </div>
        )}

        <p
          className={cn(
            'text-[11.5px]',
            selectedPhotos.length === 0 ? 'text-destructive' : 'text-ink-faint',
          )}
        >
          {selectedPhotos.length === 0
            ? '没有勾选任何照片'
            : '将导出 ' + selectedPhotos.length + ' 张照片（共 ' + photos.length + ' 张）'}
        </p>

        {chapterCount > 0 && (
          <p className="text-[11.5px] text-ink-faint">
            会按「编排」里的 {chapterCount} 个章节顺序排版，并插入章节扉页。
          </p>
        )}

        {/* 0.6.1：印刷账 —— 一张纸两面的书，页数得取 4 的倍数才好装订成帖 */}
        {pageEstimate && isWordLike && (
          <p className="text-[11.5px] text-ink-faint">
            预计 {pageEstimate.total} 页
            {pageEstimate.appendix ? '（含封面、总览、章扉与技术附录）' : '（含封面与总览）'}
            {pageEstimate.pad4 > 0
              ? ` · 按装订成帖要取 4 的倍数，还差 ${pageEstimate.pad4} 页`
              : ' · 页数正好是 4 的倍数，可以直接装订'}
            。
          </p>
        )}

        {/* 0.5.6：印前提醒——纸上比屏幕更暗，暗部多的照片先提亮 */}
        {darkPhotos.length > 0 && (
          <p className="rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2 text-[11.5px] leading-relaxed text-ink-soft">
            有 {darkPhotos.length} 张照片偏暗（光线分低于 70）。纸面比屏幕更吃暗——
            印前把暗部整体提亮 2~3%、黑色别压到纯黑，印出来才不会糊成一片。
          </p>
        )}

        <DialogFooter className="border-t border-line/60 pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={exporting}>
            取消
          </Button>
          <Button className="rounded-full px-4" onClick={() => void handleExport()} disabled={disabled}>
            {exporting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                导出中…
              </>
            ) : (
              '开始导出'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label className="text-[13px] font-normal text-ink-mid">{label}</Label>
      {children}
    </div>
  );
}

function BlockRow({
  id,
  index,
  dropped,
  canRemove,
  onRemove,
}: {
  id: PhotoBlockId;
  index: number;
  dropped: boolean;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const meta = BLOCK_MAP[id];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 20 : undefined }}
      className={cn(
        'group/block flex items-center gap-1.5 rounded-[8px] border px-1.5 py-[5px] transition-colors duration-150',
        dropped ? 'border-amber-500/40 bg-amber-500/5' : 'border-line/45 bg-surface/60',
        isDragging && 'border-ink/40 shadow-[var(--elev-2)]',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`拖动「${meta?.label ?? id}」调整顺序`}
        className="cursor-grab touch-none text-ink-faint/50 transition-colors hover:text-ink active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <span className="w-4 text-center font-mono text-[10px] text-ink-faint/70">{index + 1}</span>
      <span className="text-[12px] text-ink">{meta?.label ?? id}</span>
      <span className="min-w-0 flex-1 truncate text-[10px] text-ink-faint">{dropped ? '装不下会省掉' : meta?.hint}</span>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label={`不印「${meta?.label ?? id}」`}
        className="shrink-0 rounded p-0.5 text-ink-faint/60 transition-colors hover:text-ink disabled:opacity-30"
      >
        <Minus className="h-3 w-3" />
      </button>
    </li>
  );
}
