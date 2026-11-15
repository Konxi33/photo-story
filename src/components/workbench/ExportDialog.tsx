// src/components/workbench/ExportDialog.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { FileText, FolderOpen, Loader2, Presentation, Printer, Sparkles } from 'lucide-react';
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
import { clearImageCache, exportToDocx, exportToPdf, exportToPptx } from '@/lib/export';
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
    setIncludeScoreDetail(s.includeScoreDetail === true);
  };

  useEffect(() => {
    if (!open) return;
    applySettings(project.exportSettings);
    setProgress(null);
    setDetail(null);
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

  const buildSettings = (): ExportSettings => ({
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
    includeScoreDetail,
  });

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
    await ProjectRepository.update(project.id, { exportSettings: settings }).catch(
      () => undefined,
    );

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
            <SettingRow label="显示序号">
              <Switch aria-label="显示序号" checked={showIndex} onCheckedChange={setShowIndex} />
            </SettingRow>
            <SettingRow label="图下小字">
              <div className="flex items-center gap-2">
                <Select
                  value={captionUnderImage ? captionStyle : 'none'}
                  onValueChange={(v) => {
                    if (v === 'none') {
                      setCaptionUnderImage(false);
                      return;
                    }
                    setCaptionUnderImage(true);
                    setCaptionStyle(v as 'title' | 'param' | 'both');
                  }}
                >
                  <SelectTrigger className="w-[136px]" aria-label="图下小字写什么"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="title">编号 + 标题</SelectItem>
                    <SelectItem value="param">编号 + 参数</SelectItem>
                    <SelectItem value="both">标题 + 参数</SelectItem>
                    <SelectItem value="none">不印</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </SettingRow>
            <SettingRow label="评分卡与解读">
              <Switch aria-label="评分卡与解读" checked={includeScoreDetail} onCheckedChange={setIncludeScoreDetail} />
            </SettingRow>
            {!includeScoreDetail ? (
              <p className="pl-1 text-[11px] leading-relaxed text-ink-faint">
                关掉后每页只放一张大图、图注、正文和拍摄手法 —— 打印出来更像摄影集。
                打开会把参数表、评分卡、三块建议一起印上，图会相应变小，内容多的照片可能多占一页。
              </p>
            ) : null}

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
            </div>

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
