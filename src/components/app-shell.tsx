// src/components/app-shell.tsx
'use client';

// 应用外壳：左侧一级导航（常驻 / 悬浮 / 折叠）+ 背景装饰 + 主题 + 转场。
// 0.4.0：侧栏改为固定贴视口左侧，任何窗口宽度都不会偏移；新增折叠与滑动指示条。

import { useEffect, useRef, useState } from 'react';
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
  Settings,
  Swords,
  Trash2,
  ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';

import { CommandPalette } from '@/components/command-palette';
import { ShortcutsDialog } from '@/components/shortcuts-dialog';
import { APP_NAME, APP_VERSION, STORAGE_KEY_APP_SETTINGS } from '@/config/app';
import { moduleTagline } from '@/config/modules';
import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  readStoredAppearance,
  type Appearance,
} from '@/lib/appearance';
import { KvRepository } from '@/lib/db';
import { checkForUpdate, clearPendingUpdate, readPendingUpdate } from '@/lib/updater';
import { cn, formatBytes, withTimeout } from '@/lib/utils';
import type { AppSettings, StorageUsage } from '@/types/domain';

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

let lastIndicatorValue: (IndicatorPos & { compact: boolean }) | null = null;

function readLastIndicator(compact: boolean): IndicatorPos | null {
  if (!lastIndicatorValue) return null;
  if (lastIndicatorValue.compact !== compact) return null;
  return { top: lastIndicatorValue.top, height: lastIndicatorValue.height };
}

/** 首帧外观：同步读 localStorage，避免 useEffect 用默认值覆盖预渲染主题 */
function readInitialAppearance(): Appearance {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  return readStoredAppearance();
}

const COLLAPSE_KEY = 'ps:sidebar-collapsed';

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
  const [appearance, setAppearance] = useState<Appearance>(readInitialAppearance);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const [sidebarOpen, setSidebarOpen] = useState(false);
    // 0.4.1：折叠状态同步写 localStorage，页面切换重挂载时能立即恢复
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const prevIndex = useRef<number>(FLAT.findIndex((i) => pathname.startsWith(i.href)));

  const hoverSidebar = settings?.sidebarMode === 'hover';

  // 主题
  useEffect(() => {
    if (typeof document === 'undefined') return;
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
          const stored = readStoredAppearance();
          setAppearance({
            darkMode: saved.darkMode ?? false,
            themeMode: saved.themeMode ?? (saved.darkMode ? 'dark' : 'light'),
            glass: saved.glass ?? false,
            glassBlur: saved.glassBlur ?? 24,
            fontFamily: saved.fontFamily ?? stored.fontFamily ?? 'round',
          });
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

  // 0.5.7：启动 6 秒后检查一次新版本（本地 1 小时节流），发现新版用一条 toast 提示。
  // 这里只引轻量的 updater 模块，不引入任何弹窗组件，避免拖慢首屏。
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

  const blur = settings?.backgroundBlur ?? 14;
  const animations = settings?.animations !== false;
  // 悬浮模式下不折叠（折叠按钮禁用）；常驻模式可折叠成图标栏
  const compact = !hoverSidebar && collapsed;
  const sidebarWidth = compact ? 'w-[4.5rem]' : 'w-60';

  return (
    <div className="relative min-h-dvh" style={{ backgroundColor: 'var(--app-bg)' }}>
      {/* 背景装饰 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div
          className={cn(
            'absolute -top-32 -left-24 h-[44vw] w-[44vw] rounded-full',
            animations && 'ps-drift',
          )}
          style={{ background: 'var(--blob-1)', filter: `blur(${blur}px)` }}
        />
        <div
          className={cn(
            'absolute top-1/3 -right-32 h-[52vw] w-[52vw] rounded-full',
            animations && 'ps-drift-slow',
          )}
          style={{ background: 'var(--blob-2)', filter: `blur(${blur}px)` }}
        />
      </div>

      {/* 侧栏：固定在视口最左，不随内容宽度偏移 */}
      {hoverSidebar ? (
        <div
          className="fixed top-0 left-0 z-40 hidden h-dvh md:block"
          onMouseEnter={() => setSidebarOpen(true)}
          onMouseLeave={() => setSidebarOpen(false)}
        >
          {/* 收起时的边缘提示：一条细窄的渐变 + 箭头，不再是一整块深色 */}
          <button
            type="button"
            aria-label="展开功能栏"
            onFocus={() => setSidebarOpen(true)}
            className={cn(
              'group/edge absolute top-1/2 left-0 z-10 flex h-16 w-[7px] -translate-y-1/2 items-center justify-center rounded-r-full',
              'bg-ink/12 transition-all duration-300 hover:w-[10px] hover:bg-ink/25',
              sidebarOpen ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            <ChevronRight className="h-3 w-3 text-ink/50" />
          </button>

          <aside
            className={cn(
              'ps-sidebar absolute top-0 left-0 flex h-full w-60 flex-col border-r border-line/50 bg-paper/92 px-3 py-4 shadow-[24px_0_60px_-40px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-transform duration-[320ms] ease-[var(--ease-out)]',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <SidebarContent
              pathname={pathname}
              usage={usage}
              compact={false}
              collapseDisabled
              onToggleCollapse={() => undefined}
              onNavigate={() => setSidebarOpen(false)}
            />
          </aside>
        </div>
      ) : (
        <aside
          className={cn(
            'ps-sidebar fixed top-0 left-0 z-40 hidden h-dvh shrink-0 flex-col border-r border-line/50 px-3 pt-4 pb-5 transition-[width] duration-[320ms] ease-[var(--ease-out)] md:flex',
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

      {/* 内容：给固定侧栏让位 */}
      <div
        className={cn(
          'relative min-w-0 transition-[padding] duration-[320ms] ease-[var(--ease-out)]',
          hoverSidebar ? 'md:pl-3' : compact ? 'md:pl-[4.5rem]' : 'md:pl-60',
        )}
      >
        {showTopBar && (
          <div
            data-glass-bar
            className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line/45 px-5 md:px-7"
          >
            <div className="flex items-center gap-1 md:hidden">
              {[...FLAT, SETTINGS_ITEM].map((item) => {
                // 0.5.0：与侧栏一致用前缀匹配，否则进 /projects/<id> 后顶栏一个都不高亮
                const active =
                  pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'ps-pressable rounded-lg p-2 transition-colors duration-200',
                      active ? 'bg-ink text-paper' : 'text-ink-mid hover:bg-ink/6 hover:text-ink',
                    )}
                    aria-label={item.label}
                  >
                    <Icon className="h-4 w-4" />
                  </Link>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
        )}

        <div
          key={pathname}
          className={cn(
            'ps-page-shell',
            animations && (direction === 'next' ? 'ps-page-next' : 'ps-page-prev'),
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
  const itemRefs = useRef(new Map<string, HTMLAnchorElement>());
  const barRef = useRef<HTMLSpanElement>(null);
  const prevPos = useRef<IndicatorPos | null>(readLastIndicator(compact));

  const activeHref =
    [...FLAT, SETTINGS_ITEM].find(
      (item) => pathname === item.href || pathname.startsWith(item.href + '/'),
    )?.href ?? '';

  /**
   * 0.4.2：滑条改成 WAAPI（element.animate）。
   *
   * 之前两版都失败，根因是每个页面各自渲染 AppShell：导航时侧栏连同滑条一起
   * 卸载重建，CSS transition 需要「元素带着旧样式先绘制一帧」才会动；
   * 新元素第一次绘制就是目标位置，所以永远是瞬移。
   *
   * 用 element.animate 显式给出 起点 → 拉丝 → 终点 三个关键帧，
   * 元素哪怕是刚挂上去的，也会真的从旧位置滑过来。
   */
  useEffect(() => {
    const item = itemRefs.current.get(activeHref);
    const bar = barRef.current;
    const root = rootRef.current;
    if (!item || !bar || !root) {
      if (bar) bar.style.opacity = '0';
      return;
    }

    // 用 rect 差值测量：侧栏本身不带 transform，换页动画只作用在内容区，
    // 所以这里的坐标是稳定的，不会像全局 getBoundingClientRect 那样漂移。
    const measure = (el: HTMLElement): IndicatorPos => {
      const rect = el.getBoundingClientRect();
      const base = root.getBoundingClientRect();
      return { top: rect.top - base.top, height: rect.height };
    };

    const target = measure(item);
    const from = prevPos.current;
    prevPos.current = target;
    lastIndicatorValue = { ...target, compact };

    let applied: IndicatorPos = { ...target };

    const apply = (pos: IndicatorPos): void => {
      applied = { ...pos };
      bar.style.transform = `translateY(${pos.top}px)`;
      bar.style.height = `${pos.height}px`;
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
      const now = measure(item);
      if (Math.abs(now.top - applied.top) > 0.5 || Math.abs(now.height - applied.height) > 0.5) {
        apply(now);
        prevPos.current = now;
        lastIndicatorValue = { ...now, compact };
        return true;
      }
      return false;
    };

    // 首次出现（没有上一项）：直接落位，只做淡入
    const first = !from || Math.abs(from.top - target.top) < 0.5;

    if (first) {
      apply(target);
      bar.style.opacity = '1';
      bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    } else {
      const distance = Math.abs(target.top - from.top);
      const movingUp = target.top < from.top;

      // 拉丝：起点与终点之间短暂连成一条，长度封顶，避免盖住底部「本地存储」
      const extra = Math.min(distance * 0.28, 22);
      const top = Math.min(from.top, target.top) - (movingUp ? extra * 0.5 : 0);
      const height = Math.max(from.height, target.height) + extra;
      const stretched: IndicatorPos = { top, height };

      apply(target);
      bar.style.opacity = '1';

      const duration = Math.round(Math.min(520, 240 + distance * 0.45));

      bar.animate(
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

    // 校正一：动画结束后（含动画期间发生的漂移）再对一次
    let raf = 0;
    let frames = 0;
    const tick = (): void => {
      sync();
      frames += 1;
      if (frames < 120) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // 校正二：任何后续的尺寸变化（窗口缩放、字体加载、用量刷新）都重新落位
    const ro = new ResizeObserver(() => sync());
    ro.observe(root);
    if (item.parentElement) ro.observe(item.parentElement);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [activeHref, compact]);

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
      {/* 当前选中项指示条（位置由 WAAPI 驱动，详见上方 useEffect） */}
      <span
        ref={barRef}
        aria-hidden
        className="pointer-events-none absolute left-0 z-10 w-[3px] rounded-full bg-ink opacity-0"
        style={{ top: 0, height: 0, transform: 'translateY(0px)' }}
      />
      {/* 顶部：品牌 + 折叠按钮 */}
      <div className={cn('mb-7 flex items-center gap-2.5', compact ? 'justify-center' : 'px-1')}>
        <Link
          href="/home"
          onClick={onNavigate}
          className="ps-pressable group flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-ink text-paper shadow-[0_2px_8px_-4px_rgba(0,0,0,0.5)]"
          title={APP_NAME}
        >
          <Images className="h-[15px] w-[15px] transition-transform duration-[var(--dur-3)] group-hover:scale-110" />
        </Link>
        {!compact && (
          <span
            data-sidebar-label
            className="truncate text-[14px] font-semibold tracking-[-0.01em]"
          >
            {APP_NAME}
          </span>
        )}
        {!compact && (
          <button
            type="button"
            onClick={onToggleCollapse}
            disabled={collapseDisabled}
            title={collapseDisabled ? '悬浮模式下不支持折叠' : '收起文字，只显示图标'}
            aria-label="折叠功能栏"
            className={cn(
              'ps-pressable ml-auto flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
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

      <div className="relative grid gap-6">
        {GROUPS.map((group) => (
          <div key={group.title} className="grid gap-0.5">
            {!compact && (
              <p
                data-sidebar-label
                className="px-3 pb-1.5 text-[10px] font-medium tracking-[0.18em] text-ink-faint uppercase"
              >
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

      {/* 底部：设置 + 存储 + 版本（0.5.1：压成两行，与导航之间加一道细线分区） */}
      <div className={cn('mt-auto grid gap-1 border-t border-line/40 pt-3', compact ? 'px-0' : 'px-0')}>
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
          <div className="grid gap-1.5 px-3 pb-1">
            {usage && usage.quota > 0 && (
              <div
                className="group/storage grid gap-1"
                title={`${formatBytes(usage.usage)} / ${formatBytes(usage.quota)}`}
              >
                <div className="flex items-center justify-between text-[10.5px] text-ink-faint">
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatBytes(usage.usage)}
                  </span>
                  <span className="tabular-nums">
                    {Math.round((usage.usage / usage.quota) * 100)}%
                  </span>
                </div>
                <div className="h-[3px] w-full overflow-hidden rounded-full bg-ink/8">
                  <div
                    className="h-full rounded-full bg-ink/45 transition-[width] duration-700 ease-[var(--ease-out)]"
                    style={{
                      width: `${Math.min(100, Math.max(2, (usage.usage / usage.quota) * 100))}%`,
                    }}
                  />
                </div>
              </div>
            )}
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
      title={hint ? (compact ? `${item.label} — ${hint}` : hint) : compact ? item.label : undefined}
      aria-label={hint ? `${item.label}：${hint}` : item.label}
      className={cn(
        'ps-pressable group/nav relative flex items-center rounded-[9px] text-[13.5px] font-medium transition-[background-color,color] duration-[var(--dur-2)]',
        compact ? 'h-10 justify-center' : 'gap-2.5 px-3 py-[7px]',
        active
          ? 'bg-ink text-paper'
          : 'text-ink-mid hover:bg-ink/[0.055] hover:text-ink',
      )}
    >
      <Icon
        className={cn(
          'h-4 w-4 shrink-0 transition-transform duration-[var(--dur-3)] ease-[var(--ease-spring)]',
          !active && 'group-hover/nav:scale-[1.08]',
        )}
      />
      {!compact && <span data-sidebar-label>{item.label}</span>}
    </Link>
  );
}
