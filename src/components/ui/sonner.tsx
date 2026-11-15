'use client';

import { useEffect, useState } from 'react';
import { Toaster as SonnerToaster, type ToasterProps } from 'sonner';

/**
 * 0.5.1：toast 跟随应用主题（原来是硬编码 light，深色模式下弹出一条白条）。
 * 主题由 <html data-theme> 驱动，这里用 MutationObserver 同步，
 * 顺便跟随「跟随系统」时的 prefers-color-scheme 变化。
 */
function useResolvedTheme(): 'light' | 'dark' {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const read = (): void => {
      const mode = root.dataset.themeMode ?? 'system';
      const dark =
        mode === 'dark' || (mode === 'system' && media.matches) || root.dataset.theme === 'dark';
      setTheme(dark ? 'dark' : 'light');
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-themeMode'] });
    media.addEventListener('change', read);

    return () => {
      observer.disconnect();
      media.removeEventListener('change', read);
    };
  }, []);

  return theme;
}

const Toaster = (props: ToasterProps) => {
  const theme = useResolvedTheme();

  return (
    <SonnerToaster
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast !rounded-xl !border-line/70 !bg-popover/97 !text-ink !shadow-[var(--elev-3)] !backdrop-blur-xl',
          title: '!text-[13px] !font-medium !text-ink',
          description: '!text-[12px] !text-ink-mid',
          actionButton: '!rounded-full !bg-ink !text-paper',
          cancelButton: '!rounded-full !bg-surface-2 !text-ink-mid',
          closeButton: '!border-line/70 !bg-popover !text-ink-faint hover:!text-ink',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
