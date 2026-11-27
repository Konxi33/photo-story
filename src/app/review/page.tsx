// src/app/review/page.tsx
// 评审室：同一张照片给三位不同口径的评委各看一次，看分数落在哪里、分歧在哪。
// 单人评分只有一个数字，评审室给的是「三个人吵起来的地方」——那通常正是这张片子值得再想一遍的地方。
// 结果按项目存在本地（ps:review），不写进正式评分，避免污染工作台里的分数。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Gavel, Loader2, Play, RotateCcw, Square, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { Button } from '@/components/ui/button';
import { FadeImg } from '@/components/ui/fade-img';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { JUDGE_PERSONAS, type JudgeId } from '@/config/scorePrompt';
import { judgePhotoLocally } from '@/lib/ai/client';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import {
  averageScore,
  clearBoard,
  readBoard,
  spreadOf,
  writeBoard,
  type JudgeVerdict,
  type PhotoReview,
  type ReviewBoard,
} from '@/lib/review/store';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

type Scope = 'all' | 'selected';
type SortKey = 'spread' | 'score';

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'all', label: '全部照片' },
  { id: 'selected', label: '仅入选' },
];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'spread', label: '分歧大→小' },
  { id: 'score', label: '分数高→低' },
];

const LIMITS = [
  { id: '5', label: '5 张' },
  { id: '10', label: '10 张' },
  { id: '20', label: '20 张' },
] as const;

const JUDGE_TONE: Record<JudgeId, { text: string; bar: string; ring: string }> = {
  editor: { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500/80', ring: 'ring-emerald-500/25' },
  curator: { text: 'text-violet-600 dark:text-violet-400', bar: 'bg-violet-500/80', ring: 'ring-violet-500/25' },
  tech: { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500/80', ring: 'ring-amber-500/25' },
};

export default function ReviewPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState<string>('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [board, setBoard] = useState<ReviewBoard | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [sort, setSort] = useState<SortKey>('spread');
  const [limit, setLimit] = useState<string>('5');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; hint: string }>({
    done: 0,
    total: 0,
    hint: '',
  });

  const urlsRef = useRef<Record<string, string>>({});
  const cancelRef = useRef(false);
  const boardRef = useRef<ReviewBoard | null>(null);

  /* ------------------------------ 载入项目与照片 ------------------------------ */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const list = await withTimeout(ProjectRepository.list(), 5000, []);
      if (cancelled) return;
      setProjects(list);
      if (list.length > 0) setProjectId((prev) => prev || list[0]!.id);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void (async () => {
      const list = await withTimeout(PhotoRepository.listByProject(projectId), 5000, []);
      if (cancelled) return;
      setPhotos(list.filter((p) => p.status !== 'processing'));
      setBoard(readBoard(projectId));

      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
      const urls: Record<string, string> = {};
      for (const photo of list) {
        try {
          const asset =
            (await AssetRepository.get(photo.id, 'preview')) ??
            (await AssetRepository.get(photo.id, 'original'));
          if (asset) urls[photo.id] = URL.createObjectURL(asset.blob);
        } catch {
          // 单张失败忽略
        }
      }
      if (!cancelled) {
        urlsRef.current = urls;
        setPreviews(urls);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(
    () => () => {
      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

  const scoped = useMemo(() => {
    const base = scope === 'selected' ? photos.filter((p) => p.selected) : photos;
    return base;
  }, [photos, scope]);

  const reviewByPhoto = useMemo(() => {
    const map = new Map<string, PhotoReview>();
    for (const r of board?.reviews ?? []) map.set(r.photoId, r);
    return map;
  }, [board]);

  const reviewed = useMemo(
    () => scoped.filter((p) => reviewByPhoto.has(p.id)).length,
    [scoped, reviewByPhoto],
  );

  const stats = useMemo(() => {
    const reviews = (board?.reviews ?? []).filter((r) => scoped.some((p) => p.id === r.photoId));
    const spreads = reviews.map(spreadOf).filter((s): s is number => s !== null);
    const avgs = reviews.map(averageScore).filter((s): s is number => s !== null);
    const avg = avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : null;
    const maxSpread = spreads.length ? Math.max(...spreads) : null;
    return { count: reviews.length, avg, maxSpread };
  }, [board, scoped]);

  /** 列表按分歧或分数排序，未评的排最后 */
  const rows = useMemo(() => {
    const list = [...scoped];
    list.sort((a, b) => {
      const ra = reviewByPhoto.get(a.id);
      const rb = reviewByPhoto.get(b.id);
      if (!ra && !rb) return 0;
      if (!ra) return 1;
      if (!rb) return -1;
      if (sort === 'spread') return (spreadOf(rb) ?? 0) - (spreadOf(ra) ?? 0);
      return (averageScore(rb) ?? 0) - (averageScore(ra) ?? 0);
    });
    return list;
  }, [scoped, reviewByPhoto, sort]);

  /* -------------------------------- 开始评审 -------------------------------- */
  const persist = useCallback((next: ReviewBoard) => {
    boardRef.current = next;
    setBoard(next);
    writeBoard(next);
  }, []);

  const run = useCallback(async () => {
    if (!projectId || running) return;
    const max = limit === 'all' ? scoped.length : Number(limit);
    // 优先评审还没被评过的，其次是已有结果的（重评）
    const queue = [...scoped]
      .sort((a, b) => Number(reviewByPhoto.has(a.id)) - Number(reviewByPhoto.has(b.id)))
      .slice(0, Math.max(1, max));
    if (queue.length === 0) {
      toast.error('这个范围里没有可以评审的照片');
      return;
    }

    cancelRef.current = false;
    setRunning(true);
    setProgress({ done: 0, total: queue.length, hint: '准备中' });

    let current: ReviewBoard = {
      projectId,
      reviews: [...(boardRef.current?.reviews ?? [])],
      updatedAt: Date.now(),
    };

    for (let i = 0; i < queue.length; i += 1) {
      if (cancelRef.current) break;
      const photo = queue[i]!;
      const verdicts: JudgeVerdict[] = [];

      for (const persona of JUDGE_PERSONAS) {
        if (cancelRef.current) break;
        setProgress({ done: i, total: queue.length, hint: `${persona.name} 正在看第 ${i + 1} 张` });
        const blob = await (async () => {
          const asset =
            (await AssetRepository.get(photo.id, 'ai')) ??
            (await AssetRepository.get(photo.id, 'preview')) ??
            (await AssetRepository.get(photo.id, 'original'));
          return asset?.blob ?? null;
        })();
        if (!blob) {
          verdicts.push({ judge: persona.id, score: null, advice: [], error: '图片读取失败' });
          continue;
        }
        const result = await judgePhotoLocally(
          photo.id,
          blob,
          blob.type || 'image/jpeg',
          persona.id,
        );
        if (result.ok) {
          verdicts.push({
            judge: persona.id,
            score: result.score.overall,
            advice: result.scoreAdvice ?? [],
          });
        } else {
          verdicts.push({
            judge: persona.id,
            score: null,
            advice: [],
            error: result.error.message,
          });
        }
      }

      const entry: PhotoReview = { photoId: photo.id, verdicts, at: Date.now() };
      current = {
        ...current,
        reviews: [...current.reviews.filter((r) => r.photoId !== photo.id), entry],
        updatedAt: Date.now(),
      };
      persist(current);

      const failed = verdicts.filter((v) => v.score === null).length;
      if (failed === verdicts.length) {
        toast.error(`第 ${i + 1} 张评审失败：${verdicts[0]?.error ?? '模型没有返回结果'}`);
        // 认证/额度类错误继续跑下去也没意义，直接停
        if (verdicts.some((v) => v.error?.includes('Key') || v.error?.includes('配额'))) break;
      }
      setProgress({ done: i + 1, total: queue.length, hint: '已完成一张' });
    }

    setRunning(false);
    setProgress({ done: 0, total: 0, hint: '' });
    if (!cancelRef.current) toast.success('评审完成');
  }, [projectId, running, limit, scoped, reviewByPhoto, persist]);

  const stop = () => {
    cancelRef.current = true;
    setRunning(false);
  };

  const reset = () => {
    if (!projectId) return;
    clearBoard(projectId);
    boardRef.current = null;
    setBoard(null);
    toast.success('已清空这个项目的评审结果');
  };

  const empty = projects !== null && projects.length === 0;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ps-eyebrow">Review Room</p>
            <h1 className="ps-page-title mt-2">评审室</h1>
            <p className="ps-page-desc mt-2">
              三位评委各看一次：编辑看能不能读、策展人看挂不挂得住、审片师看能不能印。
              分差越大，越说明这张片子值得再想一遍。
            </p>
          </div>
          {projects && projects.length > 0 && (
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}（{p.photoCount}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </header>

        {/* 0.5.5：第一次进来先告诉用户这个模块是干什么用的 */}
        <ModuleGuide moduleId="review" className="mb-5" />

        {empty && (
          <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center">
            <Gavel className="mx-auto mb-3 h-7 w-7 text-ink-faint" />
            <p className="text-[13.5px] text-ink-mid">还没有项目，先建一个项目放几张照片进来。</p>
            <Button asChild className="mt-4" size="sm">
              <Link href={ROUTES.projects}>去项目</Link>
            </Button>
          </div>
        )}

        {!empty && projects && projects.length > 0 && (
          <>
            {/* 控制条 */}
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line/60 bg-surface-2/40 px-3 py-2.5">
              <Segmented
                ariaLabel="评审范围"
                value={scope}
                onChange={(id) => setScope(id as Scope)}
                options={SCOPES.map((s) => ({ value: s.id, label: s.label }))}
              />
              <Segmented
                ariaLabel="评审张数"
                value={limit}
                onChange={setLimit}
                options={LIMITS.map((l) => ({ value: l.id, label: l.label }))}
              />
              <div className="ml-auto flex items-center gap-2">
                {running ? (
                  <Button variant="secondary" size="sm" onClick={stop}>
                    <Square className="mr-1.5 h-3.5 w-3.5" />
                    停止
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void run()} disabled={scoped.length === 0}>
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                    开始评审
                  </Button>
                )}
                {(board?.reviews.length ?? 0) > 0 && !running && (
                  <Button variant="ghost" size="sm" onClick={reset} title="清空这个项目的评审结果">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* 进度 */}
            {running && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-line/60 bg-surface-2/50 px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-mid" />
                <span className="text-[12px] text-ink-mid">
                  {progress.hint} · {progress.done}/{progress.total}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-line/60">
                  <span
                    className="block h-full rounded-full bg-ink transition-[width] duration-500 ease-[var(--ease-out)]"
                    style={{
                      width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </span>
              </div>
            )}

            {/* 统计 */}
            {stats.count > 0 && (
              <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="已评审" value={String(stats.count)} suffix="张" />
                <Stat
                  label="三位平均"
                  value={stats.avg === null ? '—' : stats.avg.toFixed(1)}
                  suffix="分"
                />
                <Stat
                  label="最大分歧"
                  value={stats.maxSpread === null ? '—' : stats.maxSpread.toFixed(1)}
                  suffix="分"
                />
                <Stat label="范围内" value={String(scoped.length)} suffix="张待看" />
              </div>
            )}

            {/* 排序 */}
            <div className="mb-2 flex items-center justify-between">
              <Segmented
                ariaLabel="排序"
                value={sort}
                onChange={(id) => setSort(id as SortKey)}
                options={SORTS.map((s) => ({ value: s.id, label: s.label }))}
              />
              <span className="text-[11px] text-ink-faint tabular-nums">
                {reviewed}/{scoped.length} 已评
              </span>
            </div>

            {/* 列表 */}
            {rows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center text-[13px] text-ink-mid">
                这个范围里没有照片。换一个范围，或者先去项目里勾选几张。
              </div>
            ) : (
              <ul className="grid gap-2.5">
                {rows.map((photo, index) => (
                  <ReviewRow
                    key={photo.id}
                    photo={photo}
                    index={index}
                    url={previews[photo.id]}
                    review={reviewByPhoto.get(photo.id)}
                    running={running}
                  />
                ))}
              </ul>
            )}

            {/* 重评提示 */}
            {(board?.reviews.length ?? 0) > 0 && (
              <p className="mt-4 flex items-center gap-1.5 text-[11px] text-ink-faint">
                <RotateCcw className="h-3 w-3" />
                再次点「开始评审」会先补评没评过的照片，已经评过的会重新评审。
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ label, value, suffix }: { label: string; value: string; suffix: string }) {
  return (
    <div className="rounded-xl border border-line/50 bg-surface-2/40 px-3 py-2">
      <p className="text-[10.5px] tracking-[0.04em] text-ink-faint">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[19px] font-semibold leading-none tabular-nums text-ink">{value}</span>
        <span className="text-[10.5px] text-ink-faint">{suffix}</span>
      </p>
    </div>
  );
}

function ReviewRow({
  photo,
  index,
  url,
  review,
  running,
}: {
  photo: Photo;
  index: number;
  url?: string;
  review?: PhotoReview;
  running: boolean;
}) {
  const spread = review ? spreadOf(review) : null;
  const avg = review ? averageScore(review) : null;
  const title = photo.analysis?.title || photo.fileName;
  const hot = spread !== null && spread >= 8;

  return (
    <li
      className={cn(
        'ps-enter grid gap-3 rounded-2xl border border-line/60 bg-surface/60 p-3 sm:grid-cols-[132px_minmax(0,1fr)]',
        hot && 'border-amber-500/40',
      )}
      style={{ ['--ps-delay' as string]: `${Math.min(index, 10) * 40}ms` }}
    >
      <div className="relative overflow-hidden rounded-xl bg-surface-2">
        <div className="aspect-[4/3]">
          {url ? (
            <FadeImg src={url} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[10px] text-ink-faint">
              无缩略图
            </div>
          )}
        </div>
        {avg !== null && (
          <span className="absolute bottom-1 left-1 rounded-md bg-black/62 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums backdrop-blur-sm">
            {avg.toFixed(1)}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="truncate text-[13px] font-medium text-ink">{title}</span>
          {spread !== null && (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                hot ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300' : 'bg-surface-2 text-ink-faint',
              )}
              title="三位评委最高分与最低分之差"
            >
              分歧 {spread.toFixed(1)}
            </span>
          )}
          {!review && (
            <span className="text-[10.5px] text-ink-faint">{running ? '排队中' : '还没评审'}</span>
          )}
        </div>

        <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
          {JUDGE_PERSONAS.map((persona) => {
            const verdict = review?.verdicts.find((v) => v.judge === persona.id);
            const tone = JUDGE_TONE[persona.id];
            return (
              <div
                key={persona.id}
                className="rounded-lg border border-line/50 bg-surface-2/40 px-2 py-1.5"
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className={cn('text-[10.5px] font-medium', tone.text)}>{persona.name}</span>
                  <span className="text-[13px] font-semibold leading-none tabular-nums text-ink">
                    {verdict?.score === null || verdict === undefined
                      ? verdict?.error
                        ? '—'
                        : ''
                      : verdict.score.toFixed(1)}
                  </span>
                </div>
                {verdict && verdict.score !== null && (
                  <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-line/60">
                    <span
                      className={cn('block h-full rounded-full', tone.bar)}
                      style={{ width: `${Math.max(4, verdict.score)}%` }}
                    />
                  </span>
                )}
                <p className="mt-1 line-clamp-2 text-[10.5px] leading-[1.5] text-ink-faint">
                  {verdict?.error ?? verdict?.advice[0] ?? persona.angle}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </li>
  );
}