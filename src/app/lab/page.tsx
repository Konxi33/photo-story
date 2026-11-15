// src/app/lab/page.tsx
// 文案实验室：一次生成四条不同写法的标题与故事，并排比较，挑一条用。
// 工作台里的「重新生成」是碰运气——不满意就再点一次，不知道下一次会变成什么样。
// 实验室换了个做法：同时给你四个角度，好坏一眼可比，好的直接采用。

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, FlaskConical, Loader2, RefreshCw, Sparkles } from 'lucide-react';
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
import { analyzePhotoLocally } from '@/lib/ai/client';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn, withTimeout } from '@/lib/utils';
import type { Photo, PhotoAnalysis, ProjectSummary } from '@/types/domain';

interface Angle {
  id: string;
  label: string;
  note: string;
  titleStyle: 'literary' | 'concise' | 'poetic' | 'cinematic' | 'plain' | 'symbol';
  narrativeStyle: 'essay' | 'documentary' | 'prose-poem' | 'diary' | 'terse';
}

const ANGLES: Angle[] = [
  {
    id: 'essay',
    label: '文学随笔',
    note: '从一个细节起笔，克制，结尾落回画面',
    titleStyle: 'literary',
    narrativeStyle: 'essay',
  },
  {
    id: 'terse',
    label: '四字硬句',
    note: '标题极短，句子短促，靠并置产生意思',
    titleStyle: 'concise',
    narrativeStyle: 'terse',
  },
  {
    id: 'cinema',
    label: '电影纪实',
    note: '像镜头的名字，只写看到的，不写心里话',
    titleStyle: 'cinematic',
    narrativeStyle: 'documentary',
  },
  {
    id: 'symbol',
    label: '隐喻散文诗',
    note: '意象密一点，标题留白到读者自己懂',
    titleStyle: 'symbol',
    narrativeStyle: 'prose-poem',
  },
];

interface Candidate {
  angleId: string;
  status: 'loading' | 'ok' | 'error';
  analysis?: PhotoAnalysis;
  error?: string;
  applied?: boolean;
}

type CandidateMap = Record<string, Record<string, Candidate>>;

export default function LabPage() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState<string>('');
  const [candidates, setCandidates] = useState<CandidateMap>({});
  const [busy, setBusy] = useState(false);

  const urlsRef = useRef<Record<string, string>>({});
  const cancelRef = useRef(false);

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
      const usable = list.filter((p) => p.status === 'success');
      setPhotos(usable);
      setActiveId((prev) => (usable.some((p) => p.id === prev) ? prev : (usable[0]?.id ?? '')));

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

  const active = useMemo(() => photos.find((p) => p.id === activeId), [photos, activeId]);
  const activeCandidates = candidates[activeId] ?? {};
  const existingTitles = useMemo(
    () =>
      photos
        .map((p) => p.analysis?.title)
        .filter((t): t is string => Boolean(t && t.trim()))
        .slice(0, 200),
    [photos],
  );

  const update = useCallback((photoId: string, angleId: string, next: Candidate) => {
    setCandidates((prev) => ({
      ...prev,
      [photoId]: { ...(prev[photoId] ?? {}), [angleId]: next },
    }));
  }, []);

  const generate = useCallback(async () => {
    if (!active || busy) return;
    const photo = active;
    cancelRef.current = false;
    setBusy(true);
    setCandidates((prev) => ({
      ...prev,
      [photo.id]: Object.fromEntries(ANGLES.map((a) => [a.id, { angleId: a.id, status: 'loading' }])),
    }));

    const blob = await (async () => {
      const asset =
        (await AssetRepository.get(photo.id, 'ai')) ??
        (await AssetRepository.get(photo.id, 'preview')) ??
        (await AssetRepository.get(photo.id, 'original'));
      return asset?.blob ?? null;
    })();

    if (!blob) {
      setCandidates((prev) => ({
        ...prev,
        [photo.id]: Object.fromEntries(
          ANGLES.map((a) => [
            a.id,
            { angleId: a.id, status: 'error', error: '读不到这张照片的图片数据' },
          ]),
        ),
      }));
      setBusy(false);
      toast.error('读不到图片数据，可能原图已被清理');
      return;
    }

    for (const angle of ANGLES) {
      if (cancelRef.current) break;
      const result = await analyzePhotoLocally(photo.id, blob, blob.type || 'image/jpeg', undefined, {
        titleStyle: angle.titleStyle,
        narrativeStyle: angle.narrativeStyle,
        storyLength: 'medium',
        existingTitles,
      });
      if (result.ok) {
        update(photo.id, angle.id, {
          angleId: angle.id,
          status: 'ok',
          analysis: result.analysis,
        });
      } else {
        update(photo.id, angle.id, {
          angleId: angle.id,
          status: 'error',
          error: result.error.message,
        });
      }
    }

    setBusy(false);
    if (!cancelRef.current) toast.success('四个版本都写好了');
  }, [active, busy, existingTitles, update]);

  const apply = useCallback(
    async (angle: Angle, candidate: Candidate) => {
      if (!active || !candidate.analysis) return;
      try {
        await PhotoRepository.update(active.id, { analysis: candidate.analysis });
        update(active.id, angle.id, { ...candidate, applied: true });
        setPhotos((prev) =>
          prev.map((p) => (p.id === active.id ? { ...p, analysis: candidate.analysis } : p)),
        );
        toast.success('已采用这一版');
      } catch {
        toast.error('保存失败，可能本地存储空间不足');
      }
    },
    [active, update],
  );

  const empty = projects !== null && projects.length === 0;

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-5xl px-5 py-8 md:px-8">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ps-eyebrow">Copy Lab</p>
            <h1 className="ps-display mt-2 text-[26px] text-ink">文案实验室</h1>
            <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-ink-mid">
              同一张照片，四种写法一起写。文笔好坏放在一起才比得出来——
              满意的那条直接采用，不满意就换一批。
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
        <ModuleGuide moduleId="lab" className="mb-5" />

        {empty && (
          <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center">
            <FlaskConical className="mx-auto mb-3 h-7 w-7 text-ink-faint" />
            <p className="text-[13.5px] text-ink-mid">还没有项目，先去建一个吧。</p>
            <Button asChild className="mt-4" size="sm">
              <Link href={ROUTES.projects}>去项目</Link>
            </Button>
          </div>
        )}

        {!empty && projects && projects.length > 0 && photos.length === 0 && (
          <div className="rounded-2xl border border-dashed border-line/70 px-6 py-12 text-center">
            <p className="text-[13.5px] text-ink-mid">
              这个项目还没有已完成的照片。等照片识别完成后，文案都写在这张照片上。
            </p>
            <Button asChild className="mt-4" size="sm">
              <Link href={ROUTES.project(projectId)}>去项目</Link>
            </Button>
          </div>
        )}

        {photos.length > 0 && (
          <>
            {/* 照片选择条 */}
            <div className="ps-edge-fade ps-no-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1">
              {photos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => setActiveId(photo.id)}
                  aria-pressed={photo.id === activeId}
                  title={photo.analysis?.title || photo.fileName}
                  className={cn(
                    'relative h-14 w-[74px] shrink-0 overflow-hidden rounded-lg border-2 transition-all duration-200',
                    photo.id === activeId
                      ? 'border-ink shadow-[0_6px_18px_-8px_rgba(0,0,0,0.4)]'
                      : 'border-transparent opacity-70 hover:opacity-100',
                  )}
                >
                  {previews[photo.id] ? (
                    <FadeImg
                      src={previews[photo.id]!}
                      alt={photo.analysis?.title || photo.fileName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center bg-surface-2 text-[9px] text-ink-faint">
                      无缩略图
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
              {/* 左：当前照片与现有文案 */}
              <div className="lg:sticky lg:top-4 lg:self-start">
                <div className="overflow-hidden rounded-2xl border border-line/60 bg-surface/60">
                  <div className="bg-black/35">
                    <div className="aspect-[4/3]">
                      {active && previews[active.id] ? (
                        <FadeImg
                          src={previews[active.id]!}
                          alt={active.analysis?.title || active.fileName}
                          className="h-full w-full object-contain"
                        />
                      ) : null}
                    </div>
                  </div>
                  <div className="p-3">
                    <p className="text-[10.5px] tracking-[0.04em] text-ink-faint">现有的这一版</p>
                    <p className="mt-1 text-[15px] font-medium text-ink">
                      {active?.analysis?.title || '还没有标题'}
                    </p>
                    <p className="mt-1.5 line-clamp-[9] text-[12px] leading-[1.75] text-ink-mid">
                      {active?.analysis?.story || '这张照片还没有故事。点右边的按钮，让 AI 试四种写法。'}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <Button size="sm" onClick={() => void generate()} disabled={busy}>
                        {busy ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {busy ? '正在写…' : Object.keys(activeCandidates).length ? '换一批' : '生成四种写法'}
                      </Button>
                      {Object.keys(activeCandidates).length > 0 && !busy && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            cancelRef.current = true;
                            setCandidates((prev) => ({ ...prev, [activeId]: {} }));
                          }}
                        >
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                          清空
                        </Button>
                      )}
                    </div>
                    <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
                      每次生成 = 4 次模型调用，大约 6–12 秒。生成的文案不会自动保存，点「采用」才写进照片。
                    </p>
                  </div>
                </div>
              </div>

              {/* 右：四条候选 */}
              <div className="grid gap-2.5">
                {ANGLES.map((angle) => {
                  const candidate = activeCandidates[angle.id];
                  return (
                    <CandidateCard
                      key={angle.id}
                      angle={angle}
                      candidate={candidate}
                      onApply={() => candidate && void apply(angle, candidate)}
                    />
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function CandidateCard({
  angle,
  candidate,
  onApply,
}: {
  angle: Angle;
  candidate?: Candidate;
  onApply: () => void;
}) {
  const loading = candidate?.status === 'loading';
  const ok = candidate?.status === 'ok';
  const error = candidate?.status === 'error';
  const title = candidate?.analysis?.title;
  const story = candidate?.analysis?.story;
  const chars = story ? story.replace(/\s/g, '').length : 0;

  return (
    <div
      className={cn(
        'ps-enter rounded-2xl border bg-surface/60 p-3 transition-all duration-300',
        candidate?.applied
          ? 'border-emerald-500/45 bg-emerald-500/[0.05]'
          : 'border-line/60 hover:border-ink/20',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10.5px] font-medium text-ink-mid">
          {angle.label}
        </span>
        <span className="truncate text-[10.5px] text-ink-faint">{angle.note}</span>
        {candidate?.applied && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10.5px] text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3" />
            已采用
          </span>
        )}
      </div>

      {loading && (
        <div className="mt-2.5 grid gap-1.5">
          <span className="ps-skeleton block h-4 w-2/5 rounded" />
          <span className="ps-skeleton block h-3 w-full rounded" />
          <span className="ps-skeleton block h-3 w-11/12 rounded" />
          <span className="ps-skeleton block h-3 w-3/4 rounded" />
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg bg-amber-500/8 px-2 py-1.5 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
          {candidate?.error ?? '这一次没写出来'}
        </p>
      )}

      {ok && (
        <>
          <p className="mt-2 text-[15px] font-medium text-ink">{title}</p>
          <p className="mt-1 text-[12px] leading-[1.8] text-ink-mid">{story}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[10.5px] text-ink-faint tabular-nums">{chars} 字</span>
            <Button size="sm" variant={candidate?.applied ? 'secondary' : 'default'} onClick={onApply}>
              {candidate?.applied ? '已采用' : '采用这一版'}
            </Button>
          </div>
        </>
      )}

      {!candidate && (
        <p className="mt-2 text-[11.5px] text-ink-faint">点左边的「生成四种写法」。</p>
      )}
    </div>
  );
}