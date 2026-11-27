// src/components/app-shell.tsx
'use client';

// 应用外壳：左侧一级导航（常驻 / 悬浮 / 折叠）+ 背景装饰 + 主题 + 转场。
// 0.4.0：侧栏改为固定贴视口左侧，任何窗口宽度都不会偏移；新增折叠与滑动指示条。

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BookOpen,
  ChartLine,
  Compass,
  FlaskConical,
  Gauge,
  Gavel,
  HardDrive,
  Images,
  LayoutGrid,
  LayoutTemplate,
  Menu,
  ScrollText,
  Search,
  Settings,
  Swords,
  Trash2,
  ChevronRight,
  Monitor,
  Moon,
  Sun,
} from 'lucide-react';
import { toast } from 'sonner';

import { CommandPalette } from '@/components/command-palette';
import { ShortcutsDialog } from '@/components/shortcuts-dialog';
import { APP_NAME, APP_VERSION, ROUTES, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { moduleTagline } from '@/config/modules';
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  mirrorSidebarCookie,
  readStoredAppearance,
  resolveDark,
  type Appearance,
} from '@/lib/appearance';
import { KvRepository } from '@/lib/db';
import { applyMotion, motionEnabled, normalizeMotion, readStoredMotion } from '@/lib/motion-prefs';
import { checkForUpdate, clearPendingUpdate, readPendingUpdate } from '@/lib/updater';
import { cn, formatBytes, withTimeout } from '@/lib/utils';
import type { AppSettings, StorageUsage, ThemeMode } from '@/types/domain';

interface AppShellProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
  showTopBar?: boolean;
}

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutGrid;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: '工作区',
    items: [
      { href: '/projects', label: '项目', icon: LayoutGrid },
      { href: '/gallery', label: '照片库', icon: Images },
      { href: '/score', label: '评分', icon: Gauge },
    ],
  },
  {
    title: '创作',
    items: [
      { href: '/book', label: '编排', icon: BookOpen },
      { href: '/studio', label: '排版台', icon: LayoutTemplate },
      { href: '/lab', label: '文案', icon: FlaskConical },
      { href: '/themes', label: '主题馆', icon: Compass },
    ],
  },
  {
    title: '打磨',
    items: [
      { href: '/compare', label: '选片', icon: Swords },
      { href: '/review', label: '评审', icon: Gavel },
      { href: '/growth', label: '摄影档案', icon: ChartLine },
    ],
  },
  {
    title: '系统',
    items: [
      { href: '/trash', label: '回收站', icon: Trash2 },
      { href: '/changelog', label: '更新日志', icon: ScrollText },
    ],
  },
];

const FLAT = GROUPS.flatMap((g) => g.items);
const SETTINGS_ITEM: NavItem = { href: '/settings', label: '设置', icon: Settings };

/**
 * 记住上一次指示条的位置（模块级，跨 AppShell 重建仍有效）。
 * 没有它，每次导航侧栏重建，指示条会直接出现在新位置，永远看不到移动过程。
 */
interface IndicatorPos {
  top: number;
  height: number;
}

/**
 * 0.7.1：指示条几何 + 可见性。
 * visible=false 表示选中项被列表滚出了可视区（或高度塌成 0），
 * 这时要「藏起来」而不是画在顶栏上——用户明确要求「绝不允许错位」。
 */
interface IndicatorGeom extends IndicatorPos {
  visible: boolean;
}

let lastIndicatorValue: (IndicatorPos & { compact: boolean }) | null = null;

/**
 * 0.7.2：侧栏滚动位置。
 *
 * 每个页面各自渲染一个 <AppShell>，导航时整个侧栏卸载重建，滚动容器自然回到顶部 ——
 * 表现就是用户说的「往下滑，点一下更新日志，侧栏瞬间弹回最上面」。
 * 位置记在模块级变量里（跟指示条的 lastIndicatorValue 同一套思路），
 * 重挂载后由 SidebarContent 在测量之前恢复。
 */
let lastSidebarScroll = 0;

function readLastIndicator(compact: boolean): IndicatorPos | null {
  if (!lastIndicatorValue) return null;
  if (lastIndicatorValue.compact !== compact) return null;
  return { top: lastIndicatorValue.top, height: lastIndicatorValue.height };
}

const COLLAPSE_KEY = 'ps:sidebar-collapsed';

/** 顶栏那个太阳/月亮/显示器按钮上的说明文字 */
const THEME_CYCLE_LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppShell({ children, actions, showTopBar = true }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  /**
   * 0.8.0 修：外观状态**不要在 useState 初始化里读 localStorage**。
   *
   * 服务端渲染时 document 不存在，初始值只能是 DEFAULT_APPEARANCE（themeMode='system'）；
   * 客户端水合时如果同步读到本地存的 'light'，两边渲染出的顶栏按钮 title / aria-label /
   * 太阳月亮图标就不一样 —— 这就是那个从 0.7.x 一直挂着的「React #418 整页重画」
   * （以前只在生产包复现，dev 下 React 只在控制台报错不重画，所以一直没抓到）。
   * 现在首帧用默认值和服务端对齐，真正的外观值在水合之后的那一个 effect 里补上；
   * layout.tsx 的首帧脚本已经把主题画进 <html>，所以肉眼看不到闪烁。
   */
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const appearanceReady = useRef(false);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [sidebarOpen, setSidebarOpen] = useState(false);
    // 0.4.1：折叠状态同步写 localStorage，页面切换重挂载时能立即恢复
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const prevIndex = useRef<number>(FLAT.findIndex((i) => pathname.startsWith(i.href)));

  const hoverSidebar = settings?.sidebarMode === 'hover';

  // 主题：水合前不动 document（首帧脚本已经按 cookie 画好了）；
  // 水合后用一次性的 effect 把 localStorage 里的真实外观补进来。
  useEffect(() => {
    const stored = readStoredAppearance();
    setAppearance(stored);
    applyAppearance(stored);
    appearanceReady.current = true;
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!appearanceReady.current) return;
    applyAppearance(appearance);
  }, [appearance]);

  // 跟随系统深浅
  useEffect(() => {
    if (appearance.themeMode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => setAppearance((prev) => ({ ...prev }));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [appearance.themeMode]);

  /**
   * 0.8.0 动效偏好：首帧已经由 layout.tsx 的 cookie + 首帧脚本写进 <html>，
   * 这里只做两件事 —— ①cookie 过期时用 localStorage 补一次；②监听设置页的实时改动。
   * 组件渲染时**不读**这个值（那会造成服务端/客户端类名不一致），
   * 动画的开关一律交给 CSS 的 html[data-motion-*] 规则。
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    applyMotion(readStoredMotion());
    const onMotion = (event: Event): void => {
      const next = (event as CustomEvent<unknown>).detail;
      // 设置页里的「实时预览」：只改当前这一屏，不落盘（落盘在保存时由 ps:settings-saved 负责）
      if (next) applyMotion(normalizeMotion(next), false);
    };
    window.addEventListener('ps:motion-changed', onMotion as EventListener);
    return () => window.removeEventListener('ps:motion-changed', onMotion as EventListener);
  }, []);

  /**
   * 0.7.1：顶栏的一键外观切换 —— 跟随系统 → 浅色 → 深色 → 跟随系统。
   * 直接把结果写进 localStorage 并立即应用，跟设置页是同一个数据源，两边不会互相打回。
   */
  const cycleTheme = useCallback((): void => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const current = appearance.themeMode;
    const next = order[(order.indexOf(current) + 1) % order.length] ?? 'system';
    const resolved: Appearance = { ...appearance, themeMode: next, darkMode: resolveDark(next, appearance.darkMode) };
    setAppearance(resolved);
    applyAppearance(resolved);
  }, [appearance]);

  // 设置
  useEffect(() => {
    void (async () => {
      try {
        const saved =
          (await withTimeout(
            KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS),
            3000,
            null,
          )) ?? null;
        setSettings(saved);
        if (saved) {
          // 0.8.0：动效偏好以 localStorage 为准，kv 只在本地还没记录时兜底
          if (saved.motion && typeof window !== 'undefined' && window.localStorage.getItem('ps:motion') === null) {
            applyMotion(normalizeMotion(saved.motion));
          }
          const stored = readStoredAppearance();
          const hasStored =
            typeof window !== 'undefined' && window.localStorage.getItem('ps:appearance') !== null;
          // 0.7.1 修：外观以 localStorage 为准。
          // 设置页的实时预览写的就是 localStorage，而这里以前无条件拿 kv 里的旧值盖回来 ——
          // 于是「在设置里改回浅色」之后，随便进任何页面（每页都各挂一个 AppShell）又被改回深色，
          // 表现出来就是「改回浅色有时候不生效」。kv 只在老用户没有本地记录时兜底。
          setAppearance(
            hasStored
              ? stored
              : {
                  darkMode: saved.darkMode ?? false,
                  themeMode: saved.themeMode ?? (saved.darkMode ? 'dark' : 'light'),
                  glass: saved.glass ?? false,
                  glassBlur: saved.glassBlur ?? 24,
                  fontFamily: saved.fontFamily ?? stored.fontFamily ?? 'round',
                },
          );

          if (typeof window !== 'undefined' && window.localStorage.getItem(COLLAPSE_KEY) === null) {
            setCollapsed(saved.sidebarCollapsed ?? false);
          }
        }
      } catch {
        // 默认外观
      }
      try {
        const mod = await import('@/lib/storage/usage');
        setUsage(await mod.getStorageUsage());
      } catch {
        // 忽略
      }
    })();
  }, []);

  /**
   * 0.7.2：设置页点了「保存设置」之后要立刻生效。
   *
   * 以前 AppShell 只在挂载时读一次 kv，所以在设置里把「功能栏」改成悬浮展开、
   * 或者改字体/玻璃，都要切一次页面（= 侧栏重新挂载）才看得见 —— 用户反馈的
   * 「改了点保存不生效，必须来回切界面」就是这条。
   * 现在设置页保存后派发 ps:settings-saved（detail 是完整设置），这里接住重渲染。
   */
  useEffect(() => {
    const onSaved = (event: Event): void => {
      const next = (event as CustomEvent<AppSettings | undefined>).detail;
      if (!next) return;
      setSettings(next);
      if (next.motion) applyMotion(normalizeMotion(next.motion));
      if (
        typeof next.sidebarCollapsed === 'boolean' &&
        window.localStorage.getItem(COLLAPSE_KEY) === null
      ) {
        setCollapsed(next.sidebarCollapsed);
      }
      setAppearance((prev) => {
        const merged: Appearance = {
          ...prev,
          glass: next.glass ?? prev.glass,
          glassBlur: next.glassBlur ?? prev.glassBlur,
          fontFamily: next.fontFamily ?? prev.fontFamily,
          themeMode: next.themeMode ?? prev.themeMode,
        };
        const resolved: Appearance = {
          ...merged,
          darkMode: resolveDark(merged.themeMode, prev.darkMode),
        };
        applyAppearance(resolved);
        return resolved;
      });
    };
    window.addEventListener('ps:settings-saved', onSaved as EventListener);
    return () => window.removeEventListener('ps:settings-saved', onSaved as EventListener);
  }, []);

  // 0.6.1：启动页 —— 记下上次停在哪个页面，并按设置决定一开始落在哪
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const LAST_KEY = 'ps:last-route';
    let done = false;
    void (async () => {
      try {
        const saved =
          (await withTimeout(KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS), 2500, null)) ?? null;
        const mode = saved?.startPage ?? 'home';
        const last = window.localStorage.getItem(LAST_KEY);
        if (mode === 'projects' && pathname === ROUTES.home) {
          done = true;
          router.replace(ROUTES.projects);
        } else if (mode === 'keep' && pathname === ROUTES.home && last && last !== ROUTES.home) {
          done = true;
          router.replace(last);
        }
      } catch {
        /* 读不到设置就按默认主菜单 */
      }
    })();
    return () => {
      void done;
    };
    // 只在挂载时跑一次：用户自己点了侧栏之后不该再被拽走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !pathname) return;
    try {
      window.localStorage.setItem('ps:last-route', pathname);
    } catch {
      /* 忽略 */
    }
  }, [pathname]);

  // 0.5.7：启动 6 秒后检查一次新版本（本地 1 小时节流），发现新版用一条 toast 提示。  // 这里只引轻量的 updater 模块，不引入任何弹窗组件，避免拖慢首屏。
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let alive = true;

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const saved =
            (await withTimeout(
              KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS),
              3000,
              null,
            )) ?? null;
          if (!alive) return;
          // 用户关掉了「启动时自动检查更新」就什么都不做
          if (saved?.autoCheckUpdates === false) return;

          await checkForUpdate();
          if (!alive) return;

          const pending = readPendingUpdate();
          if (!pending) return;

          toast('发现新版本 v' + pending.latest, {
            description: '点这里去更新',
            duration: 8000,
            action: {
              label: '去更新',
              onClick: () => router.push('/settings#update'),
            },
          });
          // 只提醒一次；设置页里还能手动检查
          clearPendingUpdate();
        } catch {
          // 更新检查失败不该影响启动
        }
      })();
    }, 6000);

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [router]);

  // Ctrl/Cmd + A 守卫
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
      if (event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editable =
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable === true ||
        Boolean(target?.closest('[contenteditable="true"]'));

      if (editable || /^\/projects\/[^/]+$/.test(pathname)) return;
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname]);

  // 0.4.1：全局快捷键
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 0.5.0：? 打开快捷键清单
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editing =
        tag === 'input' ||
        tag === 'textarea' ||
        target?.isContentEditable === true;
      if (
        !editing &&
        event.key === '?' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();

      if (key === 'k') {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }

      if (key === 'n') {
        event.preventDefault();
        router.push('/projects');
        return;
      }

      if (key === ',') {
        event.preventDefault();
        router.push('/settings');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  // 页面切换方向
  useEffect(() => {
    const index = FLAT.findIndex((i) => pathname.startsWith(i.href));
    if (index === -1 || index === prevIndex.current) return;
    setDirection(index > prevIndex.current ? 'next' : 'prev');
    prevIndex.current = index;
  }, [pathname]);

  /* ------------------- 0.7.1：悬浮展开的「热区状态机」 ------------------- */

  // 悬浮模式下不折叠（折叠按钮禁用）；常驻模式可折叠成图标栏
  const compact = !hoverSidebar && collapsed;
  const sidebarWidth = compact ? 'w-[var(--rail-w-compact)]' : 'w-[var(--rail-w)]';

  /**
   * 0.7.0 的写法把 onMouseEnter / onMouseLeave 双双挂在一个宽度会塌成 0 的外层容器上：
   * 收起时 aside 被 translate 到屏幕外，容器宽度归零，只剩 10px 把手悬在别处；
   * 鼠标一进入就被 translate 出去 → 触发 mouseleave → 再移回来 → 再 enter，
   * 每秒十几次高频开关（用户实测：「闪烁横跳、点不开、也不会自己弹出来」）。
   *
   * 现在「开」和「关」彻底拆开，互不触发：
   *   · 开：只有「贴视口左缘的窄缝热区」和「边缘把手」能开；热区在展开时 pointer-events-none 让位。
   *   · 关：只由「离开面板」触发，且延迟 HOVER_CLOSE_DELAY 才真收，
   *     给用户穿过「面板到视口边缘那 12px 间隙」留时间，也容错「移进面板又移出来」。
   */
  const HOVER_CLOSE_DELAY = 280;
  const closeTimerRef = useRef<number | null>(null);

  const cancelHoverClose = (): void => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openHoverSidebar = (): void => {
    cancelHoverClose();
    setSidebarOpen(true);
  };

  const scheduleHoverClose = (): void => {
    cancelHoverClose();
    if (typeof window === 'undefined') return;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setSidebarOpen(false);
    }, HOVER_CLOSE_DELAY);
  };

  const closeHoverSidebar = (): void => {
    cancelHoverClose();
    setSidebarOpen(false);
  };

  // 卸载时清掉待执行的收起定时器，免得对已卸载组件 setState
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  // 切回常驻模式时把悬浮面板收起来，避免下次切回「悬浮」时留着上一次的开着状态
  useEffect(() => {
    if (!hoverSidebar) {
      cancelHoverClose();
      setSidebarOpen(false);
    }
  }, [hoverSidebar]);

  // Esc 收起（只在悬浮模式且面板开着时挂监听）
  useEffect(() => {
    if (!hoverSidebar || !sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        cancelHoverClose();
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hoverSidebar, sidebarOpen]);

  /**
   * 0.7.1：把「折叠」这个全局状态限定在常驻模式。
   *
   * globals.css 里有两条无条件生效的规则：
   *   html[data-sidebar='compact'] aside.ps-sidebar { width: var(--rail-w-compact) !important }
   *   html[data-sidebar='compact'] aside.ps-sidebar [data-sidebar-label] { display: none !important }
   * 而 data-sidebar 是首帧脚本（layout.tsx 的 APPEARANCE_SCRIPT）按 localStorage 打的。
   * 用户先折叠过一次（记住 '1'），再切到「悬浮展开」：悬浮面板会被压成 4.75rem、文字全没，
   * 看起来就是「点不开」。切模式时把 dataset 重新对齐到当前模式即可。
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.sidebar = compact ? 'compact' : 'expanded';
    // 0.7.3：镜像到 cookie，下一次打开服务端就能把密度直接画进 HTML（省掉一次水合重画）
    mirrorSidebarCookie(compact);
  }, [compact]);

  /**
   * 0.7.3：记住最近去过的页面，给命令面板做「最近打开」。
   * 每页各挂一份 AppShell，所以只能落 localStorage；只存路径与名字，不存数据。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const nav = [...FLAT, SETTINGS_ITEM];
    const hit = nav.find(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
    );
    if (!hit) return;
    try {
      const key = 'ps:recent-pages';
      const raw = window.localStorage.getItem(key);
      const list: { href: string; label: string }[] = raw ? JSON.parse(raw) : [];
      const next = [{ href: hit.href, label: hit.label }, ...list.filter((x) => x.href !== hit.href)].slice(0, 5);
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 存不下就算了，不影响页面
    }
  }, [pathname]);

  const blur = settings?.backgroundBlur ?? 14;

  // 0.7.0：顶栏左侧的「当前位置」——分组名当眉标，模块名当正文
  const activeNav =
    [...FLAT, SETTINGS_ITEM].find(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
    ) ?? null;
  const activeGroup =
    GROUPS.find((group) => group.items.some((item) => item.href === activeNav?.href))?.title ?? '设置';

  return (
    <div className="relative min-h-dvh">
      {/* 背景装饰：两层柔光缓慢漂移，顶部再加一条极细的暖光，避免大面积纯色 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className={cn(
            'absolute -top-40 -left-32 h-[46vw] w-[46vw] rounded-full opacity-90',
            'ps-drift',
          )}
          style={{ background: 'var(--blob-1)', filter: `blur(${blur}px)` }}
        />
        <div
          className={cn(
            'absolute top-1/4 -right-40 h-[54vw] w-[54vw] rounded-full opacity-90',
            'ps-drift-slow',
          )}
          style={{ background: 'var(--blob-2)', filter: `blur(${blur}px)` }}
        />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-copper/25 to-transparent" />
      </div>

      {/* 侧栏：固定在视口最左，不随内容宽度偏移 */}
      {hoverSidebar ? (
        <>
          {/* 热区：贴着视口左缘的一条窄缝（8px、整屏高），鼠标进来就展开。
              展开时 pointer-events-none 让位 —— 否则它会压在面板左边缘上抢事件，
              面板的 mouseleave 永远不触发，就收不回去。 */}
          <div
            data-sidebar-hotzone
            aria-hidden
            className={cn(
              'fixed inset-y-0 left-0 z-40 hidden w-[8px] md:block',
              'transition-opacity duration-[var(--dur-2)] ease-[var(--ease-out)]',
              sidebarOpen ? 'pointer-events-none opacity-0' : 'pointer-events-auto opacity-100',
            )}
            onMouseEnter={openHoverSidebar}
          />

          {/* 收起时的把手：一小片悬浮玻璃贴条，整块都在视口内（left-0、宽 9px），不会跑出去 */}
          <button
            type="button"
            aria-label="展开功能栏"
            aria-expanded={sidebarOpen}
            onClick={openHoverSidebar}
            onMouseEnter={openHoverSidebar}
            onFocus={openHoverSidebar}
            className={cn(
              'group/edge fixed top-1/2 left-0 z-40 h-16 w-[9px] -translate-y-1/2 items-center justify-center',
              'rounded-r-full border border-l-0 bg-surface/70 backdrop-blur-md hover:w-[12px]',
              'hidden transition-[opacity,width] duration-[var(--dur-2)] ease-[var(--ease-out)] md:flex',
              sidebarOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
            style={{ borderColor: 'var(--hairline)' }}
          >
            <span className="h-5 w-[2px] rounded-full bg-copper/45 transition-colors group-hover/edge:bg-copper" />
            <ChevronRight className="absolute -right-0.5 h-2.5 w-2.5 text-ink-faint opacity-0 transition-opacity duration-[var(--dur-2)] group-hover/edge:opacity-100" />
          </button>

          {/* 悬浮面板：和常驻模式同一套玻璃观感，进出只用 transform（GPU 合成，不动 left/width）。
              关闭时 inert，这样 tab 键不会聚焦到屏幕外的导航上。
              鼠标在面板内：取消待收；移出面板：延迟 280ms 才收。 */}
          <aside
            aria-label="主导航"
            inert={!sidebarOpen}
            onMouseEnter={cancelHoverClose}
            onMouseLeave={scheduleHoverClose}
            onFocus={openHoverSidebar}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                scheduleHoverClose();
              }
            }}
            className={cn(
              'ps-sidebar ps-sidebar-hover ps-rail ps-glass-strong fixed top-[var(--shell-gap)] bottom-[var(--shell-gap)] left-[var(--shell-gap)] z-40 w-[var(--rail-w)] flex-col overflow-hidden px-3 py-4 will-change-transform',
              'hidden transition-transform duration-[220ms] ease-[var(--ease-out)] md:flex',
              sidebarOpen ? 'translate-x-0' : 'translate-x-[calc(-100%-1.5rem)]',
            )}
          >
            <SidebarContent
              pathname={pathname}
              usage={usage}
              compact={false}
              collapseDisabled
              onToggleCollapse={() => undefined}
              onNavigate={closeHoverSidebar}
            />
          </aside>
        </>
      ) : (
        <aside
          className={cn(
            'ps-sidebar ps-rail ps-glass-strong fixed top-[var(--shell-gap)] bottom-[var(--shell-gap)] left-[var(--shell-gap)] z-40 hidden shrink-0 flex-col overflow-hidden px-3 py-4 transition-[width] duration-[360ms] ease-[var(--ease-out)] md:flex',
            sidebarWidth,
          )}
        >
          <SidebarContent
            pathname={pathname}
            usage={usage}
            compact={compact}
            collapseDisabled={false}
            onToggleCollapse={() => {
              const next = !collapsed;
              setCollapsed(next);
              try {
                window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
                document.documentElement.dataset.sidebar = next ? 'compact' : 'expanded';
                mirrorSidebarCookie(next);
              } catch {
                // 忽略
              }
              void (async () => {
                try {
                  const saved = (await KvRepository.get<AppSettings>(STORAGE_KEY_APP_SETTINGS)) ?? null;
                  if (saved) {
                    await KvRepository.set(STORAGE_KEY_APP_SETTINGS, {
                      ...saved,
                      sidebarCollapsed: next,
                    });
                  }
                } catch {
                  // 忽略
                }
              })();
            }}
          />
        </aside>
      )}

      {/* 内容：给浮动侧栏让位（侧栏是浮起来的，所以要让出「栏宽 + 两侧空隙」）。
          0.7.2：「悬浮展开」模式下侧栏是浮在内容之上的抽屉，不该再占位 ——
          以前这里不管哪种模式都按栏宽留白，于是选了「悬浮展开」看起来跟
          「一直展开」一模一样（用户反馈「改了点保存不生效」的一半原因）。 */}
      <div
        className={cn(
          'relative min-w-0 transition-[padding] duration-[360ms] ease-[var(--ease-out)]',
          hoverSidebar
            ? 'md:pl-[var(--shell-gap)]'
            : compact
              ? 'md:pl-[calc(var(--rail-w-compact)+var(--shell-gap)*2)]'
              : 'md:pl-[calc(var(--rail-w)+var(--shell-gap)*2)]',
        )}
      >
        {/* 0.7.2：切页时这里划过一道陶土细线 —— 内容本身有滑入动画，
            但顶上一道 2px 的进度线能让「正在进入下一处」更有交代。 */}
        <div
          key={`bar-${pathname}`}
          aria-hidden
          className="ps-route-bar pointer-events-none absolute top-0 right-0 left-0 z-40 h-[2px] bg-gradient-to-r from-copper/0 via-copper/80 to-copper/0"
        />

        {showTopBar && (
          <>
            <header
              data-glass-bar
              className="sticky top-0 z-30 flex h-[var(--header-h)] items-center gap-3 px-5 md:px-8"
            >
              {/* 当前位置：0.7.3 起做成面包屑 —— 组名是一枚小胶囊，页面名用衬线体，
                  和页面里的大标题同一套语言，顶栏不再是一行灰字 */}
              <div className="flex min-w-0 items-center gap-2">
                <span className="hidden md:inline-flex">
                  <span className="ps-crumb">{activeGroup}</span>
                </span>
                <ChevronRight className="hidden h-3 w-3 shrink-0 text-ink-faint/60 md:block" />
                <span className="ps-serif truncate text-[15px] leading-none tracking-[-0.005em] text-ink">
                  {activeNav?.label ?? APP_NAME}
                </span>
              </div>

              {/* 移动端一级导航（桌面端在侧栏里，这里只在窄屏出现） */}
              <div className="ps-scroll-thin -mx-1 flex items-center gap-1 overflow-x-auto md:hidden">
                {[...FLAT, SETTINGS_ITEM].map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(item.href + '/');
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'ps-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-200',
                        active
                          ? 'bg-ink text-paper'
                          : 'text-ink-mid hover:bg-ink/6 hover:text-ink',
                      )}
                      aria-label={item.label}
                    >
                      <Icon className="h-4 w-4" />
                    </Link>
                  );
                })}
              </div>

              <div className="ml-auto flex items-center gap-2">
                {/* 0.7.1：外观一键切换（跟随系统 → 浅色 → 深色 循环），
                    不用每次都钻进设置页去找开关 */}
                <button
                  type="button"
                  onClick={cycleTheme}
                  title={`外观：${THEME_CYCLE_LABEL[appearance.themeMode]}（点一下切下一个）`}
                  aria-label={`外观：${THEME_CYCLE_LABEL[appearance.themeMode]}，点击切换`}
                  className="ps-chip h-8 w-8 justify-center px-0"
                >
                  {appearance.themeMode === 'dark' ? (
                    <Moon className="h-3.5 w-3.5" />
                  ) : appearance.themeMode === 'light' ? (
                    <Sun className="h-3.5 w-3.5" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  title="搜索照片、页面、动作（Ctrl+K）"
                  className="ps-search hidden md:inline-flex"
                >
                  <Search className="h-3.5 w-3.5 shrink-0" />
                  <span className="flex-1 truncate text-left">搜索照片、页面、动作</span>
                  <span className="ps-kbd shrink-0">Ctrl K</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  title="搜索或跳转（Ctrl+K）"
                  aria-label="搜索或跳转"
                  className="ps-chip h-8 w-8 justify-center px-0 md:hidden"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
                {actions}
              </div>
            </header>
            {/* 顶栏下沿的一道光：换页时从中间向两边扫开，给转场一个「收尾」动作 */}
            <div
              key={`line-${pathname}`}
              aria-hidden
              className={cn(
                'pointer-events-none sticky top-[var(--header-h)] z-20 -mt-px h-px',
                'ps-stage-line',
              )}
              style={{
                background:
                  'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-copper) 46%, transparent), transparent)',
              }}
            />
          </>
        )}

        <div
          key={pathname}
          className={cn(
            'ps-page-shell',
            direction === 'next' ? 'ps-page-next' : 'ps-page-prev',
          )}
        >
          {children}
        </div>
      </div>

      {/* 命令面板 */}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

/* ------------------------------- 侧栏内容 ------------------------------- */

function SidebarContent({
  pathname,
  usage,
  compact,
  collapseDisabled,
  onToggleCollapse,
  onNavigate,
}: {
  pathname: string;
  usage: StorageUsage | null;
  compact: boolean;
  collapseDisabled: boolean;
  onToggleCollapse: () => void;
  onNavigate?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>());
  const barRef = useRef<HTMLSpanElement>(null);
  const prevPos = useRef<IndicatorPos | null>(readLastIndicator(compact));

  const activeHref =
    [...FLAT, SETTINGS_ITEM].find(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
    )?.href ?? '';

  /**
   * 0.7.2：换页后把侧栏的滚动位置还原。
   *
   * declared 在指示条那个 effect 之前 —— 顺序很重要：指示条要量 item 的视口坐标，
   * 必须等滚动位置先复原，否则量到的是「顶部那一屏」的坐标，条会先闪一下再跳。
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (lastSidebarScroll > 0 && el.scrollHeight > el.clientHeight) {
      el.scrollTop = lastSidebarScroll;
    }
  }, []);

  /**
   * 0.4.2：滑条改成 WAAPI（element.animate）。
   *
   * 之前两版都失败，根因是每个页面各自渲染 AppShell：导航时侧栏连同滑条一起
   * 卸载重建，CSS transition 需要「元素带着旧样式先绘制一帧」才会动；
   * 新元素第一次绘制就是目标位置，所以永远是瞬移。
   *
   * 用 element.animate 显式给出 起点 → 拉丝 → 终点 三个关键帧，
   * 元素哪怕是刚挂上去的，也会真的从旧位置滑过来。
   *
   * 0.7.1 修的是「列表一滚，滑条留在原地」。
   * 指示条挂在 rootRef（整块不滚动的外层）里，位置必须用视口坐标差值算：
   * getBoundingClientRect 本身已经扣掉了滚动量，所以「量一次就够」这个前提是错的 ——
   * 旧版只在挂载和尺寸变化时量，滚动时不重量，条就留在原处。现在：
   *   · 滚动容器挂 passive 的 scroll 监听，只在 rAF 里量一次（item / list / root 三个 rect），
   *     用 transform + height 落位，别的什么都不读，避免每帧多次强制 layout；
   *   · 对「被滚出可视区」做裁剪：项滚到列表顶部之上时只画剩下那一截，全出去了就隐藏，
   *     绝不把条画到顶栏上（用户要求「绝不允许错位」）；
   *   · 滚动中条略淡（0.55）略短（62%），手一停就用 spring 啪地吸附回整条；
   *   · 窗口缩放 / 字体加载 / 用量异步长高 / 折叠展开，仍由 ResizeObserver + 前 120 帧校正兜住。
   */
  useEffect(() => {
    const item = itemRefs.current.get(activeHref);
    const bar = barRef.current;
    const root = rootRef.current;
    if (!item || !bar || !root) {
      if (bar) bar.style.opacity = '0';
      return;
    }

    // 侧栏里唯一会滚的容器；底部的「设置」项在它外面，不参与裁剪
    const list = scrollRef.current;
    const scrollable = list && list.contains(item) ? list : null;

    /**
     * 0.8.0：指示条的所有补间都走这个包装。
     * 用户在设置里关掉「侧栏动效」（或系统开了减少动态）时，直接落到终态，
     * 一条 WAAPI 都不排 —— 低端机上这条泛光条是侧栏里最贵的动画。
     */
    const animate = (frames: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions): void => {
      if (!motionEnabled('sidebar')) return;
      bar.animate(frames, options);
    };

    /*
     * 0.7.1：选中项整个被滚出可视区时（窗口矮 / 直接打开深链接 / 从别处跳进来 /
     * 底部「本地存储」块异步长高把导航顶下去），指示条没有可见位置可画，用户也
     * 找不到自己选中了哪一项。这里把列表最小幅度地滚到刚好能看见它为止。
     * 只在「用户没自己滚过」的时候调用，不会抢用户的手感。
     */
    let selfScrollUntil = 0;
    const revealIntoView = (): boolean => {
      if (!scrollable) return false;
      const view = scrollable.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      if (rect.bottom > view.top && rect.top < view.bottom) return false;
      const delta = rect.top >= view.bottom ? rect.bottom - view.bottom : rect.top - view.top;
      if (delta === 0) return false;
      scrollable.scrollTop += delta;
      // 自己滚出来的 scroll 事件会异步回来，别把它当成用户滚动去做「缩+淡」
      selfScrollUntil = performance.now() + 120;
      return true;
    };
    const revealed = revealIntoView();
    let userScrolled = false;

    // 滚动中/吸附中：期间不要跑 sync，否则会和滚动的逐帧落位打架
    let scrolling = false;

    // 用 rect 差值测量：侧栏本身不带 transform，换页动画只作用在内容区，
    // 所以这里的坐标是稳定的，不会像全局 getBoundingClientRect 那样漂移。
    const measure = (): IndicatorGeom => {
      const rootRect = root.getBoundingClientRect();
      const rect = item.getBoundingClientRect();
      const top = rect.top - rootRect.top;
      if (!scrollable) return { top, height: rect.height, visible: rect.height > 0.5 };
      const viewRect = scrollable.getBoundingClientRect();
      const viewTop = viewRect.top - rootRect.top;
      const viewBottom = viewRect.bottom - rootRect.top;
      const clippedTop = Math.max(top, viewTop);
      const clippedBottom = Math.min(top + rect.height, viewBottom);
      const clippedHeight = clippedBottom - clippedTop;
      if (clippedHeight <= 0.5) return { top, height: rect.height, visible: false };
      return { top: clippedTop, height: clippedHeight, visible: true };
    };

    const target = measure();
    const from = prevPos.current;
    prevPos.current = { top: target.top, height: target.height };
    lastIndicatorValue = { ...prevPos.current, compact };

    let applied: IndicatorPos = { top: target.top, height: target.height };

    /** 落位：shrink < 1 时以「中心不动」的方式缩短，滚动中拿它做轻量化 */
    const render = (geom: IndicatorGeom, shrink = 1, opacity = 1): void => {
      const height = Math.max(2, geom.height * shrink);
      const top = geom.top + (geom.height - height) / 2;
      applied = { top, height };
      bar.style.transform = `translateY(${top}px)`;
      bar.style.height = `${height}px`;
      bar.style.opacity = geom.visible ? String(opacity) : '0';
    };

    /**
     * 0.4.3：布局漂移校正。
     *
     * 底部「本地存储」块要等 usage 异步返回后才长出进度条和「146.2 MB 已用」，
     * 那一块在 mt-auto 里，一长高就把整组导航往上顶 34px —— 而指示条是在
     * 挂载时测量的，于是永远比选中项低 34px（实机 p-bar.js 实测到的 bug）。
     * 这里在挂载后持续比对一个多秒，位置上跑了就无动画重新落位；
     * 之后交给 ResizeObserver 兜住窗口缩放等后续变化。
     */
    const sync = (): boolean => {
      if (scrolling) return false;
      const now = measure();
      if (!now.visible) {
        // 布局漂移把选中项挤出可视区（用量块迟一步长高、字体后加载）：只要用户
        // 还没自己滚过，就把列表滚回来；用户滚过之后就让条老老实实消失。
        if (!userScrolled && revealIntoView()) {
          const again = measure();
          render(again);
          prevPos.current = { top: again.top, height: again.height };
          lastIndicatorValue = { ...prevPos.current, compact };
          return true;
        }
        if (bar.style.opacity !== '0') bar.style.opacity = '0';
        return false;
      }
      // 位置没动但透明度还是 0（选中项刚从可视区外滚回来 / 窗口从矮变高）也要补一次
      const moved =
        Math.abs(now.top - applied.top) > 0.5 || Math.abs(now.height - applied.height) > 0.5;
      if (moved || bar.style.opacity !== '1') {
        render(now);
        prevPos.current = { top: now.top, height: now.height };
        lastIndicatorValue = { ...prevPos.current, compact };
        return true;
      }
      return false;
    };

    /* --------------------- 滚动跟随（0.7.1 的核心修复） --------------------- */

    const SCROLL_SHRINK = 0.62; // 滚动中条只有 62% 长，视觉上「轻」一点
    const SCROLL_OPACITY = 0.55;
    let scrollRaf = 0;
    let scrollEndTimer = 0;

    /** 手停下：从「滚动态」弹回整条（spring 吸附，200ms 内结束，不晃眼） */
    const settleAfterScroll = (): void => {
      scrollEndTimer = 0;
      if (!scrolling) return;
      scrolling = false;
      const now = measure();
      const shrunk: IndicatorPos = { ...applied };
      render(now);
      if (!now.visible) return;
      animate(
        [
          {
            transform: `translateY(${shrunk.top}px)`,
            height: `${shrunk.height}px`,
            opacity: SCROLL_OPACITY,
            offset: 0,
            easing: 'cubic-bezier(0.34, 1.32, 0.64, 1)',
          },
          {
            transform: `translateY(${now.top}px)`,
            height: `${now.height}px`,
            opacity: 1,
            offset: 1,
          },
        ],
        { duration: 200, easing: 'linear', fill: 'none' },
      );
      prevPos.current = { top: now.top, height: now.height };
      lastIndicatorValue = { ...prevPos.current, compact };
    };

    const onScroll = (): void => {
      // 0.7.2：记住位置，换页重挂载后能回到原处（见 lastSidebarScroll 的注释）
      if (scrollable) lastSidebarScroll = scrollable.scrollTop;
      // 上面 reveal 造成的那一次 scroll 事件：只落位，不进「滚动态」
      if (performance.now() < selfScrollUntil) {
        render(measure());
        return;
      }
      userScrolled = true;
      if (!scrolling) {
        scrolling = true;
        // 滚动优先：把导航切换的 WAAPI 动画掐掉，免得两边同时写 transform
        bar.getAnimations().forEach((animation) => animation.cancel());
      }
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(settleAfterScroll, 130);
      if (scrollRaf) return; // 一帧只算一次
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        render(measure(), SCROLL_SHRINK, SCROLL_OPACITY);
      });
    };

    if (scrollable) scrollable.addEventListener('scroll', onScroll, { passive: true });

    // 首次出现（没有上一项）：直接落位，只做淡入；刚被 reveal 滚过也一样，
    // 因为 from 里的坐标属于旧的滚动偏移，拿来当拉丝起点会画出错位的长条
    const first = !from || revealed || Math.abs(from.top - target.top) < 0.5;

    if (first) {
      render(target);
      animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    } else {
      const distance = Math.abs(target.top - from.top);
      const movingUp = target.top < from.top;

      /*
       * 0.7.2：跨度很大（导航列表 ↔ 底部「设置」那一段）时不滑过去，改成原地换位。
       * 让条一路滑过十几个导航项，视觉上就是「条从别人身上压过去」，用户描述成
       * 「点设置的时候小滑块会重叠」。淡出 + 新位置弹入更干净，也更像「选中了另一块」。
       */
      if (distance > 120) {
        render(target);
        animate(
          [
            { transform: `translateY(${target.top}px)`, height: `${target.height}px`, opacity: 0 },
            {
              transform: `translateY(${target.top}px)`,
              height: `${target.height}px`,
              opacity: 1,
              offset: 1,
            },
          ],
          { duration: 200, easing: 'cubic-bezier(0.34, 1.32, 0.64, 1)' },
        );
      } else {

      // 拉丝：起点与终点之间短暂连成一条，长度封顶，避免盖住底部「本地存储」
      const extra = Math.min(distance * 0.28, 22);
      const top = Math.min(from.top, target.top) - (movingUp ? extra * 0.5 : 0);
      const height = Math.max(from.height, target.height) + extra;
      const stretched: IndicatorPos = { top, height };

      render(target);

      const duration = Math.round(Math.min(520, 240 + distance * 0.45));

      animate(
        [
          {
            transform: `translateY(${from.top}px)`,
            height: `${from.height}px`,
            offset: 0,
            easing: 'cubic-bezier(0.3, 0.9, 0.4, 1)',
          },
          {
            transform: `translateY(${stretched.top}px)`,
            height: `${stretched.height}px`,
            offset: 0.34,
            easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
          },
          {
            transform: `translateY(${target.top}px)`,
            height: `${target.height}px`,
            offset: 1,
          },
        ],
        { duration, easing: 'linear', fill: 'none' },
      );
      }
    }

    // 校正一：动画结束后（含动画期间发生的漂移）再对一次
    let raf = 0;
    let frames = 0;
    const tick = (): void => {
      sync();
      frames += 1;
      if (frames < 120) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 校正二：任何后续的尺寸变化（窗口缩放、字体加载、用量刷新、折叠展开）都重新落位
    const ro = new ResizeObserver(() => sync());
    ro.observe(root);
    if (item.parentElement) ro.observe(item.parentElement);
    if (scrollable) ro.observe(scrollable);

    // 校正三：字体后加载会改行高，DOM 尺寸变化不一定能触发到上面两个观察者
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(() => sync());
    }
    window.addEventListener('resize', sync);

    return () => {
      cancelAnimationFrame(raf);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (scrollEndTimer) window.clearTimeout(scrollEndTimer);
      if (scrollable) scrollable.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', sync);
      ro.disconnect();
    };
  }, [activeHref, compact]);

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
      {/* 当前选中项指示条（位置由 WAAPI 驱动，详见上方 useEffect） */}
      <span
        ref={barRef}
        data-sidebar-indicator
        aria-hidden
        className="pointer-events-none absolute left-[3px] z-10 w-[2.5px] rounded-full bg-copper opacity-0"
        style={{ top: 0, height: 0, transform: 'translateY(0px)' }}
      />

      {/* 顶部：品牌 + 折叠按钮 */}
      <div className={cn('mb-5 flex items-center gap-2.5', compact ? 'justify-center' : 'px-1')}>
        <Link
          href="/home"
          onClick={onNavigate}
          className="ps-pressable group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-ink text-paper shadow-[0_8px_18px_-12px_rgba(0,0,0,0.8)]"
          title={APP_NAME}
        >
          <Images className="h-4 w-4 transition-transform duration-[var(--dur-3)] group-hover:scale-110" />
          <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full bg-copper ring-2 ring-[color-mix(in_srgb,var(--color-surface)_86%,transparent)]" />
        </Link>
        {!compact && (
          <div data-sidebar-label className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold tracking-[-0.015em]">{APP_NAME}</div>
            <div className="mt-0.5 truncate text-[10px] font-medium tracking-[0.16em] text-ink-faint uppercase">
              Photo Story
            </div>
          </div>
        )}
        {!compact && (
          <button
            type="button"
            onClick={onToggleCollapse}
            disabled={collapseDisabled}
            title={collapseDisabled ? '悬浮模式下不支持折叠' : '收起文字，只显示图标'}
            aria-label="折叠功能栏"
            className={cn(
              'ps-pressable flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors',
              collapseDisabled
                ? 'cursor-not-allowed text-ink-faint/50'
                : 'text-ink-faint hover:bg-ink/6 hover:text-ink',
            )}
          >
            <Menu className="h-[15px] w-[15px]" />
          </button>
        )}
      </div>

      {compact && (
        <button
          type="button"
          onClick={onToggleCollapse}
          title="展开文字"
          aria-label="展开功能栏"
          className="ps-pressable mx-auto mb-4 flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/6 hover:text-ink"
        >
          <Menu className="h-[15px] w-[15px]" />
        </button>
      )}

      {/* 搜索 / 跳转：和顶栏是同一个命令面板，这里给一个常驻入口 */}
      {!compact && (
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))
          }
          className="mb-4 flex h-9 w-full items-center gap-2 rounded-[12px] border border-[color:var(--hairline)] bg-surface-2/40 px-2.5 text-left text-[12.5px] text-ink-faint transition-colors duration-200 hover:border-copper/30 hover:text-ink"
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">搜索模块 / 项目</span>
          <span className="ps-kbd">Ctrl K</span>
        </button>
      )}

      {/* 0.6.3：给指示条留一条窄缝（pl-[7px]）。原来指示条压在选中项自己的圆角里，
          两团深色叠在一起，看起来像「滑条和别的东西重叠了」。
          0.7.1：这个滚动容器是指示条跟随的对象，scrollRef 只在这里用；别拿掉。 */}
      <div
        ref={scrollRef}
        data-sidebar-scroll
        className="ps-scroll-thin relative grid min-h-0 flex-1 gap-3 overflow-y-auto pr-1 pl-[7px]"
      >
        {GROUPS.map((group) => (
          <div key={group.title} className="grid gap-0">
            {!compact && (
              <p data-sidebar-label className="ps-cap px-2.5 pb-1.5">
                {group.title}
              </p>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={pathname === item.href || pathname.startsWith(item.href + '/')}
                compact={compact}
                onNavigate={onNavigate}
                register={(el) => {
                  if (el) itemRefs.current.set(item.href, el);
                  else itemRefs.current.delete(item.href);
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 底部：设置 + 存储 + 版本 */}
      <div className={cn('mt-auto grid gap-1.5 pt-3', compact ? 'px-0' : 'px-0')}>
        <div className="ps-hairline-x mb-1.5" />
        <NavLink
          item={SETTINGS_ITEM}
          active={pathname.startsWith('/settings')}
          compact={compact}
          onNavigate={onNavigate}
          register={(el) => {
            if (el) itemRefs.current.set(SETTINGS_ITEM.href, el);
            else itemRefs.current.delete(SETTINGS_ITEM.href);
          }}
        />

        {!compact && (
          <div className="grid gap-1.5 px-2.5 pb-1">
            {/* 0.7.2：这一块是异步查出来的（IndexedDB 用量），以前查到之后凭空长高
                24px，把上面的「设置」连同整组导航一起往上顶 —— 用户看到的就是
                「点别的页面时，下面设置那一坨会跳一下」。现在坑位先占好，
                数据到了只是把内容填进去，高度不变。 */}
            <div className="grid min-h-[26px] content-center gap-1.5">
              {usage && usage.quota > 0 ? (
                <div
                  className="grid gap-1.5"
                  title={`${formatBytes(usage.usage)} / ${formatBytes(usage.quota)}`}
                >
                  <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
                    <span className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      {formatBytes(usage.usage)}
                    </span>
                    <span className="tabular-nums">
                      {/* 0.7.2：占用不到 1% 时别显示「0%」——那是废话，还让人以为进度条坏了 */}
                      {usage.usage / usage.quota < 0.01
                        ? `余 ${formatBytes(usage.quota - usage.usage)}`
                        : `${Math.round((usage.usage / usage.quota) * 100)}%`}
                    </span>
                  </div>
                  <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-copper/70 to-copper transition-[width] duration-700 ease-[var(--ease-out)]"
                      style={{
                        width: `${Math.min(100, usage.usage / usage.quota > 0.005 ? Math.max(2, (usage.usage / usage.quota) * 100) : 0)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-1.5 opacity-0" aria-hidden>
                  <div className="flex items-center justify-between text-[10.5px]">
                    <span>000 MB</span>
                    <span>0%</span>
                  </div>
                  <div className="h-[3px] w-full rounded-full" />
                </div>
              )}
            </div>
            <span className="text-[10.5px] text-ink-faint/70 tabular-nums">v{APP_VERSION}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function NavLink({
  item,
  active,
  compact,
  onNavigate,
  register,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  onNavigate?: () => void;
  register: (el: HTMLAnchorElement | null) => void;
}) {
  const Icon = item.icon;
  // 0.5.5：悬停就告诉用户这个模块是干什么用的（收起态只显示图标时尤其需要）
  const hint = moduleTagline(item.href);
  return (
    <Link
      ref={register}
      href={item.href}
      onClick={onNavigate}
      data-active={active ? 'true' : 'false'}
      title={hint ? (compact ? `${item.label} — ${hint}` : hint) : compact ? item.label : undefined}
      aria-label={hint ? `${item.label}：${hint}` : item.label}
      className={cn(
        'ps-navlink ps-pressable group/nav',
        compact ? 'h-10 justify-center px-0' : 'gap-2.5',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-transform duration-[var(--dur-3)] ease-[var(--ease-spring)]',
          !active && 'group-hover/nav:scale-[1.08]',
        )}
      />
      {!compact && (
        <span data-sidebar-label className="leading-[1.25] tracking-[0.005em]">
          {item.label}
        </span>
      )}
    </Link>
  );
}
