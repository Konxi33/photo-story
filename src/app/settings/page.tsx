// src/app/settings/page.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug,
  Check,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Loader2,
  Maximize2,
  Palette,
  RotateCw,
  Sparkles,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
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
import {
  AI_PRESETS,
  API_ROUTES,
  APP_NAME,
  APP_VERSION,
  DEFAULT_APP_SETTINGS,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_RETRIES,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT_MS,
  MAX_CONCURRENCY,
  MAX_TIMEOUT_MS,
  MIN_CONCURRENCY,
  MIN_TIMEOUT_MS,
  STORAGE_KEY_APP_SETTINGS,
} from '@/config/app';
import {
  NARRATIVE_STYLES,
  STORY_LENGTHS,
  TITLE_STYLES,
  getNarrativeStyle,
  getStoryLength,
  getTitleStyle,
} from '@/config/styles';
import { KvRepository } from '@/lib/db';
import { FRAME_PRESETS } from '@/lib/export/frame';
import { LAYOUT_PRESETS } from '@/lib/export/layout';
import { applyAppearance, readStoredAppearance } from '@/lib/appearance';
import {
  checkForUpdate,
  clearPendingUpdate,
  describeSize,
  downloadAndInstall,
  readPendingUpdate,
} from '@/lib/updater';
import { cn, formatBytes, withTimeout } from '@/lib/utils';
import type { UpdateInfo } from '@/lib/updater';
import type {
  AiConfigPublic,
  AiProvider,
  AppSettings,
  FontFamily,
  FrameStyle,
  ImageDetailLevel,
  NarrativeStyle,
  ReasoningLevel,
  SettingsUpdateRequest,
  StorageUsage,
  StoryLength,
  ThemeMode,
  TitleStyle,
} from '@/types/domain';

const THEMES: { id: NonNullable<AppSettings['theme']>; label: string; color: string }[] = [
  { id: 'paper', label: '纸白', color: '#fbfaf7' },
  { id: 'warm', label: '暖黄', color: '#fbf6ee' },
  { id: 'cool', label: '冷灰', color: '#f6f8fa' },
  { id: 'dark', label: '暗色', color: '#161618' },
];

const NAV_ITEMS: ReadonlyArray<readonly [string, string]> = [
  ['ai', '模型与密钥'],
  ['style', '文案风格'],
  ['gen', '生成参数'],
  ['look', '外观'],
  ['perf', '性能'],
  ['photo', '照片与相框'],
  ['start', '打开与默认'],
  ['app', '应用'],
  ['update', '版本更新'],
  ['store', '存储与导出'],
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // AI
  const [provider, setProvider] = useState<AiProvider>('deepseek');
  const [baseURL, setBaseURL] = useState('https://api.deepseek.com');
  const [model, setModel] = useState('deepseek-flash');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [keySource, setKeySource] = useState<AiConfigPublic['keySource']>('none');
  const [keyHint, setKeyHint] = useState<string | null>(null);
  const [temperature, setTemperature] = useState<number>(DEFAULT_TEMPERATURE);
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULT_MAX_TOKENS);
  const [reasoning, setReasoning] = useState<ReasoningLevel>('off');
  const [imageDetail, setImageDetail] = useState<ImageDetailLevel>('high');

  // 生成
  const [concurrency, setConcurrency] = useState<number>(DEFAULT_CONCURRENCY);
  const [timeoutSec, setTimeoutSec] = useState<number>(DEFAULT_TIMEOUT_MS / 1000);
  const [maxRetries, setMaxRetries] = useState<number>(DEFAULT_MAX_RETRIES);

  // 风格
  const [titleStyle, setTitleStyle] = useState<TitleStyle>('literary');
  const [narrativeStyle, setNarrativeStyle] = useState<NarrativeStyle>('essay');
  const [storyLength, setStoryLength] = useState<StoryLength>('medium');

  // 外观 / 照片
  const [theme, setTheme] = useState<NonNullable<AppSettings['theme']>>('paper');
  const [backgroundBlur, setBackgroundBlur] = useState(14);
  const [animations, setAnimations] = useState(true);
  // 0.6.0：这两项以前写死（1024 / 640），设置里调不到；老电脑要更小更快。
  const [aiEdge, setAiEdge] = useState(1024);
  const [previewEdge, setPreviewEdge] = useState(640);
  const [wallColumns, setWallColumns] = useState<2 | 3 | 4 | 5>(3);
  const [compressOnUpload, setCompressOnUpload] = useState(true);
  const [keepOriginal, setKeepOriginal] = useState(true);

  // 0.3.1
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [fontFamily, setFontFamily] = useState<FontFamily>('round');
  const [sidebarMode, setSidebarMode] = useState<'always' | 'hover'>('always');
  const [scoreEngine, setScoreEngine] = useState<'ai' | 'local'>('ai');
  const [glass, setGlass] = useState(false);
  const [glassBlur, setGlassBlur] = useState(24);
  const [galleryColumns, setGalleryColumns] = useState<3 | 4 | 5 | 6>(4);
  const [gallerySort, setGallerySort] = useState<'added' | 'taken'>('added');
  const [defaultFrame, setDefaultFrame] = useState<FrameStyle>('none');

  // 0.5.4：固定的导出目录（导出时不再每次都弹保存框）
  const [exportDir, setExportDir] = useState('');
  const [revealAfterExport, setRevealAfterExport] = useState(true);

  // 0.6.1：打开软件先落在哪、排版台默认用哪套模板
  const [startPage, setStartPage] = useState<'home' | 'projects' | 'keep'>('home');
  const [defaultLayoutPreset, setDefaultLayoutPreset] = useState('photobook');

  // 0.5.7：版本更新
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateResult, setUpdateResult] = useState<{
    ok: boolean;
    info?: UpdateInfo;
    error?: string;
  } | null>(null);
  const [updateDownloading, setUpdateDownloading] = useState(false);
  /** -1 = 服务端没给文件大小，只能显示「下载中」 */
  const [updateProgress, setUpdateProgress] = useState(-1);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateNotesOpen, setUpdateNotesOpen] = useState(false);

  const [dataDir, setDataDir] = useState('');
  const [zoom, setZoom] = useState(1);
  const [uninstallOpen, setUninstallOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('ai');
  const [desktopVersions, setDesktopVersions] = useState<{ electron: string; chrome: string }>({
    electron: '—',
    chrome: '—',
  });
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  // 读取当前窗口缩放与 Electron 版本（仅桌面端有；SSR 阶段不能碰 window）
  useEffect(() => {
    const api = window.photoStory;
    if (api) {
      setDesktopVersions({ electron: api.versions.electron, chrome: api.versions.chrome });
    }
    void api?.getZoom?.().then((value) => {
      if (typeof value === 'number') setZoom(value);
    });
  }, []);

  // 0.5.7：上次检查留下过「有新版本」的记录（比如启动时 toast 提示过），进本页先显示出来
  useEffect(() => {
    const pending = readPendingUpdate();
    if (pending) setUpdateResult({ ok: true, info: pending });
  }, []);

  // 外观开关实时预览：不用保存也能看到主题/玻璃/字体效果
  useEffect(() => {
    if (loading) return;
    applyAppearance({
      darkMode: themeMode === 'dark',
      themeMode,
      glass,
      glassBlur,
      fontFamily,
    });
  }, [themeMode, glass, glassBlur, fontFamily, loading]);

  /**
   * 0.7.1：选了「跟随系统」之后，系统在浅色/深色之间切换要立刻生效。
   * 原来只在切换选项的那一刻读一次 prefers-color-scheme，系统真变了界面不动，
   * 用户看到的就是「跟随系统好像没用」。
   */
  useEffect(() => {
    if (themeMode !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => {
      applyAppearance({ darkMode: false, themeMode: 'system', glass, glassBlur, fontFamily });
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themeMode, glass, glassBlur, fontFamily]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(API_ROUTES.settings, { cache: 'no-store' });
        const data = (await res.json()) as AiConfigPublic;
        setProvider(data.provider);
        setBaseURL(data.baseURL);
        setModel(data.model);
        setTemperature(data.temperature);
        setMaxTokens(data.maxTokens);
        setReasoning(data.reasoning);
        setImageDetail(data.imageDetail);
        setHasKey(data.hasKey);
        setKeyHint(data.keyHint);
        setKeySource(data.keySource);
      } catch {
        // 保持默认
      }

      try {
        const saved =
          (await withTimeout(
            KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS),
            3000,
            null,
          )) ?? null;
        const s = { ...DEFAULT_APP_SETTINGS, ...(saved ?? {}) } as AppSettings;
        // 0.6.4：旧版本存过 50，现在上限是 4（要留连接给界面），显示时直接压回来
        setConcurrency(Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, s.concurrency)));
        setTimeoutSec(Math.round(s.timeoutMs / 1000));
        setMaxRetries(s.maxRetries);
        setAiEdge(s.aiImageMaxEdge ?? 1024);
        setPreviewEdge(s.previewMaxEdge ?? 640);
        setTitleStyle(s.titleStyle ?? 'literary');
        setNarrativeStyle(s.narrativeStyle ?? 'essay');
        setStoryLength(s.storyLength ?? 'medium');
        setTheme(s.theme ?? 'paper');
        setBackgroundBlur(s.backgroundBlur ?? 14);
        setAnimations(s.animations ?? true);
        setWallColumns(s.wallColumns ?? 3);
        setCompressOnUpload(s.compressOnUpload ?? true);
        setKeepOriginal(s.keepOriginal ?? true);
        // 0.7.1：外观四项（主题/玻璃/模糊/字体）以 localStorage 为准。
        // 设置页的实时预览写的就是 localStorage；如果这里再拿 kv 的旧值覆盖 state，
        // 预览效果会被「上一次保存的值」冲掉，看起来就是「改了不生效」。
        const storedAppearance = readStoredAppearance();
        const hasStoredAppearance =
          typeof window !== 'undefined' && window.localStorage.getItem('ps:appearance') !== null;
        setThemeMode(
          hasStoredAppearance
            ? storedAppearance.themeMode
            : (s.themeMode ?? (s.darkMode ? 'dark' : 'system')),
        );
        setFontFamily(hasStoredAppearance ? storedAppearance.fontFamily : (s.fontFamily ?? 'round'));
        setGlass(hasStoredAppearance ? storedAppearance.glass : (s.glass ?? false));
        setGlassBlur(hasStoredAppearance ? storedAppearance.glassBlur : (s.glassBlur ?? 24));
        setSidebarMode(s.sidebarMode ?? 'always');
        setScoreEngine(s.scoreEngine ?? 'ai');
        setGalleryColumns(s.galleryColumns ?? 4);

        setGallerySort(s.gallerySort ?? 'added');
        setDefaultFrame(s.defaultFrame ?? 'none');
        setExportDir(s.exportDir ?? '');
        setRevealAfterExport(s.revealAfterExport !== false);
        setAutoCheckUpdates(s.autoCheckUpdates !== false);
        setStartPage(s.startPage ?? 'home');
        setDefaultLayoutPreset(s.defaultLayoutPreset ?? 'photobook');
      } catch {
        // 忽略
      }

      try {
        const sys = (await fetch('/api/system', { cache: 'no-store' }).then((r) => r.json())) as {
          dataDir?: string;
        };
        setDataDir(sys.dataDir ?? '');
      } catch {
        // 忽略
      }

      // 表单已经可用，先解除禁用；存储统计慢不影响设置
      setLoading(false);

      try {
        const mod = await import('@/lib/storage/usage');
        setUsage(await mod.getStorageUsage());
      } catch {
        // 忽略
      }
    })();
  }, []);

  /**
   * 0.5.0：未保存提示。
   *
   * 所有设置项拼成一条指纹，加载完成时记一次基线，之后指纹变了就是「有改动」。
   * 这样不必给三十多个 setState 逐个加 dirty 标记。
   */
  const signature = useMemo(
    () =>
      JSON.stringify({
        provider,
        baseURL,
        model,
        apiKey,
        temperature,
        maxTokens,
        reasoning,
        imageDetail,
        concurrency,
        timeoutSec,
        maxRetries,
        aiEdge,
        previewEdge,
        titleStyle,
        narrativeStyle,
        storyLength,
        theme,
        backgroundBlur,
        animations,
        wallColumns,
        compressOnUpload,
        keepOriginal,
        themeMode,
        fontFamily,
        sidebarMode,
        scoreEngine,
        glass,
        glassBlur,
        galleryColumns,
        gallerySort,
        defaultFrame,
        exportDir,
        revealAfterExport,
        autoCheckUpdates,
        startPage,
        defaultLayoutPreset,
      }),
    [
      provider,
      baseURL,
      model,
      apiKey,
      temperature,
      maxTokens,
      reasoning,
      imageDetail,
      concurrency,
      timeoutSec,
      maxRetries,
      aiEdge,
      previewEdge,
      titleStyle,
      narrativeStyle,
      storyLength,
      theme,
      backgroundBlur,
      animations,
      wallColumns,
      compressOnUpload,
      keepOriginal,
      themeMode,
      fontFamily,
      sidebarMode,
      scoreEngine,
      glass,
      glassBlur,
      galleryColumns,
      gallerySort,
      defaultFrame,
      exportDir,
      revealAfterExport,
      autoCheckUpdates,
      startPage,
      defaultLayoutPreset,
    ],
  );

  const baselineRef = useRef<string | null>(null);

  useEffect(() => {
    if (!loading && baselineRef.current === null) baselineRef.current = signature;
  }, [loading, signature]);

  const dirty = baselineRef.current !== null && baselineRef.current !== signature;

  // 0.5.1：二级菜单跟随滚动高亮
  useEffect(() => {
    const ids = ['ai', 'style', 'gen', 'look', 'perf', 'photo', 'app', 'update', 'store'];
    const observer = new IntersectionObserver(
      (entries) => {
        const hit = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActiveSection(hit.target.id);
      },
      { rootMargin: '-72px 0px -62% 0px', threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [loading]);

  // 有未保存改动时，关窗口/刷新先拦一下
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const handleSave = async (): Promise<void> => {    setSaving(true);
    try {
      const body: SettingsUpdateRequest = {
        provider,
        baseURL: baseURL.trim(),
        model: model.trim(),
        temperature,
        reasoning,
        imageDetail,
        maxTokens: Math.min(8192, Math.max(64, Math.round(maxTokens) || DEFAULT_MAX_TOKENS)),
      };
      if (apiKey.trim()) body.apiKey = apiKey.trim();

      const res = await fetch(API_ROUTES.settings, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? 'HTTP ' + res.status);
      }

      const appSettings: AppSettings = {
        concurrency: Math.min(MAX_CONCURRENCY, Math.max(1, Math.round(concurrency) || 1)),
        timeoutMs: Math.min(120_000, Math.max(30_000, Math.round(timeoutSec) * 1000)),
        maxRetries: Math.min(3, Math.max(0, Math.round(maxRetries) || 0)),
        aiImageMaxEdge: Math.min(1600, Math.max(512, aiEdge)),
        previewMaxEdge: Math.min(1200, Math.max(320, previewEdge)),
        storageNoticeDismissed: true,
        titleStyle,
        narrativeStyle,
        storyLength,
        theme,
        backgroundBlur,
        animations,
        wallColumns,
        compressOnUpload,
        keepOriginal,
        darkMode: themeMode === 'dark',
        themeMode,
        fontFamily,
        sidebarMode,
        scoreEngine,
        glass,
        glassBlur,
        galleryColumns,
        gallerySort,
        defaultFrame,
        exportDir,
        revealAfterExport,
        autoCheckUpdates,
        startPage,
        defaultLayoutPreset,
      };
      await KvRepository.set(STORAGE_KEY_APP_SETTINGS, appSettings);

      /*
       * 0.7.2：通知外壳「设置变了」。
       * AppShell 是每个页面各挂一份、只在挂载时读一次 kv 的，所以以前改完
       * 「功能栏悬浮展开」必须切一次页面才生效（用户反馈的原话）。
       * 这里把完整设置派发出去，外壳立刻重渲染，界面马上变。
       */
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ps:settings-saved', { detail: appSettings }));
      }

      const fresh = (await fetch(API_ROUTES.settings, { cache: 'no-store' }).then((r) =>
        r.json(),
      )) as AiConfigPublic;
      setHasKey(fresh.hasKey);
      setKeyHint(fresh.keyHint);
      setApiKey('');

      toast.success('设置已保存', { description: '风格与外观立即生效' });
      // 清空基线，等下一次渲染按新值重新打点（apiKey 输入框会被清空，直接比对会一直 dirty）
      baselineRef.current = null;
    } catch (error) {
      toast.error('保存失败', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  // 0.5.4：选一个固定的导出文件夹
  const pickExportDir = async (): Promise<void> => {
    const api = window.photoStory;
    if (!api?.chooseDirectory) {
      toast('当前不在桌面应用内', { description: '导出时会由浏览器保存到下载目录' });
      return;
    }
    const result = await api.chooseDirectory(exportDir);
    if (!result?.ok || !result.path) return;
    setExportDir(result.path);
    toast.success('已选定导出文件夹', { description: '记得点右上角保存设置' });
  };

  const openDataDir = async (): Promise<void> => {    const api = window.photoStory;
    if (!api) {
      toast('当前不在桌面应用内', { description: '位置：' + (dataDir || '未知') });
      return;
    }
    const paths = await api.getPaths();
    const result = await api.openPath(paths.dataDir);
    if (!result.ok) toast.error('打开失败', { description: result.message });
  };

  // 0.5.7：手动检查更新（force=true 跳过 1 小时节流）
  const handleCheckUpdate = async (): Promise<void> => {
    setUpdateChecking(true);
    setUpdateInstalling(false);
    setUpdateNotesOpen(false);
    const result = await checkForUpdate(true);
    setUpdateResult(result);
    setUpdateChecking(false);

    if (!result.ok) {
      toast.error('检查更新失败', { description: result.error });
      return;
    }
    if (result.info?.hasUpdate) {
      toast.success('发现新版本 v' + result.info.latest, {
        description: '可以在这里直接下载并安装',
      });
    } else {
      toast.success('已是最新版本', { description: '当前 v' + (result.info?.current ?? APP_VERSION) });
    }
  };

  // 0.5.7：下载 → 自动拉起安装程序 → 应用退出
  const handleDownloadAndInstall = async (info: UpdateInfo): Promise<void> => {
    setUpdateDownloading(true);
    setUpdateProgress(-1);
    const result = await downloadAndInstall(info, (progress) => {
      setUpdateProgress(
        progress.total > 0
          ? Math.min(100, Math.round((progress.received / progress.total) * 100))
          : -1,
      );
    });
    setUpdateDownloading(false);

    if (!result.ok) {
      toast.error('下载或安装失败', { description: result.error });
      return;
    }

    setUpdateInstalling(true);
    clearPendingUpdate();
    toast.success('安装程序已启动', { description: '软件会退出，请按安装向导完成更新' });
  };

  // ok 且有 info 时抽出「当前展示的更新信息」，避免 JSX 里反复写 updateResult?.info
  const pendingInfo = updateResult?.ok ? updateResult.info : undefined;

  return (
    <AppShell
      actions={
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="hidden text-[11px] text-amber-600 sm:inline dark:text-amber-400">
              有改动未保存
            </span>
          )}
          <Button
            size="sm"
            className="ps-pressable"
            onClick={() => void handleSave()}
            disabled={saving || loading}
            title={dirty ? '有改动还没保存' : '已是最新'}
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            保存设置{dirty ? ' •' : ''}
          </Button>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-5xl px-5 py-9 md:px-8">
        <p className="ps-eyebrow">Settings</p>
        <h1 className="ps-display mt-2 text-[30px] text-ink sm:text-[34px]">设置</h1>
        <p className="mt-2 text-[13px] text-ink-mid">
          {APP_NAME} v{APP_VERSION} · 所有配置只保存在本机
        </p>

        {/* 二级菜单：跳到对应分组。
            0.3.5：不用 href="#id"——改 hash 会让浏览器做一次锚点滚动，
            在带 sticky 导航与转场容器的布局里会横向抖一下。改成手动 scrollIntoView。
            0.5.1：横向滚动 + 两端渐隐 + 当前分组高亮（IntersectionObserver）。 */}
        <nav className="ps-edge-fade ps-no-scrollbar sticky top-0 z-10 -mx-1 mt-5 mb-1 flex gap-1.5 overflow-x-auto px-1 py-2 backdrop-blur-sm lg:hidden">
          {NAV_ITEMS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                const target = document.getElementById(id);
                target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={cn(
                'ps-pressable shrink-0 rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap transition-all duration-[240ms] ease-[var(--ease-out)]',
                activeSection === id
                  ? 'border-ink/15 bg-ink text-paper shadow-[0_1px_3px_rgba(0,0,0,0.18)]'
                  : 'border-line/60 bg-surface-2/60 text-ink-mid hover:border-ink/20 hover:bg-surface hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </nav>

        {/* 0.7.3：宽屏把分组导航搬到左边常驻，右侧正文变宽，滚动时也知道自己在哪一节 */}
        <div className="mt-5 grid gap-8 lg:grid-cols-[176px_minmax(0,1fr)]">
          <nav className="hidden lg:block" aria-label="设置分组">
            <div className="sticky top-6 flex flex-col border-l border-line/60 pl-3">
              {NAV_ITEMS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    const target = document.getElementById(id);
                    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  aria-current={activeSection === id ? 'true' : undefined}
                  className={cn(
                    '-ml-3 rounded-r-md border-l-2 py-1.5 pr-2 pl-3 text-left text-[12.5px] transition-colors duration-200',
                    activeSection === id
                      ? 'border-copper font-medium text-ink'
                      : 'border-transparent text-ink-faint hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </nav>

          <div className="min-w-0">
        {/* 模型 */}
        <Section id="ai" icon={<Sparkles className="h-4 w-4" />} title="模型与密钥" desc="兼容 OpenAI 协议的视觉模型服务">
          <Field label="服务商">
            <Segmented
              block
              ariaLabel="服务商"
              value={provider}
              onChange={(id) => {
                const preset = AI_PRESETS[id as keyof typeof AI_PRESETS];
                setProvider(id as typeof provider);
                if (preset) {
                  setBaseURL(preset.baseURL);
                  setModel(preset.model);
                  setMaxTokens(preset.maxTokens);
                }
              }}
              options={[
                ...(Object.keys(AI_PRESETS) as Array<keyof typeof AI_PRESETS>).map((id) => ({
                  value: id as string,
                  label: AI_PRESETS[id].label,
                })),
                { value: 'custom', label: '自定义' },
              ]}
            />
            <p className="text-[11px] text-ink-faint">
              {provider === 'deepseek'
                ? 'deepseek-flash 支持图片输入；按 token 计费，关闭思考最省。'
                : provider === 'zhipu'
                  ? 'glm-4v-flash 免费视觉，但输出上限 1024 token。'
                  : '任意兼容 OpenAI Chat Completions 且支持图片的服务。'}
            </p>
          </Field>

          <Field label="评分方式">
            <Segmented
              block
              ariaLabel="评分方式"
              value={scoreEngine}
              onChange={(id) => setScoreEngine(id)}
              options={[
                { value: 'ai', label: 'AI 评分', title: '看内容与审美，需要联网与密钥' },
                {
                  value: 'local',
                  label: '本地像素评分',
                  title: '只看曝光/清晰度/色彩，离线可用',
                },
              ]}
            />
            <p className="text-[11px] text-ink-faint">
              本地像素评分不调用 AI，适合先批量筛一遍；审美判断仍建议用 AI。
            </p>
          </Field>

          <Field label="Base URL">
            <Input value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com" />
          </Field>
          <Field label="模型名">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-flash" />
          </Field>
          <Field label="API Key">
            <div className="flex gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={hasKey ? '已配置 ' + (keyHint ?? '') + '，留空则不修改' : 'sk-...'}
                autoComplete="off"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setShowKey((v) => !v)} aria-label="显示密钥">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={'温度 ' + temperature.toFixed(2)}>
              <Slider min={0} max={1} step={0.05} value={[temperature]} onValueChange={(v) => setTemperature(v[0] ?? temperature)} />
            </Field>
            <Field label="最大输出 tokens">
              <Input type="number" min={64} max={8192} value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="推理强度">
              <Select value={reasoning} onValueChange={(v) => setReasoning(v as ReasoningLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">关闭 · 最省钱</SelectItem>
                  <SelectItem value="low">低 · 推荐</SelectItem>
                  <SelectItem value="high">高 · 最准最贵</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="图片精度">
              <Select value={imageDetail} onValueChange={(v) => setImageDetail(v as ImageDetailLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">原图 · 识别准</SelectItem>
                  <SelectItem value="low">512px · 更省 token</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            推理强度只在 DeepSeek 上生效：关闭最便宜（批量生成够用），评分建议用「低」；
            「高」会明显增加输出 token。图片按尺寸折算 token（单张封顶约 1024），
            精度选「原图」识别更准，代价是每张多几百 token。
          </p>
          <p className={cn('text-xs', hasKey ? 'text-emerald-700' : 'text-amber-700')}>
            {hasKey
              ? '密钥已就绪（' +
                (keyHint ?? '') +
                (keySource === 'builtin' ? ' · 内置密钥，开箱即用' : '') +
                '）'
              : '尚未配置密钥，生成前请先填写'}
          </p>
        </Section>

        {/* 文案风格 */}
        <Section id="style" icon={<Palette className="h-4 w-4" />} title="文案风格" desc="决定 AI 给你什么样的标题和叙事">
          <Field label="标题风格">
            <Select value={titleStyle} onValueChange={(v) => setTitleStyle(v as TitleStyle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TITLE_STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label} · {s.note}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-ink-faint">{getTitleStyle(titleStyle).hint}</p>
          </Field>

          <Field label="叙事风格">
            <Select value={narrativeStyle} onValueChange={(v) => setNarrativeStyle(v as NarrativeStyle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {NARRATIVE_STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label} · {s.note}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-ink-faint">{getNarrativeStyle(narrativeStyle).hint}</p>
          </Field>

          <Field label="故事字数">
            <Select value={storyLength} onValueChange={(v) => setStoryLength(v as StoryLength)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STORY_LENGTHS.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-ink-faint">
              目标 {getStoryLength(storyLength).min}–{getStoryLength(storyLength).max} 字
            </p>
          </Field>
        </Section>

        {/* 生成参数 */}
        <Section id="gen" title="生成参数" desc="影响批量识别的速度与稳定性">
          <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-[11.5px] text-ink-soft">
            并发数上限是 {MAX_CONCURRENCY}：识别请求都打在本机服务上，压太满会把界面自己要用的连接抢光，页面就点不动了。
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="并发数">
              <Select value={String(concurrency)} onValueChange={(v) => setConcurrency(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: MAX_CONCURRENCY }, (_, i) => i + MIN_CONCURRENCY).map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="单张超时（秒）">
              <Input
                type="number"
                min={MIN_TIMEOUT_MS / 1000}
                max={MAX_TIMEOUT_MS / 1000}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value))}
              />
            </Field>
            <Field label="最大重试">
              <Select value={String(maxRetries)} onValueChange={(v) => setMaxRetries(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </Section>

        {/* 外观 */}
        <Section id="look" title="外观" desc="主题、字体、玻璃材质与动效">
          <Field label="主题模式">
            <Segmented
              block
              ariaLabel="主题模式"
              value={themeMode}
              onChange={(id) => setThemeMode(id)}
              options={[
                { value: 'system', label: '跟随系统', title: '跟随 Windows 的深色/浅色自动切换' },
                { value: 'light', label: '浅色', title: '始终使用纸白界面' },
                { value: 'dark', label: '深色', title: '始终使用深色界面' },
              ]}
            />
            <p className="text-[11px] text-ink-faint">
              选「跟随系统」后，Windows 切换深色/浅色时软件会自动跟着变，原生标题栏也同步。
            </p>
          </Field>

          <Field label="字体">
            <Segmented
              block
              ariaLabel="字体"
              value={fontFamily}
              onChange={(id) => setFontFamily(id)}
              options={[
                { value: 'round', label: '圆润', title: 'MiSans / 苹方 / 微软雅黑，笔画更圆（推荐）' },
                { value: 'system', label: '系统默认', title: '不指定字体，用系统 UI 字体' },
                { value: 'song', label: '宋体', title: '传统衬线，笔画细、偏旧' },
              ]}
            />
          </Field>

          <Field label="左侧功能栏">
            <Segmented
              block
              ariaLabel="左侧功能栏"
              value={sidebarMode}
              onChange={(id) => setSidebarMode(id)}
              options={[
                { value: 'always', label: '一直展开', title: '固定占位，内容区在右侧' },
                { value: 'hover', label: '悬浮展开', title: '平时收起，鼠标贴左边缘时覆盖弹出' },
              ]}
            />
            <p className="text-[11px] text-ink-faint">
              选「悬浮展开」后功能栏不再占位，鼠标移到窗口左边缘会滑出，移开自动收起。
            </p>
          </Field>

          <Row label="玻璃材质" desc="面板变成磨砂玻璃，背景隐约透出但文字清晰">
            <Switch aria-label="玻璃材质" checked={glass} onCheckedChange={setGlass} />
          </Row>

          <Field label={`玻璃模糊强度 ${glassBlur}px`}>
            <Slider
              min={8}
              max={48}
              step={2}
              value={[glassBlur]}
              onValueChange={(v) => setGlassBlur(v[0] ?? glassBlur)}
            />
          </Field>
          <p className="-mt-2 text-[11px] text-ink-faint">
            数值越大越「毛」，背景越虚、文字越清楚；16–24 比较通透，32 以上接近厚玻璃。
          </p>

          <Field label="背景主题">
            <div className="flex flex-wrap gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTheme(t.id)}
                  className={cn(
                    'ps-pressable flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
                    theme === t.id ? 'border-ink text-ink' : 'border-line text-ink-mid',
                  )}
                >
                  <span className="h-4 w-4 rounded-full border border-line" style={{ backgroundColor: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label={'背景动态模糊 ' + backgroundBlur + 'px'}>
            <Slider min={0} max={32} step={2} value={[backgroundBlur]} onValueChange={(v) => setBackgroundBlur(v[0] ?? backgroundBlur)} />
          </Field>

          <Row label="界面动效" desc="卡片淡入、面板回弹、点击缩放">
            <Switch aria-label="界面动效" checked={animations} onCheckedChange={setAnimations} />
          </Row>
        </Section>

        {/* 性能（0.6.0 新增：这两项以前写死，老电脑调不动） */}
        <Section id="perf" title="性能" desc="老电脑把这几个数值调小会明显更快">
          <Field label="传给 AI 的图片长边">
            <Select value={String(aiEdge)} onValueChange={(v) => setAiEdge(Number(v))}>
              <SelectTrigger className="w-[168px]" aria-label="传给 AI 的图片长边">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="768">768 px（最快）</SelectItem>
                <SelectItem value="1024">1024 px（默认）</SelectItem>
                <SelectItem value="1280">1280 px（更准）</SelectItem>
                <SelectItem value="1600">1600 px（最慢）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              越大识别越细，也越慢、越费 token。1920 宽的照片按 1024 送去已经够用。
            </p>
          </Field>
          <Field label="本地缩略图长边">
            <Select value={String(previewEdge)} onValueChange={(v) => setPreviewEdge(Number(v))}>
              <SelectTrigger className="w-[168px]" aria-label="本地缩略图长边">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="480">480 px（省内存）</SelectItem>
                <SelectItem value="640">640 px（默认）</SelectItem>
                <SelectItem value="800">800 px（更清晰）</SelectItem>
                <SelectItem value="960">960 px（最清晰）</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-ink-faint">
              照片墙、评分卡、排版台都用这档缩略图。只影响之后上传的照片，已有的不受影响。
            </p>
          </Field>
        </Section>

        {/* 照片 */}
        <Section id="photo" title="照片、压缩与相框" desc="上传策略、照片库默认值与导出相框">
          <Row label="上传时压缩" desc="生成 640/1024/1800 三档派生图用于预览与识别">
            <Switch aria-label="上传时压缩" checked={compressOnUpload} onCheckedChange={setCompressOnUpload} />
          </Row>
          <Row label="保留原图" desc="关闭后只保留派生图，可省大量空间但无法超清导出">
            <Switch aria-label="保留原图" checked={keepOriginal} onCheckedChange={setKeepOriginal} />
          </Row>
          <Field label="照片墙列数">
            <Select value={String(wallColumns)} onValueChange={(v) => setWallColumns(Number(v) as 2 | 3 | 4 | 5)}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n} 列</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="照片库默认列数">
              <Select
                value={String(galleryColumns)}
                onValueChange={(v) => setGalleryColumns(Number(v) as 3 | 4 | 5 | 6)}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[3, 4, 5, 6].map((n) => <SelectItem key={n} value={String(n)}>{n} 列</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>

            <Field label="照片库默认排序">
              <Select
                value={gallerySort}
                onValueChange={(v) => setGallerySort(v as 'added' | 'taken')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="added">添加时间</SelectItem>
                  <SelectItem value="taken">拍摄时间</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="导出默认相框">
            <Select value={defaultFrame} onValueChange={(v) => setDefaultFrame(v as FrameStyle)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {FRAME_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.label} · {preset.note}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Section>

        {/* 应用 */}
        <Section id="start" title="打开与默认" desc="打开软件先看到什么、排版台默认用哪套版式">
          <Field label="打开软件先落在">
            <Segmented
              block
              ariaLabel="打开软件先落在"
              value={startPage}
              onChange={(id) => setStartPage(id)}
              options={[
                { value: 'home', label: '主菜单', title: '先看整本软件的封面与入口' },
                { value: 'projects', label: '项目', title: '直接进项目列表，适合天天干活' },
                { value: 'keep', label: '上次的页面', title: '从哪走的就从哪回来' },
              ]}
            />
          </Field>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            「上次的页面」只记路由，不会恢复未保存的操作。
          </p>
          <Field label="排版台默认版式">
            <Select value={defaultLayoutPreset} onValueChange={setDefaultLayoutPreset}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LAYOUT_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            只在「这个项目还没存过版式」时生效；存过之后就以项目里那套为准。
          </p>
        </Section>

        <Section id="app" title="应用" desc="原来顶部菜单里的刷新、缩放、开发者工具都收在这里">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="outline"
              className="ps-pressable justify-start"
              onClick={() => void window.photoStory?.reload?.()}
            >
              <RotateCw className="mr-2 h-4 w-4" />
              重新加载界面
            </Button>
            <Button
              variant="outline"
              className="ps-pressable justify-start"
              onClick={() => void window.photoStory?.toggleDevTools?.()}
            >
              <Bug className="mr-2 h-4 w-4" />
              开发者工具
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="ps-pressable flex-1 justify-start"
                onClick={() => void window.photoStory?.setZoom?.(Math.max(0.6, zoom - 0.1)).then(setZoom)}
              >
                <ZoomOut className="mr-2 h-4 w-4" />
                缩小
              </Button>
              <span className="w-14 text-center text-xs tabular-nums text-ink-mid">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                variant="outline"
                className="ps-pressable flex-1 justify-start"
                onClick={() => void window.photoStory?.setZoom?.(Math.min(2, zoom + 0.1)).then(setZoom)}
              >
                <ZoomIn className="mr-2 h-4 w-4" />
                放大
              </Button>
            </div>
            <Button
              variant="outline"
              className="ps-pressable justify-start"
              onClick={() => void window.photoStory?.setZoom?.(1).then(setZoom)}
            >
              <Maximize2 className="mr-2 h-4 w-4" />
              恢复 100%
            </Button>
            <Button
              variant="outline"
              className="ps-pressable justify-start text-destructive hover:text-destructive"
              onClick={() => setUninstallOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              卸载照片故事
            </Button>
          </div>

          <div className="rounded-lg border border-line/60 bg-surface/50 px-3 py-2 text-[11px] leading-relaxed text-ink-faint">
            <p>
              版本 {APP_VERSION} · Electron {desktopVersions.electron} · Chrome{' '}
              {desktopVersions.chrome}
            </p>
            <p className="mt-1">
              顶部原生菜单栏已移除（它固定白底，和深色主题冲突）；刷新、缩放、开发者工具改为这里的按钮。
            </p>
          </div>
        </Section>

        {/* 版本更新（0.5.7） */}
        <Section
          id="update"
          icon={<Download className="h-4 w-4" />}
          title="版本更新"
          desc="从 GitHub Release 检查并安装新版本"
        >
          <Row
            label="启动时自动检查更新"
            desc="每次启动在后台查一次；关掉后只能用下面的按钮手动检查"
          >
            <Switch
              aria-label="启动时自动检查更新"
              checked={autoCheckUpdates}
              onCheckedChange={setAutoCheckUpdates}
            />
          </Row>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="text-[12.5px] text-ink-mid">当前版本 v{APP_VERSION}</span>
            <Button
              variant="outline"
              size="sm"
              className="ps-pressable"
              disabled={updateChecking || updateDownloading}
              onClick={() => void handleCheckUpdate()}
            >
              {updateChecking ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-1.5 h-4 w-4" />
              )}
              {updateChecking ? '检查中…' : '检查更新'}
            </Button>
          </div>

          {updateResult && !updateResult.ok && (
            <p className="text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-400">
              检查失败：{updateResult.error ?? '未知原因'}
            </p>
          )}

          {updateResult?.ok && updateResult.info && !updateResult.info.hasUpdate && (
            <p className="text-[11.5px] text-emerald-700 dark:text-emerald-400">
              已是最新版本 v{updateResult.info.current}
            </p>
          )}

          {pendingInfo && pendingInfo.hasUpdate && (
            <div className="grid gap-2.5 rounded-lg border border-line/60 bg-surface/50 p-3">
              <p className="text-[12.5px] text-ink">
                有新版本 v{pendingInfo.latest}
                {pendingInfo.publishedAt && (
                  <span className="ml-1.5 text-[11px] text-ink-faint">
                    · 发布于 {formatPublishDate(pendingInfo.publishedAt)}
                  </span>
                )}
              </p>

              {pendingInfo.assetName && (
                <p className="text-[11.5px] text-ink-faint">
                  安装包 {pendingInfo.assetName} · {describeSize(pendingInfo.assetSize)}
                </p>
              )}

              {pendingInfo.notes && (
                <div className="grid gap-1.5">
                  <button
                    type="button"
                    className="ps-pressable w-fit text-[11.5px] text-ink-mid underline decoration-line/70 underline-offset-2 hover:text-ink"
                    onClick={() => setUpdateNotesOpen((open) => !open)}
                  >
                    {updateNotesOpen ? '收起更新说明' : '查看更新说明'}
                  </button>
                  {updateNotesOpen && (
                    <pre className="max-h-64 overflow-auto rounded-md border border-line/50 bg-surface-2/40 p-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-mid">
                      {pendingInfo.notes}
                    </pre>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  className="ps-pressable"
                  disabled={updateDownloading || updateInstalling}
                  onClick={() => {
                    if (pendingInfo) void handleDownloadAndInstall(pendingInfo);
                  }}
                >
                  {updateDownloading ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-1.5 h-4 w-4" />
                  )}
                  {updateDownloading ? '下载中…' : '下载并安装'}
                </Button>
                {updateDownloading && (
                  <span className="text-[11.5px] tabular-nums text-ink-mid">
                    {updateProgress >= 0 ? '已下载 ' + updateProgress + '%' : '正在下载安装包…'}
                  </span>
                )}
                {updateInstalling && (
                  <span className="text-[11.5px] text-emerald-700 dark:text-emerald-400">
                    安装程序已启动，软件会退出
                  </span>
                )}
              </div>

              {!pendingInfo.assetUrl && (
                <p className="text-[11.5px] text-ink-faint">
                  这个版本没上传安装包，只能去 GitHub Releases 手动下载。
                </p>
              )}
            </div>
          )}
        </Section>

        {/* 存储 */}
        <Section id="store" title="存储与导出" desc="数据位置、导出文件夹与占用">
          <Field label="导出文件夹">
            <div className="flex gap-2">
              <Input readOnly value={exportDir || '（未设置：每次导出时由系统询问）'} />
              <Button
                variant="outline"
                onClick={() => void pickExportDir()}
                className="ps-pressable shrink-0"
              >
                <FolderOpen className="mr-1.5 h-4 w-4" />
                选择
              </Button>
            </div>
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            {exportDir ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ps-pressable"
                  onClick={() => void window.photoStory?.openPath?.(exportDir)}
                >
                  打开文件夹
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ps-pressable text-ink-faint"
                  onClick={() => setExportDir('')}
                >
                  改为每次询问
                </Button>
              </>
            ) : (
              <p className="text-[11.5px] text-ink-faint">
                固定一个文件夹后，导出成书会直接写进去，不再弹保存框；同名文件自动加序号，不会覆盖上一版。
              </p>
            )}
          </div>
          <Row label="导出后定位文件" desc="导出完成后在资源管理器里选中刚生成的文件">
            <Switch
              aria-label="导出后定位文件"
              checked={revealAfterExport}
              onCheckedChange={setRevealAfterExport}
            />
          </Row>
          <Field label="数据目录">
            <div className="flex gap-2">
              <Input readOnly value={dataDir || '（仅桌面应用内可见）'} />
              <Button variant="outline" onClick={() => void openDataDir()} className="ps-pressable">
                <FolderOpen className="mr-1.5 h-4 w-4" />
                打开
              </Button>
            </div>
          </Field>
          <p className="text-xs text-ink-faint">
            {usage && usage.quota > 0
              ? '已用 ' + formatBytes(usage.usage) + ' / 可用约 ' + formatBytes(usage.quota)
              : '存储占用统计中…'}
          </p>
          <Row label="清空全部数据" desc="删除所有项目与照片，不可恢复，建议先备份">
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => toast.error('为安全起见已禁用', { description: '请在系统设置中卸载应用，或手动删除数据目录' })}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              清空
            </Button>
          </Row>
        </Section>
          </div>
        </div>
      </div>

      {/* 卸载确认 */}
      <AlertDialog open={uninstallOpen} onOpenChange={setUninstallOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>卸载照片故事？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除程序文件、快捷方式与注册表项。项目与照片保存在
              %APPDATA%\photo-story，不会被删除；如需彻底清除请手动删该目录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                void window.photoStory?.uninstall?.().then((result) => {
                  if (!result?.ok) {
                    toast.error('无法启动卸载程序', { description: result?.message });
                  }
                });
              }}
            >
              卸载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Section({
  id,
  title,
  desc,
  icon,
  children,
}: {
  id?: string;
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-t border-line/50 py-6 first:border-t-0 first:pt-0"
    >
      <div className="mb-5">
        <div className="flex items-center gap-2">
          {icon && <span className="text-ink-faint">{icon}</span>}
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        </div>
        {desc && <p className="mt-1 text-[12px] leading-relaxed text-ink-faint">{desc}</p>}
      </div>
      <div className="grid gap-4">
        {children}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:items-center sm:gap-4">
      <Label className="ps-eyebrow">{label}</Label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Row({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-[13.5px] text-ink">{label}</p>
        {desc && <p className="mt-0.5 text-[11px] text-ink-faint">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

/** 0.5.7：把 GitHub 的 ISO 时间（2026-11-01T12:00:00Z）压成「2026-11-01」 */
function formatPublishDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
