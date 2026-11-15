// src/app/layout.tsx
import type { Metadata } from 'next';
import { Toaster } from '@/components/ui/sonner';
import { APP_DESCRIPTION, APP_NAME, APP_NAME_EN } from '@/config/app';
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
 * 深色模式闪白的根因：主题要等 React 水合后才挂到 <html>，
 * 首帧和路由切换会先画出浅色底。
 * 这里在 <head> 里同步读 localStorage 并打上 data-theme，早于首帧绘制。
 */
const APPEARANCE_SCRIPT = `(function(){try{
var raw=localStorage.getItem('ps:appearance');
var s=raw?JSON.parse(raw):{};
var d=document.documentElement;
var dark;
if(s.themeMode==='dark'){dark=true;}
else if(s.themeMode==='light'){dark=false;}
else if(s.themeMode==='system'){dark=window.matchMedia('(prefers-color-scheme: dark)').matches;}
else {dark=!!s.darkMode;}
d.dataset.theme=dark?'dark':'light';
d.dataset.themeMode=s.themeMode||'system';
d.dataset.glass=s.glass?'on':'off';
d.dataset.font=s.fontFamily||'round';
// 0.4.1：侧栏折叠状态在首帧前就落地，避免重挂载瞬间又画出文字
try{var c=localStorage.getItem('ps:sidebar-collapsed');if(c!==null){d.dataset.sidebar=c==='1'?'compact':'expanded';}}catch(e){}
if(typeof s.glassBlur==='number'){d.style.setProperty('--glass-blur',s.glassBlur+'px');}
d.style.colorScheme=dark?'dark':'light';
}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_SCRIPT }} />
      </head>
      <body className="min-h-dvh bg-paper text-ink antialiased">
        {children}
        <Toaster position="top-center" closeButton richColors={false} />
      </body>
    </html>
  );
}
