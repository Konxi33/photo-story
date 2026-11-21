'use client';

// 外观一键切换（跟随系统 → 浅色 → 深色 循环）。
// 0.7.1：原来只有设置页能改主题，用户抱怨「改回浅色有的时候不生效」时
// 也很难确认到底切没切成功。这里放一个随时可见的小按钮，
// 状态直接读 localStorage（applyAppearance 的唯一写入点），不依赖任何页面的表单 state。

import { Monitor, Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  DEFAULT_APPEARANCE,
  applyAppearance,
  readStoredAppearance,
  resolveDark,
  type Appearance,
} from '@/lib/appearance';
import type { ThemeMode } from '@/types/domain';

const ORDER: ThemeMode[] = ['system', 'light', 'dark'];

const LABEL: Record<ThemeMode, string> = {
  system: '跟随系统',
  light: '浅色',
  dark: '深色',
};

export function ThemeToggle({ className }: { className?: string }): React.ReactElement {
  // 0.7.3：首帧必须和服务器渲染的一致，否则 React 判定水合失败（生产包里报 #418）。
  // 之前这里在 useState 初始化里读 localStorage——服务端读不到、客户端读到了，
  // 图标与 aria-label 对不上，于是每次打开都会抛一次并整棵树重渲。初值改回默认值，
  // 挂载后再同步一次真实外观。
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  // 挂载后同步 + 别的窗口/别的开关改了外观时跟着更新图标
  useEffect(() => {
    const sync = (): void => setAppearance(readStoredAppearance());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('ps:appearance-changed', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('ps:appearance-changed', sync);
    };
  }, []);

  const cycle = useCallback((): void => {
    const current = readStoredAppearance();
    const next = ORDER[(ORDER.indexOf(current.themeMode) + 1) % ORDER.length];
    const nextAppearance: Appearance = {
      ...current,
      themeMode: next,
      darkMode: resolveDark(next, current.darkMode),
    };
    applyAppearance(nextAppearance);
    setAppearance(nextAppearance);
    window.dispatchEvent(new CustomEvent('ps:appearance-changed'));
  }, []);

  const Icon = appearance.themeMode === 'dark' ? Moon : appearance.themeMode === 'light' ? Sun : Monitor;

  return (
    <button
      type="button"
      onClick={cycle}
      title={`外观：${LABEL[appearance.themeMode]}（点一下切下一个）`}
      aria-label={`外观：${LABEL[appearance.themeMode]}，点击切换`}
      className={`ps-chip h-8 w-8 justify-center px-0 ${className ?? ''}`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
