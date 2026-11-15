// src/lib/appearance.ts
// 外观（主题 / 玻璃 / 字体）的唯一写入点：
// 同时更新 <html> 上的标记、CSS 变量与 localStorage，保证首帧不闪。

import type { FontFamily, ThemeMode } from '@/types/domain';

export interface Appearance {
  /** 旧字段，保留用于兼容；实际以 themeMode 为准 */
  darkMode: boolean;
  themeMode: ThemeMode;
  glass: boolean;
  glassBlur: number;
  fontFamily: FontFamily;
}

export const DEFAULT_APPEARANCE: Appearance = {
  darkMode: false,
  themeMode: 'system',
  glass: false,
  glassBlur: 24,
  fontFamily: 'round',
};

const STORAGE_KEY = 'ps:appearance';

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** 根据主题模式解析出最终是否深色 */
export function resolveDark(mode: ThemeMode, fallback: boolean): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return systemPrefersDark() || fallback;
}

export function readStoredAppearance(): Appearance {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return { ...DEFAULT_APPEARANCE, ...parsed };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** 应用外观到 DOM（可在任意时刻调用，立即生效） */
export function applyAppearance(appearance: Appearance): void {
  if (typeof document === 'undefined') return;

  const dark = resolveDark(appearance.themeMode, appearance.darkMode);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.themeMode = appearance.themeMode;
  root.dataset.glass = appearance.glass ? 'on' : 'off';
  root.dataset.font = appearance.fontFamily;
  root.style.setProperty('--glass-blur', `${appearance.glassBlur}px`);
  root.style.colorScheme = dark ? 'dark' : 'light';

  // 让 Electron 的原生标题栏也跟着变（Windows 11 会跟随 dark 主题）
  const api = typeof window !== 'undefined' ? window.photoStory : undefined;
  if (api?.setThemeSource) {
    void api.setThemeSource(appearance.themeMode).catch(() => undefined);
  }

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...appearance, darkMode: dark }),
    );
  } catch {
    // 隐私模式写不了就算了
  }
}
