// src/app/projects/[projectId]/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { AppHeader } from '@/components/workbench/AppHeader';
import { Button } from '@/components/ui/button';
import { BatchToolbar, type PhotoFilter, type PhotoView } from '@/components/workbench/BatchToolbar';
import { BatchTagsDialog } from '@/components/workbench/BatchTagsDialog';
import { ExportDialog } from '@/components/workbench/ExportDialog';
import { PhotoEditorSheet } from '@/components/workbench/PhotoEditorSheet';
import { PhotoGrid } from '@/components/workbench/PhotoGrid';
import { SettingsDialog } from '@/components/workbench/SettingsDialog';
import { StatusBar } from '@/components/workbench/StatusBar';
import { UploadDropzone } from '@/components/workbench/UploadDropzone';
import {
  API_ROUTES,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  ROUTES,
  STORAGE_KEY_APP_SETTINGS,
} from '@/config/app';
import { analyzePhotoLocally, runBatchAnalysis } from '@/lib/ai';
import { scorePhoto } from '@/lib/score/dispatch';
import { AssetRepository, KvRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import type {
  AiConfigPublic,
  AppSettings,
  BatchRunState,
  NarrativeStyle,
  Photo,
  PhotoError,
  Project,
  StoryLength,
  TitleStyle,
} from '@/types/domain';

type LoadStatus = 'loading' | 'ready' | 'missing';

interface GenSettings {
  concurrency: number;
  timeoutMs: number;
  maxRetries: number;
  titleStyle: TitleStyle;
  narrativeStyle: NarrativeStyle;
  storyLength: StoryLength;
}

export default function WorkbenchPage() {
  const params = useParams<{ projectId: string }>();
  const router = useRouter();
  const projectId = params.projectId;

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [project, setProject] = useState<Project | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [filter, setFilter] = useState<PhotoFilter>('all');
  const [hasKey, setHasKey] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [batchTagsOpen, setBatchTagsOpen] = useState(false);

  const [batchStatus, setBatchStatus] = useState<BatchRunState>({
    status: 'idle',
    done: 0,
    total: 0,
  });
  const [scoring, setScoring] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'selected' | 'all' | null>(null);
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const stopRef = useRef(false);

  const [genSettings, setGenSettings] = useState<GenSettings>({
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    titleStyle: 'literary',
    narrativeStyle: 'essay',
    storyLength: 'medium',
  });

  // 视图偏好：网格 / 照片墙 + 列数，存本地
  const [view, setView] = useState<PhotoView>('grid');
  const [columns, setColumns] = useState<number>(3);

  useEffect(() => {
    void (async () => {
      try {
        const saved = await KvRepository.get<{ view: PhotoView; columns: number }>(
          'ui:workbenchView',
        );
        if (saved) {
          setView(saved.view === 'wall' ? 'wall' : 'grid');
          if (typeof saved.columns === 'number') setColumns(saved.columns);
        }
      } catch {
        // 用默认视图
      }
    })();
  }, []);

  const changeView = (next: PhotoView): void => {
    setView(next);
    void KvRepository.set('ui:workbenchView', { view: next, columns }).catch(() => undefined);
  };

  const changeColumns = (next: number): void => {
    setColumns(next);
    void KvRepository.set('ui:workbenchView', { view, columns: next }).catch(() => undefined);
  };

  const loadGenSettings = async (): Promise<void> => {
    try {
      const saved = await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS);
      if (saved) {
        setGenSettings({
          concurrency: saved.concurrency,
          timeoutMs: saved.timeoutMs,
          maxRetries: saved.maxRetries,
          titleStyle: saved.titleStyle ?? 'literary',
          narrativeStyle: saved.narrativeStyle ?? 'essay',
          storyLength: saved.storyLength ?? 'medium',
        });
      }
    } catch {
      // 读取失败就用默认值
    }
  };

  useEffect(() => {
    void loadGenSettings();
  }, []);

  /* Ctrl/Cmd + Enter 触发批量生成 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void handleBatchGenerate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, batchStatus.status, genSettings]);

  /* 0.5.6：命令面板搜到某张照片会带 ?photo=<id> 过来，直接把这页详情打开 */
  useEffect(() => {
    if (photos.length === 0) return;
    const target = new URLSearchParams(window.location.search).get('photo');
    if (!target) return;
    if (!photos.some((photo) => photo.id === target)) return;
    setEditingPhotoId((prev) => prev ?? target);
    // 用完把参数擦掉，免得刷新/返回时又弹一次
    window.history.replaceState(null, '', window.location.pathname);
  }, [photos]);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    void (async () => {
      try {
        const [loadedProject, loadedPhotos] = await Promise.all([
          ProjectRepository.get(projectId),
          PhotoRepository.listByProject(projectId),
        ]);
        if (cancelled) return;
        if (!loadedProject) {
          setStatus('missing');
          return;
        }
        setProject(loadedProject);
        setPhotos(loadedPhotos);
        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('missing');
        toast.error('加载项目失败', { description: (error as Error).message });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(API_ROUTES.settings, { cache: 'no-store' });
        const data = (await res.json()) as AiConfigPublic;
        if (!cancelled) setHasKey(Boolean(data.hasKey));
      } catch {
        if (!cancelled) setHasKey(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const urlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const alive = new Set(photos.map((p) => p.id));

      for (const [id, url] of urlsRef.current) {
        if (!alive.has(id)) {
          URL.revokeObjectURL(url);
          urlsRef.current.delete(id);
        }
      }

      const next: Record<string, string> = {};
      for (const photo of photos) {
        const cached = urlsRef.current.get(photo.id);
        if (cached) {
          next[photo.id] = cached;
          continue;
        }
        try {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (!asset || cancelled) continue;
          const url = URL.createObjectURL(asset.blob);
          urlsRef.current.set(photo.id, url);
          next[photo.id] = url;
        } catch {
          // 单张缩略图失败不影响其他卡片
        }
      }

      if (!cancelled) setPreviews(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [photos]);

  useEffect(() => {
    const map = urlsRef.current;
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  const stats = useMemo(() => {
    const total = photos.length;
    const success = photos.filter((p) => p.status === 'success').length;
    const failed = photos.filter((p) => p.status === 'failed').length;
    const processing = photos.filter((p) => p.status === 'processing').length;
    const pending = photos.filter((p) => p.status === 'idle').length;
    const selected = photos.filter((p) => p.selected).length;
    return { total, success, failed, processing, pending, selected };
  }, [photos]);

  const handleToggleSelect = async (id: string): Promise<void> => {
    const target = photos.find((p) => p.id === id);
    if (!target) return;
    try {
      const updated = await PhotoRepository.update(id, { selected: !target.selected });
      setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch (error) {
      toast.error('更新勾选失败', { description: (error as Error).message });
    }
  };

  /**
   * 0.4.2：按评分选片——挑高分照片做「精选集」时，不必一张张点。
   * 只动勾选状态，不碰照片内容。
   */
  const handleSelectByScore = async (minScore: number): Promise<void> => {
    const hits = photos.filter(
      (p) => typeof p.analysis?.score?.overall === 'number' && (p.analysis?.score?.overall ?? 0) >= minScore,
    );

    if (hits.length === 0) {
      toast.error(`没有 ${minScore} 分以上的照片`, { description: '先去评分页补评分' });
      return;
    }

    const checkedIds = new Set(hits.map((p) => p.id));
    try {
      await PhotoRepository.updateMany(
        photos.map((p) => p.id),
        { selected: false },
      );
      await PhotoRepository.updateMany([...checkedIds], { selected: true });
      setPhotos((prev) => prev.map((p) => ({ ...p, selected: checkedIds.has(p.id) })));
      toast.success(`已选 ${hits.length} 张`, { description: `评分 ≥ ${minScore} 的照片` });
    } catch (error) {
      toast.error('选片失败', { description: (error as Error).message });
    }
  };

  /**
   * 0.5.0：智能精选。
   *
   * 挑「最好的 N 张」时，纯按分数选出来往往全是同一类片子（一组夜景里分最高的
   * 五张全是长曝车轨）。所以按分数从高到低走一遍，同时限制同一题材的占比，
   * 选不满再回填，保证成书里题材不重复。
   */
  const handleSmartSelect = async (target: number): Promise<void> => {
    const pool = photos.filter(
      (p) =>
        p.status === 'success' &&
        typeof p.analysis?.score?.overall === 'number' &&
        p.analysis?.score,
    );

    if (pool.length === 0) {
      toast.error('还没有可用于精选的评分', { description: '先在评分页批量补分' });
      return;
    }

    const sorted = [...pool].sort(
      (a, b) => (b.analysis?.score?.overall ?? 0) - (a.analysis?.score?.overall ?? 0),
    );
    const cap = Math.max(1, Math.ceil(target / 3));
    const used = new Map<string, number>();
    const picked: string[] = [];

    for (const photo of sorted) {
      if (picked.length >= target) break;
      const key = photo.analysis?.tags?.[0] ?? photo.analysis?.mood ?? '';
      if (key) {
        const count = used.get(key) ?? 0;
        if (count >= cap && sorted.length > target) continue;
        used.set(key, count + 1);
      }
      picked.push(photo.id);
    }

    for (const photo of sorted) {
      if (picked.length >= target) break;
      if (!picked.includes(photo.id)) picked.push(photo.id);
    }

    const set = new Set(picked);
    try {
      await PhotoRepository.updateMany(
        photos.map((p) => p.id),
        { selected: false },
      );
      await PhotoRepository.updateMany(picked, { selected: true });
      setPhotos((prev) => prev.map((p) => ({ ...p, selected: set.has(p.id) })));
      toast.success(`已精选 ${picked.length} 张`, {
        description: '按评分从高到低，同题材最多占三分之一',
      });
    } catch (error) {
      toast.error('精选失败', { description: (error as Error).message });
    }
  };

  const handleToggleAll = async (checked: boolean): Promise<void> => {
    const ids = photos.map((p) => p.id);
    try {
      await PhotoRepository.updateMany(ids, { selected: checked });
      setPhotos((prev) => prev.map((p) => ({ ...p, selected: checked })));
    } catch (error) {
      toast.error('批量更新失败', { description: (error as Error).message });
    }
  };

  const handleDelete = async (id: string): Promise<void> => {
    const photo = photos.find((p) => p.id === id);
    if (!photo) return;

    try {
      // 0.5.6：删到回收站（不再是直接抹掉），点撤销就地恢复
      await PhotoRepository.softDelete([id]);
      setPhotos((prev) => prev.filter((p) => p.id !== id));
      toast('已移到回收站', {
        description: '8 秒内可撤销，也可以在「回收站」里找回',
        action: {
          label: '撤销',
          onClick: () => {
            void (async () => {
              await PhotoRepository.restore([id]);
              setPhotos(await PhotoRepository.listByProject(projectId));
              toast.success('已恢复 1 张');
            })();
          },
        },
        duration: 8000,
      });
    } catch (error) {
      toast.error('删除失败', { description: (error as Error).message });
    }
  };

  /** 0.4.0：批量删除（所选 / 全部），调用前已二次确认；0.5.6 起进回收站 */
  const handleDeleteBatch = async (mode: 'selected' | 'all'): Promise<void> => {
    const targets = mode === 'all' ? photos : photos.filter((p) => p.selected);
    if (targets.length === 0) {
      toast('没有可删除的照片', { description: '先勾选照片，或改用「全部删除」' });
      return;
    }

    const ids = targets.map((p) => p.id);
    try {
      await PhotoRepository.softDelete(ids);
      const idSet = new Set(ids);
      setPhotos((prev) => prev.filter((p) => !idSet.has(p.id)));
      toast.success('已移到回收站 ' + ids.length + ' 张', {
        description: '8 秒内可撤销，也可以在「回收站」里找回',
        action: {
          label: '撤销',
          onClick: () => {
            void (async () => {
              await PhotoRepository.restore(ids);
              setPhotos(await PhotoRepository.listByProject(projectId));
              toast.success('已恢复 ' + ids.length + ' 张');
            })();
          },
        },
        duration: 8000,
      });
    } catch (error) {
      toast.error('删除失败', { description: (error as Error).message });
      setPhotos(await PhotoRepository.listByProject(projectId).catch(() => photos));
    }
  };

  const handleRename = async (name: string): Promise<void> => {
    try {
      const updated = await ProjectRepository.rename(projectId, name);
      setProject(updated);
    } catch (error) {
      toast.error('重命名失败', { description: (error as Error).message });
    }
  };

  const handleBatchGenerate = async (): Promise<void> => {
    if (batchStatus.status === 'running' || batchStatus.status === 'stopping') return;

    const targets = photos.filter(
      (p) => p.selected && (p.status === 'idle' || p.status === 'failed'),
    );

    if (targets.length === 0) {
      toast('没有待处理的照片', { description: '请先选择未处理或失败的照片' });
      return;
    }

    stopRef.current = false;
    setBatchStatus({ status: 'running', done: 0, total: targets.length });

    try {
      const summary = await runBatchAnalysis({
        photos: targets,
        concurrency: genSettings.concurrency,
        maxRetries: genSettings.maxRetries,
        timeoutMs: genSettings.timeoutMs,
        style: {
          titleStyle: genSettings.titleStyle,
          narrativeStyle: genSettings.narrativeStyle,
          storyLength: genSettings.storyLength,
          existingTitles: photos
            .map((p) => p.analysis?.title)
            .filter((t): t is string => Boolean(t && t.trim())),
        },
        onPhotoStart: (id) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: 'processing', error: undefined } : p)),
          );
        },
        onPhotoSuccess: (id, _result, persisted) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === id ? (persisted ?? { ...p, status: 'success' }) : p)),
          );
          setBatchStatus((prev) => ({ ...prev, done: prev.done + 1 }));
        },
        onPhotoError: (id, error, persisted) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === id ? (persisted ?? { ...p, status: 'failed', error }) : p)),
          );
          setBatchStatus((prev) => ({ ...prev, done: prev.done + 1 }));
        },
        shouldStop: () => stopRef.current,
      });

      setBatchStatus({
        status: 'finished',
        done: summary.succeeded + summary.failed,
        total: summary.total,
        summary,
      });

      if (summary.canceled > 0) {
        toast('已停止：成功 ' + summary.succeeded + ' / 失败 ' + summary.failed, {
          description: summary.canceled + ' 张未开始处理',
        });
      } else {
        toast('生成完成：成功 ' + summary.succeeded + ' / 失败 ' + summary.failed, {
          description: '耗时 ' + Math.round((summary.finishedAt - summary.startedAt) / 1000) + ' 秒',
        });
      }
    } catch (error) {
      setBatchStatus({ status: 'idle', done: 0, total: 0 });
      toast.error('批量生成失败', { description: (error as Error).message });
    }
  };

  const handleStopBatch = (): void => {
    stopRef.current = true;
    setBatchStatus((prev) => ({ ...prev, status: 'stopping' }));
    toast('正在停止…', { description: '已在处理的照片会完成本次请求' });
  };

  const handleRetry = async (id: string): Promise<void> => {
    const target = photos.find((p) => p.id === id);
    if (!target) return;

    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: 'processing', error: undefined } : p)),
    );

    try {
      await PhotoRepository.update(id, { status: 'processing', error: undefined });

      const asset = await AssetRepository.get(id, 'ai');
      if (!asset) throw new Error('找不到这张照片的识别用图');

      const result = await analyzePhotoLocally(id, asset.blob, asset.mime);

      if (!result.ok) {
        const failed = await PhotoRepository.update(id, { status: 'failed', error: result.error });
        setPhotos((prev) => prev.map((p) => (p.id === id ? failed : p)));
        toast.error('重新识别失败', { description: result.error.message });
        return;
      }

      const now = Date.now();
      const updated = await PhotoRepository.update(id, {
        status: 'success',
        analysis: result.analysis,
        error: undefined,
        isEdited: false,
        meta: {
          model: result.meta.model,
          promptVersion: result.meta.promptVersion,
          temperature: result.meta.temperature,
          source: 'vision',
          createdAt: now,
          updatedAt: now,
          warnings: result.meta.warnings,
          usage: result.usage
            ? {
                promptTokens: result.usage.promptTokens,
                completionTokens: result.usage.completionTokens,
              }
            : undefined,
        },
      });

      setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
      toast.success('识别完成');
    } catch (error) {
      const photoError: PhotoError = {
        code: 'UNKNOWN',
        message: (error as Error).message,
        retryable: true,
        at: Date.now(),
      };
      await PhotoRepository.update(id, { status: 'failed', error: photoError }).catch(
        () => undefined,
      );
      setPhotos((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: 'failed', error: photoError } : p)),
      );
      toast.error('重新识别失败', { description: photoError.message });
    }
  };

  /**
   * 单独给一张照片评分：不重写标题/故事，只补 score 与 scoreAdvice。
   * 老照片（0.3.2 之前生成的）没有评分，靠这个入口补。
   */
  const handleScore = async (id: string): Promise<boolean> => {
    const target = photos.find((p) => p.id === id);
    if (!target) return false;
    if (!target.analysis) {
      toast.error('这张照片还没有文字内容', { description: '请先「重新识别」，再评分' });
      return false;
    }

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
      setPhotos((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return true;
    } catch (error) {
      toast.error('评分失败', { description: (error as Error).message });
      return false;
    }
  };

  /** 批量补评分：只处理已成功但没有 score 的照片 */
  const handleBatchScore = async (): Promise<void> => {
    const targets = photos.filter((p) => p.status === 'success' && p.analysis && !p.analysis.score);
    if (targets.length === 0) {
      toast('没有需要评分的照片', { description: '已生成的照片都已有评分' });
      return;
    }

    setScoring(true);
    let done = 0;
    for (const photo of targets) {
      const ok = await handleScore(photo.id);
      done += 1;
      if (ok) toast.success('评分 ' + done + '/' + targets.length, { description: photo.fileName });
    }
    setScoring(false);
    toast.success('评分完成', { description: '共处理 ' + done + ' 张' });
  };

  /**
   * 0.3.5：一键重生成（换模型后尤其有用）。
   * 对所有已成功的照片重跑整篇识别，文字与评分一起刷新。
   */
  const handleRegenerateAll = async (): Promise<void> => {
    const targets = photos.filter((p) => p.status === 'success' || p.status === 'failed');
    if (targets.length === 0) {
      toast('没有可重生成的照片', { description: '先批量生成，再用这里重跑' });
      return;
    }

    setRegenerating(true);
    try {
      const summary = await runBatchAnalysis({
        photos: targets,
        concurrency: genSettings.concurrency,
        maxRetries: genSettings.maxRetries,
        timeoutMs: genSettings.timeoutMs,
        style: {
          titleStyle: genSettings.titleStyle,
          narrativeStyle: genSettings.narrativeStyle,
          storyLength: genSettings.storyLength,
          existingTitles: [],
        },
        onPhotoStart: (id) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === id ? { ...p, status: 'processing', error: undefined } : p)),
          );
        },
        onPhotoSuccess: (id, _result, persisted) => {
          setPhotos((prev) =>
            prev.map((p) => (p.id === id ? (persisted ?? { ...p, status: 'success' }) : p)),
          );
        },
        onPhotoError: (id, error) => {
          setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, error } : p)));
        },
        shouldStop: () => stopRef.current,
      });

      toast.success('重生成完成', {
        description: '成功 ' + summary.succeeded + ' 张 · 失败 ' + summary.failed + ' 张',
      });
    } catch (error) {
      toast.error('重生成失败', { description: (error as Error).message });
    } finally {
      setRegenerating(false);
    }
  };

  /** 0.4.1：把全部文案复制成纯文本 */
  const handleCopyAllText = async (): Promise<void> => {
    const ready = photos.filter((p) => p.status === 'success' && p.analysis);
    if (ready.length === 0) {
      toast('还没有可复制的文案', { description: '先批量生成' });
      return;
    }

    const text = ready
      .map((photo) => {
        const a = photo.analysis;
        if (!a) return '';
        const score =
          typeof a.score?.overall === 'number' ? `（${a.score.overall.toFixed(1)} 分）` : '';
        return `${a.title || photo.fileName}${score}\n${a.story ?? ''}`.trim();
      })
      .filter(Boolean)
      .join('\n\n———\n\n');

    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制 ' + ready.length + ' 段文案', {
        description: '标题 + 正文，可直接粘贴',
      });
    } catch (error) {
      toast.error('复制失败', { description: (error as Error).message });
    }
  };

  const filteredPhotos = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return photos;
    return photos.filter((photo) => {
      const a = photo.analysis;
      const hay = [
        a?.title ?? '',
        a?.story ?? '',
        photo.fileName,
        ...(a?.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(kw);
    });
  }, [photos, keyword]);

  /** 0.4.2：导出前体检——把「缺文案 / 没评分 / 没封面」摆出来，避免导出一份残缺的册子 */
  const preflight = useMemo(() => {
    const ready = photos.filter((p) => p.status === 'success' && p.analysis);
    const missingText = photos.filter((p) => !p.analysis);
    const missingScore = ready.filter((p) => !p.analysis?.score);
    const failed = photos.filter((p) => p.status === 'failed');

    return {
      total: photos.length,
      ready: ready.length,
      missingText: missingText.length,
      missingScore: missingScore.length,
      failed: failed.length,
      hasCover: Boolean(project?.coverPhotoId),
      ok: photos.length > 0 && missingText.length === 0 && failed.length === 0,
    };
  }, [photos, project?.coverPhotoId]);

  /** 0.5.0：入选照片的字数与页数粗估（每页放一张图 + 一段说明） */
  const estimate = useMemo(() => {
    const picked = photos.filter(
      (p) =>
        p.selected &&
        p.analysis &&
        (p.status === 'success' || project?.exportSettings?.includeSkipped === true),
    );
    const words = picked.reduce((sum, p) => {
      const text = `${p.analysis?.title ?? ''}${p.analysis?.story ?? ''}`;
      return sum + text.replace(/\s/g, '').length;
    }, 0);
    // 一页约 260 字上下的图注排版，封面与目录各占一页
    const pages = Math.max(2, picked.length + 2);
    return { photos: picked.length, words, pages };
  }, [photos, project?.exportSettings]);

  const handleBack = (): void => {
    router.push(ROUTES.projects);
  };

  const handleReorder = async (orderedIds: string[]): Promise<void> => {
    const byId = new Map(photos.map((p) => [p.id, p]));
    const next = orderedIds
      .map((id) => byId.get(id))
      .filter((p): p is Photo => Boolean(p));
    setPhotos(next);

    try {
      await PhotoRepository.reorder(orderedIds);
    } catch (error) {
      toast.error('排序保存失败，已恢复原顺序', { description: (error as Error).message });
      setPhotos(await PhotoRepository.listByProject(projectId).catch(() => photos));
    }
  };

  const handleSetCover = async (id: string): Promise<void> => {
    try {
      const updated = await ProjectRepository.update(projectId, { coverPhotoId: id });
      setProject(updated);
      toast.success('已设为封面');
    } catch (error) {
      toast.error('设置封面失败', { description: (error as Error).message });
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-[13px] text-ink-faint">
        <Loader2 className="h-5 w-5 animate-spin" />
        加载中…
      </div>
    );
  }

  if (status === 'missing' || !project) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
          <AlertCircle className="h-5 w-5" strokeWidth={1.4} />
        </span>
        <div>
          <p className="text-[15px] font-medium text-ink">项目不存在</p>
          <p className="mt-1 text-[12.5px] text-ink-faint">可能已被删除，或链接有误。</p>
        </div>
        <Button size="sm" className="rounded-full" onClick={handleBack}>
          返回项目列表
        </Button>
      </div>
    );
  }

  const editingPhoto = editingPhotoId
    ? (photos.find((p) => p.id === editingPhotoId) ?? null)
    : null;

  const exportPhotos = photos.filter(
    (p) => p.selected && (p.status === 'success' || project.exportSettings.includeSkipped),
  );

  return (
    <div className="min-h-dvh bg-paper">
      <AppHeader
        projectName={project.name}
        onBack={handleBack}
        onRename={(name) => void handleRename(name)}
        onOpenSettings={() => setSettingsOpen(true)}
        onExport={() => setPreflightOpen(true)}
      />

      <main className="mx-auto w-full max-w-6xl px-5 pb-24 md:px-6">
        {!hasKey && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-50/80 px-4 py-2.5 text-[12.5px] text-amber-900 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">尚未配置模型与 API Key，暂时无法生成照片故事。</span>
            <Button size="sm" variant="outline" className="h-7 rounded-full" onClick={() => setSettingsOpen(true)}>
              去设置
            </Button>
          </div>
        )}

        <div className="mt-3">
          <UploadDropzone
            projectId={projectId}
            compact={photos.length > 0}
            onUploaded={(photo) => setPhotos((prev) => [...prev, photo])}
          />
        </div>

        <BatchToolbar
          pendingCount={stats.pending}
          filter={filter}
          onFilterChange={setFilter}
          onBatchGenerate={() => void handleBatchGenerate()}
          onSelectAll={() => void handleToggleAll(true)}
          onClearSelection={() => void handleToggleAll(false)}
          running={batchStatus.status === 'running' || batchStatus.status === 'stopping'}
          onStop={handleStopBatch}
          view={view}
          onViewChange={changeView}
          columns={columns}
          onColumnsChange={changeColumns}
          unscoredCount={
            photos.filter((p) => p.status === 'success' && p.analysis && !p.analysis.score).length
          }
          scoring={scoring}
          onBatchScore={() => void handleBatchScore()}
          regenerating={regenerating}
          onRegenerateAll={() => void handleRegenerateAll()}
          canRegenerate={photos.length > 0}
          selectedCount={photos.filter((p) => p.selected).length}
          totalCount={photos.length}
          onDeleteSelected={() => setDeleteMode('selected')}
          onDeleteAll={() => setDeleteMode('all')}
          onCopyAllText={() => void handleCopyAllText()}
          keyword={keyword}
          onKeywordChange={setKeyword}
          onSelectByScore={(min) => void handleSelectByScore(min)}
          onSmartSelect={(count) => void handleSmartSelect(count)}
            onOpenBook={() => router.push(ROUTES.book)}
            onOpenFlip={() => router.push(ROUTES.flip)}
            onBatchTags={() => setBatchTagsOpen(true)}
        />

        <PhotoGrid
          photos={filteredPhotos}
          filter={filter}
          previews={previews}
          coverPhotoId={project.coverPhotoId}
          view={view}
          columns={columns}
          onToggleSelect={(id) => void handleToggleSelect(id)}
          onEdit={(id) => setEditingPhotoId(id)}
          onRetry={(id) => void handleRetry(id)}
          onDelete={(id) => void handleDelete(id)}
          onSetCover={(id) => void handleSetCover(id)}
          onReorder={(ids) => void handleReorder(ids)}
          onScore={handleScore}
        />
      </main>

      <StatusBar
        total={stats.total}
        success={stats.success}
        failed={stats.failed}
        processing={stats.processing}
        selected={stats.selected}
        progressValue={batchStatus.total > 0 ? (batchStatus.done / batchStatus.total) * 100 : 0}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) void loadGenSettings();
        }}
      />

      {/* 0.4.2：导出前体检 */}
      <AlertDialog open={preflightOpen} onOpenChange={setPreflightOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preflight.ok ? '可以导出了' : '导出前还有几件事'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              共 {preflight.total} 张，{preflight.ready} 张已就绪。
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="grid gap-1.5 text-[13px]">
            <PreflightRow
              ok={preflight.missingText === 0}
              label={preflight.missingText === 0 ? '全部照片都有文案' : `${preflight.missingText} 张还没有文案`}
              action={
                preflight.missingText > 0 && (
                  <button
                    type="button"
                    className="text-[11px] underline underline-offset-2 hover:text-ink"
                    onClick={() => {
                      setPreflightOpen(false);
                      toast('已筛选未生成的照片', { description: '勾选后点「批量生成」即可' });
                    }}
                  >
                    去看看
                  </button>
                )
              }
            />
            <PreflightRow
              ok={preflight.failed === 0}
              label={preflight.failed === 0 ? '没有识别失败的照片' : `${preflight.failed} 张识别失败`}
            />
            <PreflightRow
              ok={preflight.missingScore === 0}
              label={
                preflight.missingScore === 0
                  ? '都有评分'
                  : `${preflight.missingScore} 张还没评分（不影响导出）`
              }
            />
            <PreflightRow
              ok={preflight.hasCover}
              label={preflight.hasCover ? '已设置封面' : '未设置封面，导出时会用第一张'}
            />
          </div>

          {/* 0.5.0：成书体量预估——导出前先知道大概多厚，避免打出来才发现只有 6 页 */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-line/60 bg-surface-2/50 px-3 py-2.5 text-center">
            <div>
              <div className="text-[17px] font-semibold tabular-nums text-ink">{estimate.photos}</div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">入选照片</div>
            </div>
            <div>
              <div className="text-[17px] font-semibold tabular-nums text-ink">
                {estimate.words.toLocaleString()}
              </div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">正文字数</div>
            </div>
            <div>
              <div className="text-[17px] font-semibold tabular-nums text-ink">{estimate.pages}</div>
              <div className="mt-0.5 text-[10.5px] text-ink-faint">预估页数</div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>返回修改</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPreflightOpen(false);
                setExportOpen(true);
              }}
            >
              继续导出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 0.4.0：批量删除二次确认 */}
      <AlertDialog open={deleteMode !== null} onOpenChange={(v) => !v && setDeleteMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteMode === 'all' ? '把本项目全部照片移到回收站？' : '把所选照片移到回收站？'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              共{' '}
              {deleteMode === 'all' ? photos.length : photos.filter((p) => p.selected).length}{' '}
              张照片会移到回收站，随时能恢复；要彻底清掉图片文件，请到「回收站」里删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const mode = deleteMode;
                setDeleteMode(null);
                if (mode) void handleDeleteBatch(mode);
              }}
            >
              移到回收站
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        project={project}
        photos={photos}
        selectedPhotos={exportPhotos}
      />
      <BatchTagsDialog
        open={batchTagsOpen}
        onOpenChange={setBatchTagsOpen}
        photos={photos.filter((p) => p.selected)}
        onDone={() => {
          void PhotoRepository.listByProject(projectId).then(setPhotos);
        }}
      />
      <PhotoEditorSheet
        photo={editingPhoto}
        previewUrl={editingPhoto ? previews[editingPhoto.id] : undefined}
        onClose={() => setEditingPhotoId(null)}
        onSaved={(updated) => {
          setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
          setEditingPhotoId(null);
        }}
      />
    </div>
  );
}

/** 体检项：一行状态 + 可选操作 */
function PreflightRow({
  ok,
  label,
  action,
}: {
  ok: boolean;
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/60 bg-surface/60 px-2.5 py-1.5">
      <span
        className={
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-paper ' +
          (ok ? 'bg-emerald-600' : 'bg-amber-500')
        }
      >
        {ok ? '✓' : '!'}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-mid">{label}</span>
      {action}
    </div>
  );
}