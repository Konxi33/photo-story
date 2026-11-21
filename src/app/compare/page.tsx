// src/app/compare/page.tsx
// 选片擂台：两两淘汰赛，一直打到剩下一张。
// 灵感来自摄影比赛的评片方式——人很难一次从 20 张里挑出最好的，
// 但每两张里选一张几乎不用想。淘汰赛把这个过程变成 19 次简单的选择。
// 全部在本地完成，不调用模型，所以随便打几轮都不花钱。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Crown, Keyboard, RotateCcw, Swords, Trophy } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { ModuleGuide } from '@/components/module-guide';
import { Button } from '@/components/ui/button';
import { FadeImg } from '@/components/ui/fade-img';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ROUTES } from '@/config/app';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { formatExifLine } from '@/lib/image/exif';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

interface Loss {
  id: string;
  /** 在第几轮被淘汰，越大越强 */
  round: number;
}

function shuffle<T>(list: T[]): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

export default function ComparePage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [stage, setStage] = useState<Photo[]>([]);
  const [pending, setPending] = useState<Photo[]>([]);
  const [losses, setLosses] = useState<Loss[]>([]);
  const [round, setRound] = useState(1);
  const [played, setPlayed] = useState(0);
  const [total, setTotal] = useState(0);
  const [champion, setChampion] = useState<Photo | null>(null);

  const urlsRef = useRef<Record<string, string>>({});

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
      const usable = list.filter((p) => p.status !== 'processing');
      setPhotos(usable);

      for (const url of Object.values(urlsRef.current)) URL.revokeObjectURL(url);
      urlsRef.current = {};
      const urls: Record<string, string> = {};
      for (const photo of usable) {
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

  const reset = useCallback(() => {
    const pool = shuffle(photos);
    setStage(pool.length === 1 ? [] : pool);
    setPending([]);
    setLosses([]);
    setRound(1);
    setPlayed(0);
    setTotal(Math.max(0, pool.length - 1));
    setChampion(pool.length === 1 ? pool[0]! : null);
  }, [photos]);

  const started = stage.length > 0 || champion !== null;

  const choose = useCallback(
    (winId: string) => {
      const [a, b] = stage;
      if (!a || !b) return;
      const winner = a.id === winId ? a : b;
      const loser = a.id === winId ? b : a;
      if (winner.id !== a.id && winner.id !== b.id) return;

      const nextLosses = [...losses, { id: loser.id, round }];
      let nextStage = stage.slice(2);
      let nextPending = [...pending, winner];
      let nextRound = round;
      let nextChampion: Photo | null = null;

      // 本轮已经凑不出下一对：收轮，晋级者进入下一轮
      if (nextStage.length <= 1) {
        if (nextStage.length === 1) nextPending.push(nextStage[0]!);
        nextStage = [];
        if (nextPending.length === 1) {
          nextChampion = nextPending[0]!;
          nextPending = [];
        } else {
          nextStage = nextPending;
          nextPending = [];
          nextRound = round + 1;
        }
      }

      setStage(nextStage);
      setPending(nextPending);
      setLosses(nextLosses);
      setRound(nextRound);
      setPlayed((n) => n + 1);
      if (nextChampion) setChampion(nextChampion);
    },
    [stage, pending, losses, round],
  );

  // 键盘：← / 1 选左，→ / 2 选右
  useEffect(() => {
    if (!started || champion) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'ArrowLeft' || event.key === '1') {
        event.preventDefault();
        if (stage[0]) choose(stage[0].id);
      } else if (event.key === 'ArrowRight' || event.key === '2') {
        event.preventDefault();
        if (stage[1]) choose(stage[1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, champion, stage, choose]);

  /** 最终名次：冠军 + 按淘汰轮次从后往前 */
  const ranking = useMemo(() => {
    const ordered = [...losses].sort((x, y) => {
      if (y.round !== x.round) return y.round - x.round;
      const pa = photos.find((p) => p.id === x.id);
      const pb = photos.find((p) => p.id === y.id);
      return (pb?.analysis?.score?.overall ?? 0) - (pa?.analysis?.score?.overall ?? 0);
    });
    const list: Photo[] = [];
    if (champion) list.push(champion);
    for (const loss of ordered) {
      const photo = photos.find((p) => p.id === loss.id);
      if (photo && !list.some((x) => x.id === photo.id)) list.push(photo);
    }
    return list;
  }, [champion, losses, photos]);

  const setAsCover = async () => {
    if (!champion || !projectId) return;
    try {
      await ProjectRepository.update(projectId, { coverPhotoId: champion.id });
      toast.success('已把冠军设为项目封面');
    } catch {
      toast.error('设置封面失败');
    }
  };

  const pickTop = async (count: number) => {
    if (ranking.length === 0) return;
    const ids = ranking.slice(0, count).map((p) => p.id);
    try {
      await PhotoRepository.updateMany(ids, { selected: true });
      toast.success(`已把前 ${ids.length} 张设为入选`);
    } catch {
      toast.error('设置入选失败');
    }
  };

  const empty = projects !== null && projects.length === 0;
  const onlyOne = photos.length === 1 && !started;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ps-eyebrow">Duel</p>
            <h1 className="ps-display mt-2 text-[30px] text-ink sm:text-[34px]">选片擂台</h1>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-mid">
              每两张里选一张，一直选到最后。全部在本地完成，不花一次模型调用。
              二十张照片只需要十九次「这个比那个好」。
            </p>
          </div>
          {projects && projects.length > 0 && (
            <Select
              value={projectId}
              onValueChange={(id) => {
                setProjectId(id);
                setStage([]);
                setPending([]);
                setLosses([]);
                setChampion(null);
                setPlayed(0);
              }}
            >
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
        <ModuleGuide moduleId="compare" className="mb-5" />

        {empty && (
          <EmptyBlock
            title="还没有项目"
            hint="先建一个项目，导入照片之后再来打擂台。"
            cta="去项目"
            href={ROUTES.projects}
          />
        )}

        {!empty && photos.length === 0 && projects && projects.length > 0 && (
          <EmptyBlock
            title="这个项目里还没有照片"
            hint="导入照片之后，擂台会自动把它们两两分组。"
            cta="去导入"
            href={ROUTES.project(projectId)}
          />
        )}

        {onlyOne && (
          <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center text-[13px] text-ink-mid">
            只有一张照片，它就是冠军。
          </div>
        )}

        {photos.length > 1 && !started && (
          <div className="rounded-2xl border border-dashed border-line/70 px-6 py-14 text-center">
            <Swords className="mx-auto mb-3 h-8 w-8 text-ink-faint" />
            <p className="text-[14px] font-medium text-ink">准备好开始了吗</p>
            <p className="mx-auto mt-1.5 max-w-sm text-[12.5px] leading-relaxed text-ink-mid">
              {photos.length} 张照片，一共 {photos.length - 1} 场对决。
              顺序是随机打乱的，所以每次打出来的结果可能不一样。
            </p>
            <Button className="mt-5" onClick={reset}>
              <Swords className="mr-1.5 h-4 w-4" />
              开始（{photos.length} 张）
            </Button>
          </div>
        )}

        {photos.length > 1 && started && !champion && (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line/60 bg-surface-2/40 px-3 py-2">
              <span className="text-[12px] text-ink-mid">
                第 <span className="font-semibold text-ink tabular-nums">{round}</span> 轮 · 还剩{' '}
                <span className="font-semibold text-ink tabular-nums">
                  {stage.length + pending.length}
                </span>{' '}
                张
              </span>
              <span className="text-[11px] text-ink-faint tabular-nums">
                {played}/{total} 场
              </span>
              <Button variant="ghost" size="sm" onClick={reset}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                重新开始
              </Button>
            </div>

            <div className="mb-2 h-1 overflow-hidden rounded-full bg-line/60">
              <span
                className="block h-full rounded-full bg-ink transition-[width] duration-500 ease-[var(--ease-out)]"
                style={{ width: `${total ? (played / total) * 100 : 0}%` }}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {stage.slice(0, 2).map((photo, index) => (
                <DuelCard
                  key={photo.id}
                  photo={photo}
                  url={previews[photo.id]}
                  side={index === 0 ? 'left' : 'right'}
                  onPick={() => choose(photo.id)}
                />
              ))}
            </div>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-ink-faint">
              <Keyboard className="h-3 w-3" />
              按 ← 或 1 选左边，→ 或 2 选右边，也可以直接点照片
            </p>
          </>
        )}

        {champion && (
          <>
            <div className="mb-4 overflow-hidden rounded-2xl border border-amber-500/35 bg-amber-500/[0.06]">
              <div className="flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium text-amber-700 dark:text-amber-300">
                <Crown className="h-4 w-4" />
                冠军
                <span className="ml-auto text-[11px] font-normal text-ink-faint tabular-nums">
                  {total} 场对决
                </span>
              </div>
              <div className="grid gap-4 px-4 pb-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                <div className="overflow-hidden rounded-xl bg-black/40">
                  <div className="aspect-[3/2]">
                    {previews[champion.id] ? (
                      <FadeImg
                        src={previews[champion.id]!}
                        alt={champion.analysis?.title || champion.fileName}
                        className="h-full w-full object-contain"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="ps-display text-[19px] text-ink">
                    {champion.analysis?.title || champion.fileName}
                  </p>
                  <p className="mt-1 text-[12px] text-ink-mid">
                    {champion.analysis?.score
                      ? `评分 ${champion.analysis.score.overall.toFixed(1)}`
                      : '还没有评分'}
                    {formatExifLine(champion.exif) ? ' · ' + formatExifLine(champion.exif) : ''}
                  </p>
                  {champion.analysis?.story ? (
                    <p className="mt-2 line-clamp-4 text-[12px] leading-[1.75] text-ink-mid">
                      {champion.analysis.story}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => void setAsCover()}>
                      <Crown className="mr-1.5 h-3.5 w-3.5" />
                      设为封面
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => void pickTop(3)}>
                      前 3 名设为入选
                    </Button>
                    <Button variant="ghost" size="sm" onClick={reset}>
                      <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                      再来一轮
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-line/60 bg-surface/60 p-4">
              <h2 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-ink">
                <Trophy className="h-3.5 w-3.5 text-ink-faint" />
                名次（按淘汰的早晚）
              </h2>
              <p className="mb-2.5 text-[10.5px] leading-relaxed text-ink-faint">
                这是淘汰赛，不是按分数排名——分数高的如果提前撞上冠军，也只能排后面。
              </p>
              <ol className="grid gap-1.5">
                {ranking.slice(0, 10).map((photo, index) => (
                  <li
                    key={photo.id}
                    className="flex items-center gap-2.5 rounded-lg border border-line/40 bg-surface-2/40 px-2 py-1.5"
                  >
                    <span
                      className={cn(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10.5px] font-semibold tabular-nums',
                        index === 0
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'bg-surface-2 text-ink-faint',
                      )}
                    >
                      {index + 1}
                    </span>
                    <div className="h-8 w-11 shrink-0 overflow-hidden rounded bg-line/40">
                      {previews[photo.id] ? (
                        <FadeImg
                          src={previews[photo.id]!}
                          alt={photo.analysis?.title || photo.fileName}
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                      {photo.analysis?.title || photo.fileName}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint tabular-nums">
                      {photo.analysis?.score ? photo.analysis.score.overall.toFixed(1) : '—'}
                    </span>
                  </li>
                ))}
              </ol>
              {ranking.length > 10 && (
                <p className="mt-2 text-[11px] text-ink-faint">后面还有 {ranking.length - 10} 张</p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function EmptyBlock({
  title,
  hint,
  cta,
  href,
}: {
  title: string;
  hint: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center">
      <Swords className="mx-auto mb-3 h-7 w-7 text-ink-faint" />
      <p className="text-[13.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[12.5px] text-ink-mid">{hint}</p>
      <Button asChild className="mt-4" size="sm">
        <Link href={href}>{cta}</Link>
      </Button>
    </div>
  );
}

function DuelCard({
  photo,
  url,
  side,
  onPick,
}: {
  photo: Photo;
  url?: string;
  side: 'left' | 'right';
  onPick: () => void;
}) {
  const exifLine = formatExifLine(photo.exif);
  return (
    <button
      type="button"
      onClick={onPick}
      className="ps-pressable group relative overflow-hidden rounded-2xl border border-line/60 bg-surface/60 text-left transition-all duration-300 ease-[var(--ease-out)] hover:border-ink/25 hover:shadow-[0_18px_46px_-22px_rgba(0,0,0,0.5)] focus-visible:border-ink/40"
    >
      <div className="bg-black/40">
        <div className="aspect-[3/2]">
          {url ? (
            <FadeImg
              src={url}
              alt={photo.analysis?.title || photo.fileName}
              className="h-full w-full object-contain transition-transform duration-[420ms] ease-[var(--ease-out)] group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-white/50">
              无缩略图
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface-2 text-[10.5px] font-semibold text-ink-faint">
          {side === 'left' ? '←' : '→'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium text-ink">
            {photo.analysis?.title || photo.fileName}
          </p>
          <p className="truncate text-[10.5px] text-ink-faint">
            {photo.analysis?.score
              ? `评分 ${photo.analysis.score.overall.toFixed(1)}`
              : '未评分'}
            {exifLine ? ' · ' + exifLine : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-ink px-2 py-1 text-[10.5px] text-paper opacity-0 transition-opacity duration-200 group-hover:opacity-100">
          选这张
        </span>
      </div>
    </button>
  );
}