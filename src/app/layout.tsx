// src/app/layout.tsx
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { cookies } from 'next/headers';
import { Toaster } from '@/components/ui/sonner';
import { APP_DESCRIPTION, APP_NAME, APP_NAME_EN } from '@/config/app';
import { UI_COOKIE, SIDEBAR_COOKIE } from '@/lib/appearance';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} · ${APP_DESCRIPTION}`,
    template: `%s · ${APP_NAME}`,
  },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  authors: [{ name: APP_NAME_EN }],
  icons: { icon: '/favicon.svg' },
};

/**
 * 首帧脚本：只在「本地值和服务器渲染出来的值确实不一样」时才动手。
 *
 * 0.7.3 之前它无条件写 <html> 的 data-* ，React 19 会在根元素上比对属性，
 * 于是一次打开就抛一次水合失败（React #418，args=HTML）、整棵树重画。
 * 现在服务端会按 cookie（`ps_ui` / `ps_side`）把同样一份值渲染进 HTML，
 * 正常情况下脚本一个属性都不碰；只有 cookie 过期、或用户刚好在别处改过设置时才补一次。
 */
const APPEARANCE_SCRIPT = `(function(){try{
var d=document.documentElement;
function set(k,v){if(d.dataset[k]!==v){d.dataset[k]=v;}}
var raw=localStorage.getItem('ps:appearance');
if(raw){
  var s=JSON.parse(raw)||{};
  var dark;
  if(s.themeMode==='dark'){dark=true;}
  else if(s.themeMode==='light'){dark=false;}
  else if(s.themeMode==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}
  else {dark=!!s.darkMode;}
  set('theme',dark?'dark':'light');
  set('themeMode',s.themeMode||'system');
  set('glass',s.glass?'on':'off');
  set('font',s.fontFamily||'round');
}
try{var c=localStorage.getItem('ps:sidebar-collapsed');if(c!==null){set('sidebar',c==='1'?'compact':'expanded');}}catch(e){}
}catch(e){}})();`;

type UiState = {
  theme: 'dark' | 'light';
  themeMode: string;
  glass: 'on' | 'off';
  font: string;
  blur: number;
};

function readUi(cookieValue: string | undefined): UiState {
  const [theme, themeMode, glass, font, blur] = (cookieValue ?? '').split('|');
  return {
    theme: theme === 'dark' ? 'dark' : 'light',
    themeMode: themeMode || 'system',
    glass: glass === 'on' ? 'on' : 'off',
    font: font || 'round',
    blur: Number(blur) > 0 ? Number(blur) : 24,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const ui = readUi(jar.get(UI_COOKIE)?.value);
  const sidebar = jar.get(SIDEBAR_COOKIE)?.value === 'compact' ? 'compact' : 'expanded';

  // 首帧就把主题、玻璃、字体、侧栏密度画进 HTML，React 水合时两边一致。
  const htmlStyle = {
    '--glass-blur': `${ui.blur}px`,
    colorScheme: ui.theme,
  } as CSSProperties;

  return (
    <html
      lang="zh-CN"
      data-theme={ui.theme}
      data-theme-mode={ui.themeMode}
      data-glass={ui.glass}
      data-font={ui.font}
      data-sidebar={sidebar}
      style={htmlStyle}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-paper text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
        {children}
        <Toaster position="top-center" closeButton richColors={false} />
      </body>
    </html>
  );
}
