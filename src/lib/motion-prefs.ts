import type { MotionLevel, MotionRegion, MotionSettings } from '@/types/domain';

/**
 * 0.8.0 动效偏好
 * ---------------------------------------------------------------------------
 * 需求来源：用户希望「动效像 3D 一样丝滑」，同时要照顾低性能机器，
 * 能在设置里**按区域**关掉动效。
 *
 * 这里只管「偏好」——真正动起来的是 globals.css 里的 `[data-motion-*]` 规则，
 * 以及少数 JS 驱动的动效（侧栏指示条、照片墙惯性、数字滚动）在调用前用
 * `motionEnabled()` 问一句。
 *
 * 四个档位：
 *   full    完整：3D 景深转场、卡片抬升、滚动进场、错峰、背景呼吸
 *   normal  标准：去掉 3D 旋转（只保留位移与淡入），其余照旧
 *   minimal 克制：只留淡入淡出，位移 ≤4px，没有错峰与视差
 *   off     关闭：所有动画时长压到 1ms，界面立刻到位
 *
 * 系统开了「减少动态效果」（prefers-reduced-motion: reduce）时，
 * 自动降到 minimal，并且**不允许**用户手动改回 full（避免晕动症用户被自己的设置坑到）。
 */

export const MOTION_REGIONS: MotionRegion[] = [
  'page',
  'cards',
  'wall',
  'sidebar',
  'dialogs',
  'numbers',
  'background',
];

export const MOTION_REGION_INFO: Record<MotionRegion, { label: string; hint: string }> = {
  page: { label: '页面切换', hint: '切换左侧菜单时，页面按方向推进或后退' },
  cards: { label: '卡片与列表', hint: '滚动进场、错峰出现、悬停抬起' },
  wall: { label: '照片墙', hint: '拖动时的惯性、缩放与距离场' },
  sidebar: { label: '侧栏指示条', hint: '选中项左侧那根小滑条' },
  dialogs: { label: '对话框与面板', hint: '弹出的窗口从下方长出来并带一点景深' },
  numbers: { label: '数字滚动', hint: '统计数字从 0 滚到真实值' },
  background: { label: '背景光斑', hint: '页面背景的暖光缓慢呼吸' },
};

export const MOTION_LEVELS: { id: MotionLevel; label: string; hint: string }[] = [
  { id: 'full', label: '完整', hint: '3D 景深转场、卡片抬升、滚动进场全开（默认）' },
  { id: 'normal', label: '标准', hint: '保留位移与淡入，去掉 3D 旋转与视差' },
  { id: 'minimal', label: '克制', hint: '只留淡入淡出，位移不超过 4px' },
  { id: 'off', label: '关闭', hint: '不动，界面直接到位（最省电）' },
];

export const MOTION_STORAGE_KEY = 'ps:motion';
export const MOTION_COOKIE = 'ps_mo';

export function allMotionRegions(on: boolean): Record<MotionRegion, boolean> {
  return MOTION_REGIONS.reduce(
    (acc, region) => {
      acc[region] = on;
      return acc;
    },
    {} as Record<MotionRegion, boolean>,
  );
}

export const DEFAULT_MOTION: MotionSettings = {
  level: 'full',
  regions: allMotionRegions(true),
};

function normalizeLevel(value: unknown): MotionLevel {
  return value === 'full' || value === 'normal' || value === 'minimal' || value === 'off' ? value : 'full';
}

export function normalizeMotion(input: unknown): MotionSettings {
  const raw = (input ?? {}) as Partial<MotionSettings> & { animations?: boolean };
  // 兼容 0.7.x 的单一开关：settings.animations === false 一律视为「关闭」
  if (raw.animations === false) {
    return { level: 'off', regions: allMotionRegions(false) };
  }
  const regions = allMotionRegions(true);
  if (raw.regions && typeof raw.regions === 'object') {
    for (const region of MOTION_REGIONS) {
      const value = (raw.regions as Record<string, unknown>)[region];
      if (typeof value === 'boolean') regions[region] = value;
    }
  }
  return { level: normalizeLevel(raw.level), regions };
}

/** 读 cookie（服务端首帧用，避免先动一下再停） */
export function readMotionCookie(value: string | undefined | null): MotionSettings {
  if (!value) return DEFAULT_MOTION;
  // 形如 `full|1,1,1,1,1,1,1`
  const [levelRaw, flagsRaw] = value.split('|');
  const level = normalizeLevel(levelRaw);
  const regions = allMotionRegions(true);
  if (flagsRaw) {
    const flags = flagsRaw.split(',');
    MOTION_REGIONS.forEach((region, index) => {
      if (flags[index] === '0') regions[region] = false;
    });
  }
  return { level, regions };
}

function writeCookie(motion: MotionSettings): void {
  if (typeof document === 'undefined') return;
  const flags = MOTION_REGIONS.map((region) => (motion.regions[region] ? '1' : '0')).join(',');
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${MOTION_COOKIE}=${motion.level}|${flags}; path=/; max-age=${maxAge}; samesite=lax`;
}

export function readStoredMotion(): MotionSettings {
  if (typeof window === 'undefined') return DEFAULT_MOTION;
  try {
    const raw = window.localStorage.getItem(MOTION_STORAGE_KEY);
    if (!raw) return readMotionCookie(document.cookie.match(/(?:^|;\s*)ps_mo=([^;]+)/)?.[1]);
    return normalizeMotion(JSON.parse(raw));
  } catch {
    return DEFAULT_MOTION;
  }
}

export function systemPrefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface ResolvedMotion {
  level: MotionLevel;
  regions: Record<MotionRegion, boolean>;
  /** 动效是否被系统「减少动态效果」压低过 */
  reduced: boolean;
  /** 0（关）~1（完整），给 JS 动效算缩放用 */
  scale: number;
}

export function resolveMotion(motion: MotionSettings, reduced = systemPrefersReducedMotion()): ResolvedMotion {
  if (motion.level === 'off') {
    return { level: 'off', regions: allMotionRegions(false), reduced, scale: 0 };
  }
  const level: MotionLevel = reduced && (motion.level === 'full' || motion.level === 'normal') ? 'minimal' : motion.level;
  const scale = level === 'minimal' ? 0.45 : level === 'normal' ? 0.8 : 1;
  return { level, regions: motion.regions, reduced, scale };
}

/**
 * 把偏好写到 <html> 上，CSS 与 JS 都从这里读。
 * `persist = false` 用于设置页的「实时预览」——只改当前这一屏，
 * 用户没点保存就离开时，下次启动仍按老偏好走。
 */
export function applyMotion(motion: MotionSettings, persist = true): ResolvedMotion {
  const resolved = resolveMotion(motion);
  if (typeof document !== 'undefined') {
    const root = document.documentElement;
    root.dataset.motion = resolved.level;
    root.dataset.motionReduced = resolved.reduced ? 'true' : 'false';
    for (const region of MOTION_REGIONS) {
      // 区域开关只在未被总档位关掉时才生效；总档位一旦 off，全部是 off
      const on = resolved.level !== 'off' && motion.regions[region];
      root.dataset[`motion${region[0].toUpperCase()}${region.slice(1)}`] = on ? 'on' : 'off';
    }
    root.style.setProperty('--motion-scale', String(resolved.scale));
    if (!persist) return resolved;
    try {
      window.localStorage.setItem(MOTION_STORAGE_KEY, JSON.stringify({ level: motion.level, regions: motion.regions }));
    } catch {
      /* 隐私模式下写不进去就算了 */
    }
    // cookie 里存**用户自己选的**档位，不存 resolved 的降档结果：
    // 系统开了「减少动态」时 resolved 会降到克制，要是把这个降档写进 cookie，
    // 用户在系统里关掉那个开关之后，动画也回不来了。
    writeCookie({ level: motion.level, regions: motion.regions });
  }
  return resolved;
}

/** JS 驱动的动效在开始之前问一句：这个区域现在允许动吗？ */
export function motionEnabled(region: MotionRegion): boolean {
  if (typeof document === 'undefined') return true;
  const value = document.documentElement.dataset[`motion${region[0].toUpperCase()}${region.slice(1)}`];
  return value !== 'off';
}

/** 时长倍数：off 直接 0，供 setTimeout / WAAPI duration 使用 */
export function motionScale(): number {
  if (typeof document === 'undefined') return 1;
  const raw = document.documentElement.style.getPropertyValue('--motion-scale').trim();
  // 空字符串不能当 0 用：`Number('')` 是 0，会让「还没 applyMotion 的第一帧」
  // 把所有 JS 动效的时长算成 0（数字滚动直接跳到结果）。没设过就是 1。
  if (!raw) return 1;
  const scale = Number(raw);
  return Number.isFinite(scale) && scale >= 0 ? scale : 1;
}
