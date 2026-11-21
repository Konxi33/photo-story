// src/app/score/page.tsx
// 独立评分页：跨项目汇总所有照片的分数，支持筛选、排序、单张重评与批量补评分。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Gauge, ImageOff, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { ScoreRadar } from '@/components/score/ScoreRadar';
import { PhotoStoryPreview } from '@/components/workbench/PhotoStoryPreview';
import { Button } from '@/components/ui/button';
import { FadeImg } from '@/components/ui/fade-img';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { scorePhoto } from '@/lib/score/dispatch';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary, ScoreBreakdown } from '@/types/domain';

type Filter = 'all' | 'scored' | 'unscored';
type SortKey = 'score-desc' | 'score-asc' | 'recent';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'scored', label: '已评分' },
  { id: 'unscored', label: '未评分' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'score-desc', label: '分数高→低' },
  { id: 'score-asc', label: '分数低→高' },
  { id: 'recent', label: '最近生成' },
];

const DIMS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '调色' },
  { key: 'subject', label: '主体' },
  { key: 'timing', label: '时机' },
  { key: 'technique', label: '技术' },
];

interface Item {
  photo: Photo;
  projectId: string;
  projectName: string;
}

export default function ScorePage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<SortKey>('score-desc');
  const [keyword, setKeyword] = useState('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const urlsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const projects: ProjectSummary[] = await withTimeout(ProjectRepository.list(), 5000, []);
        const all: Item[] = [];
        for (const p of projects) {
          const photos = await withTimeout(PhotoRepository.listByProject(p.id), 4000, []);
          for (const photo of photos) {
            if (photo.status === 'processing') continue;
            all.push({ photo, projectId: p.id, projectName: p.name });
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

  /** 0.4.2：项目筛选器作用范围——概览、直方图、列表统一跟着走，数字才对得上 */
  const scoped = useMemo(() => {
    const all = items ?? [];
    if (projectFilter === 'all') return all;
    return all.filter((item) => item.projectId === projectFilter);
  }, [items, projectFilter]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const item of items ?? []) {
      const hit = map.get(item.projectId);
      if (hit) hit.count += 1;
      else map.set(item.projectId, { id: item.projectId, name: item.projectName, count: 1 });
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [items]);

  const scored = useMemo(
    () => scoped.filter((item) => typeof item.photo.analysis?.score?.overall === 'number'),
    [scoped],
  );

  const average = useMemo(() => {
    if (scored.length === 0) return 0;
    const sum = scored.reduce((acc, item) => acc + (item.photo.analysis?.score?.overall ?? 0), 0);
    return Math.round((sum / scored.length) * 10) / 10;
  }, [scored]);

  const highest = useMemo(() => {
    if (scored.length === 0) return 0;
    return Math.max(...scored.map((item) => item.photo.analysis?.score?.overall ?? 0));
  }, [scored]);

  /**
   * 0.5.5：名次与分位。
   * 单看一个 82.4 没概念，加上「这本册子里第 3 / 20，前 15%」才知道它够不够用。
   * 只在同一筛选范围（同项目）内比较，跨项目比没有意义。
   */
  const rankOf = useMemo(() => {
    const sorted = [...scored].sort(
      (a, b) => (b.photo.analysis?.score?.overall ?? 0) - (a.photo.analysis?.score?.overall ?? 0),
    );
    const map = new Map<string, { rank: number; total: number; pct: number }>();
    sorted.forEach((item, i) => {
      map.set(item.photo.id, {
        rank: i + 1,
        total: sorted.length,
        pct: Math.max(1, Math.round(((i + 1) / sorted.length) * 100)),
      });
    });
    return map;
  }, [scored]);

  /** 0.4.2：按 10 分一档统计，看清水平集中在哪一段 */
  const distribution = useMemo(() => {
    const bins = [
      { label: '<60', min: 0, max: 60 },
      { label: '60', min: 60, max: 70 },
      { label: '70', min: 70, max: 80 },
      { label: '80', min: 80, max: 90 },
      { label: '90+', min: 90, max: 101 },
    ].map((bin) => ({ ...bin, count: 0 }));

    for (const item of scored) {
      const value = item.photo.analysis?.score?.overall ?? 0;
      const bin = bins.find((b) => value >= b.min && value < b.max) ?? bins[0];
      bin.count += 1;
    }

    return bins;
  }, [scored]);

  /** 0.5.0：整组各维度平均分，用来画雷达图 */
  const avgBreakdown = useMemo(() => {
    const totals = new Map<keyof ScoreBreakdown, number>();
    let n = 0;
    for (const item of scored) {
      const breakdown = item.photo.analysis?.score?.breakdown;
      if (!breakdown) continue;
      n += 1;
      for (const dim of DIMS) {
        totals.set(dim.key, (totals.get(dim.key) ?? 0) + (breakdown[dim.key] ?? 0));
      }
    }
    return DIMS.map((dim) => ({
      label: dim.label,
      value: n > 0 ? (totals.get(dim.key) ?? 0) / n : 0,
    }));
  }, [scored]);

  /** 0.5.0：导出评分表，方便放到 Excel 里排序、给老师或编辑看 */
  const handleExportCsv = useCallback((): void => {
    if (scored.length === 0) {
      toast.error('还没有可导出的评分');
      return;
    }
    const head = ['项目', '标题', '文件名', '总分', ...DIMS.map((dim) => dim.label)];
    const rows = scored.map((item) => [
      item.projectName,
      item.photo.analysis?.title ?? '',
      item.photo.fileName,
      (item.photo.analysis?.score?.overall ?? 0).toFixed(1),
      ...DIMS.map((dim) => (item.photo.analysis?.score?.breakdown[dim.key] ?? 0).toFixed(1)),
    ]);
    const escape = (value: string): string =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const csv = [head, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
    // 带 BOM，Excel 打开中文才不会乱码
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `照片故事-评分表-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${scored.length} 张的评分表`);
  }, [scored]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    let list = scoped.filter((item) => {
      const has = typeof item.photo.analysis?.score?.overall === 'number';
      if (filter === 'scored' && !has) return false;
      if (filter === 'unscored' && has) return false;
      if (!kw) return true;
      const title = item.photo.analysis?.title ?? '';
      return (
        title.toLowerCase().includes(kw) ||
        item.photo.fileName.toLowerCase().includes(kw) ||
        item.projectName.toLowerCase().includes(kw)
      );
    });

    list = [...list].sort((a, b) => {
      const sa = a.photo.analysis?.score?.overall ?? -1;
      const sb = b.photo.analysis?.score?.overall ?? -1;
      if (sort === 'score-desc') return sb - sa;
      if (sort === 'score-asc') return (sa < 0 ? 999 : sa) - (sb < 0 ? 999 : sb);
      return b.photo.updatedAt - a.photo.updatedAt;
    });

    return list;
  }, [scoped, filter, sort, keyword]);

  const photos = visible.map((item) => item.photo);

  const applyScore = useCallback(async (id: string): Promise<boolean> => {
    const target = photos.find((p) => p.id === id) ?? items?.find((i) => i.photo.id === id)?.photo;
    if (!target) return false;
    if (!target.analysis) {
      toast.error('这张照片还没有文字内容', { description: '请先到项目里重新识别，再评分' });
      return false;
    }

    setScoringId(id);
    try {
      const asset = await AssetRepository.get(id, 'ai');
      if (!asset) throw new Error('找不到这张照片的识别用图');

      const result = await scorePhoto(id, asset.blob, asset.mime);
      if (!result.ok) {
        toast.error('评分失败', { description: result.error.message });
        return false;
      }

      const updated = await PhotoRepository.update(id, {
        analysis: {
          ...target.analysis,
          score: result.score,
          scoreAdvice: result.scoreAdvice,
        },
      });

      setItems((prev) =>
        prev ? prev.map((it) => (it.photo.id === id ? { ...it, photo: updated } : it)) : prev,
      );
      return true;
    } catch (error) {
      toast.error('评分失败', { description: (error as Error).message });
      return false;
    } finally {
      setScoringId(null);
    }
  }, [items, photos]);

  const handleBatch = async (): Promise<void> => {
    const targets = (items ?? []).filter(
      (it) => it.photo.status === 'success' && it.photo.analysis && !it.photo.analysis.score,
    );
    if (targets.length === 0) {
      toast('没有需要评分的照片', { description: '已生成的照片都已有分数' });
      return;
    }

    setBatching(true);
    let done = 0;
    for (const item of targets) {
      const ok = await applyScore(item.photo.id);
      if (ok) {
        done += 1;
        toast.success('评分 ' + done + '/' + targets.length, { description: item.photo.fileName });
      }
    }
    setBatching(false);
    toast.success('批量评分完成', { description: '本次处理 ' + done + ' 张' });
  };

  /** 0.3.5：全部重评（换模型后一键按新模型重算，已有分数也会被覆盖） */
  const handleRescoreAll = async (): Promise<void> => {
    const targets = (items ?? []).filter((it) => it.photo.status === 'success' && it.photo.analysis);
    if (targets.length === 0) {
      toast('没有可重评的照片', { description: '先到项目里生成文字' });
      return;
    }

    setRescoring(true);
    let done = 0;
    for (const item of targets) {
      const ok = await applyScore(item.photo.id);
      if (ok) {
        done += 1;
        toast.success('重评 ' + done + '/' + targets.length, { description: item.photo.fileName });
      }
    }
    setRescoring(false);
    toast.success('全部重评完成', { description: '本次处理 ' + done + ' 张' });
  };

  const unscoredCount = scoped.filter(
    (it) => it.photo.status === 'success' && it.photo.analysis && !it.photo.analysis.score,
  ).length;

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 rounded-full"
            onClick={() => void handleRescoreAll()}
            disabled={rescoring || scored.length === 0}
            title="换模型或对分数不满意时，对全部照片重算一遍"
          >
            {rescoring ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {rescoring ? '重评中…' : '全部重评'}
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-full px-3.5"
            onClick={() => void handleBatch()}
            disabled={batching || unscoredCount === 0}
          >
            {batching ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {batching ? '批量评分中…' : `补评分${unscoredCount > 0 ? ` (${unscoredCount})` : ''}`}
          </Button>
        </div>
      }
    >
      <div className="px-5 py-8 md:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ps-eyebrow">Score</p>
            <h1 className="ps-display mt-2 text-[30px] text-ink sm:text-[34px]">评分</h1>
            <p className="mt-2 max-w-[38rem] text-[13px] leading-relaxed text-ink-mid">
              所有项目的照片分数都在这里。按赛事标准校准，点开可以看分项与改进建议。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {projectOptions.length > 1 && (
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-8 w-36 rounded-full text-[12.5px]">
                  <SelectValue placeholder="全部项目" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部项目（{items?.length ?? 0}）</SelectItem>
                  {projectOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}（{option.count}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索标题 / 文件名 / 项目"
                className="h-8 w-56 rounded-full pr-8 pl-8 text-[12.5px]"
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-ink-faint transition-colors hover:text-ink"
                  aria-label="清空"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="score" className="mb-5" />

        {/* 0.7.3：四张读数卡 + 直方图 + 雷达合成一张「体检卡」——
            左列给总分（一眼看到水平），右列给分布与维度（看到问题在哪） */}
        <section className="ps-enter mb-4 overflow-hidden rounded-[16px] border border-line/60 bg-surface">
          <div className="grid lg:grid-cols-[232px_1fr]">
            <div className="flex flex-col justify-between gap-5 border-b border-line/50 px-5 py-4.5 lg:border-r lg:border-b-0">
              <div>
                <p className="ps-eyebrow">平均分</p>
                <p className="ps-stat mt-2 text-[42px] leading-none tracking-[-0.02em]">
                  {average ? average.toFixed(1) : '—'}
                </p>
                <p className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
                  {scored.length} 张已评分 · 共 {items?.length ?? 0} 张
                </p>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-ink-faint">最高</dt>
                  <dd className="ps-stat mt-0.5 text-[15px] leading-none">
                    {highest ? highest.toFixed(1) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] tracking-[0.08em] text-ink-faint">待评</dt>
                  <dd className="ps-stat mt-0.5 text-[15px] leading-none">{unscoredCount}</dd>
                </div>
              </dl>
            </div>

            {scored.length >= 3 ? (
              <div className="grid md:grid-cols-[1fr_236px]">
                <div className="min-w-0 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h2 className="ps-eyebrow">分数分布</h2>
                    <div className="flex items-center gap-2">
                      <span className="text-[10.5px] text-ink-faint">
                        {distribution.reduce((best, b) => (b.count > best.count ? b : best)).label} 档最多
                      </span>
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        className="rounded-full border border-line/60 bg-surface-2/70 px-2.5 py-1 text-[10.5px] text-ink-mid transition-colors duration-200 hover:border-ink/20 hover:text-ink"
                        title="导出为 CSV，可用 Excel 打开"
                      >
                        导出评分表
                      </button>
                    </div>
                  </div>

                  {/* 柱子高度百分比必须有确定的参照高度，否则解析成 0 看不见 */}
                  <div className="flex items-start gap-1.5">
                    {distribution.map((bin, index) => {
                      const max = Math.max(...distribution.map((b) => b.count), 1);
                      const height = (bin.count / max) * 100;
                      return (
                        <div
                          key={bin.label}
                          className="group/bin flex h-32 flex-1 flex-col items-center justify-end gap-1"
                        >
                          <span
                            className={cn(
                              'text-[9.5px] tabular-nums',
                              bin.count > 0 ? 'text-ink-mid' : 'text-ink-faint/60',
                            )}
                          >
                            {bin.count}
                          </span>
                          <div
                            className={cn(
                              'w-full origin-bottom rounded-t-[4px] transition-colors duration-200',
                              bin.count === 0
                                ? 'h-[2px] bg-line/60'
                                : 'bg-ink/65 group-hover/bin:bg-ink',
                            )}
                            style={{
                              ...(bin.count === 0 ? {} : { height: `${Math.max(6, height)}%` }),
                              animation: `ps-bar-grow 620ms var(--ease-out) ${index * 50}ms both`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-1.5 flex gap-1.5">
                    {distribution.map((bin) => (
                      <span
                        key={bin.label}
                        className="flex-1 text-center text-[9px] tabular-nums text-ink-faint"
                      >
                        {bin.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col items-center border-t border-line/50 px-3 py-4 md:border-t-0 md:border-l">
                  <h2 className="self-start ps-eyebrow">维度雷达</h2>
                  <ScoreRadar axes={avgBreakdown} size={178} className="mt-1" />
                  <p className="mt-1 text-center text-[10px] leading-relaxed text-ink-faint">
                    本组平均，越靠外越强
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center px-5 py-10 text-[11.5px] text-ink-faint">
                再评几张照片，这里会长出分数分布和维度雷达
              </div>
            )}
          </div>
        </section>

        {/* 筛选与排序 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Segmented
            size="sm"
            ariaLabel="筛选"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f.id, label: f.label }))}
          />

          <Segmented
            size="sm"
            ariaLabel="排序"
            value={sort}
            onChange={setSort}
            options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
          />

          <span className="ml-auto text-[11px] text-ink-faint tabular-nums">
            {items === null ? '读取中…' : `${visible.length} 张`}
          </span>
        </div>

        {items === null ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="ps-skeleton h-[132px] rounded-[14px]" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="ps-enter flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line/80 bg-surface-2/40 px-6 py-20 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
              <Gauge className="h-5 w-5" strokeWidth={1.4} />
            </span>
            <p className="text-[15px] font-medium text-ink">
              {items.length === 0 ? '还没有照片' : '没有符合条件的照片'}
            </p>
            <p className="mt-1.5 text-[12.5px] text-ink-faint">
              {items.length === 0
                ? '先去项目里上传并生成文字，评分页会自动汇总。'
                : '换个筛选条件或清空搜索试试。'}
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((item, index) => {
              const url = previews[item.photo.id];
              const a = item.photo.analysis;
              const score = a?.score;
              const busy = scoringId === item.photo.id;

              return (
                <article
                  key={item.photo.id}
                  className="ps-enter group overflow-hidden rounded-[14px] border border-line/60 bg-surface transition-[transform,box-shadow,border-color] duration-[380ms] ease-[var(--ease-out)] hover:-translate-y-1 hover:border-ink/15 hover:shadow-[var(--elev-hover)]"
                  style={{ ['--ps-delay' as string]: `${Math.min(index, 18) * 40}ms` }}
                >
                  <div className="flex gap-3 p-3">
                    <button
                      type="button"
                      onClick={() => setPreviewIndex(index)}
                      aria-label={`查看 ${a?.title || item.photo.fileName} 的评分详情`}
                      className="ps-pressable relative h-[88px] w-[88px] shrink-0 overflow-hidden rounded-lg bg-surface-2"
                    >
                      {url ? (
                        <FadeImg
                          src={url}
                          alt={a?.alt ?? item.photo.fileName}
                          className="h-full w-full object-cover transition-transform duration-[700ms] ease-[var(--ease-out)] group-hover:scale-[1.06]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <ImageOff className="h-5 w-5 text-ink-faint" />
                        </span>
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13.5px] font-medium text-ink">
                            {a?.title || item.photo.fileName}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-ink-faint">
                            {item.projectName}
                          </p>
                        </div>
                        {score ? (
                          <div className="shrink-0 text-right">
                            <span className="block text-[22px] leading-none font-semibold tracking-[-0.02em] tabular-nums text-ink">
                              {score.overall.toFixed(1)}
                            </span>
                            {/* 0.5.0：和本组平均比，比单看一个分数更有参照 */}
                            {average > 0 && (
                              <span
                                className={cn(
                                  'mt-1 block text-[10px] tabular-nums',
                                  score.overall >= average
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-ink-faint',
                                )}
                              >
                                {score.overall >= average ? '+' : ''}
                                {(score.overall - average).toFixed(1)} 对比均值
                              </span>
                            )}
                            {/* 0.5.5：名次与分位 —— 单看 82.4 没概念，说清它在这册里排第几 */}
                            {(() => {
                              const r = rankOf.get(item.photo.id);
                              if (!r || r.total < 3) return null;
                              return (
                                <span className="mt-0.5 block text-[10px] tabular-nums text-ink-faint">
                                  第 {r.rank}/{r.total}
                                  <span className="mx-1 opacity-40">·</span>
                                  前 {r.pct}%
                                </span>
                              );
                            })()}
                          </div>
                        ) : (
                          <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] text-ink-faint">
                            未评分
                          </span>
                        )}
                      </div>

                      {score ? (
                        <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          {DIMS.map((dim) => (
                            <div key={dim.key} className="grid gap-1">
                              <div className="flex items-baseline justify-between text-[9.5px]">
                                <span className="text-ink-faint">{dim.label}</span>
                                <span className="tabular-nums text-ink-mid">
                                  {score.breakdown[dim.key].toFixed(1)}
                                </span>
                              </div>
                              <div className="h-[3px] overflow-hidden rounded-full bg-ink/8">
                                <div
                                  className="h-full rounded-full bg-ink/55 transition-[width] duration-700 ease-[var(--ease-out)]"
                                  style={{
                                    width: `${Math.min(100, Math.max(0, score.breakdown[dim.key]))}%`,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                          {/* 0.5.5：直接点出该先补哪一项 —— 六个分数并列时人看不出重点 */}
                          {(() => {
                            const weakest = DIMS.reduce(
                              (w, d) => (score.breakdown[d.key] < score.breakdown[w.key] ? d : w),
                              DIMS[0],
                            );
                            const value = score.breakdown[weakest.key];
                            if (value >= 84) return null;
                            return (
                              <p className="col-span-2 mt-0.5 text-[9.5px] text-ink-faint">
                                短板：{weakest.label} {value.toFixed(1)}
                                <span className="mx-1 opacity-40">·</span>
                                先补这一项最划算
                              </p>
                            );
                          })()}
                        </div>
                      ) : (
                        <div className="mt-2.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void applyScore(item.photo.id)}
                            disabled={busy || !a}
                            className="ps-pressable rounded-full bg-ink px-3 py-1 text-[11px] text-paper disabled:opacity-50"
                          >
                            {busy ? '评分中…' : a ? '开始评分' : '缺少文字'}
                          </button>
                          <span className="text-[10px] text-ink-faint">按赛事标准打分</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {score && (
                    <div className="flex items-center justify-between border-t border-line/40 px-3 py-1.5">
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(index)}
                        className="-my-1 rounded-md px-1.5 py-1.5 text-[11px] text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
                      >
                        查看详情
                      </button>
                      <button
                        type="button"
                        onClick={() => void applyScore(item.photo.id)}
                        disabled={busy}
                        className="-my-1 rounded-md px-1.5 py-1.5 text-[11px] text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
                      >
                        {busy ? '评分中…' : '重新评分'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {previewIndex !== null && (
        <PhotoStoryPreview
          photos={photos}
          index={Math.min(previewIndex, photos.length - 1)}
          previews={previews}
          onClose={() => setPreviewIndex(null)}
          onNavigate={setPreviewIndex}
          onScore={applyScore}
        />
      )}
    </AppShell>
  );
}
