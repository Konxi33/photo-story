// src/app/layout.tsx
import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { cookies } from 'next/headers';
import { Toaster } from '@/components/ui/sonner';
import { APP_DESCRIPTION, APP_NAME, APP_NAME_EN } from '@/config/app';
import { UI_COOKIE, SIDEBAR_COOKIE } from '@/lib/appearance';
import { MOTION_COOKIE, MOTION_REGIONS, readMotionCookie, resolveMotion } from '@/lib/motion-prefs';
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
try{
  var m=localStorage.getItem('ps:motion');
  if(m){
    var mo=JSON.parse(m)||{};var lv=mo.level||'full';var rg=mo.regions||{};
    if(lv==='off'){lv='off';}
    set('motion',lv);
    var names=['page','cards','wall','sidebar','dialogs','numbers','background'];
    for(var i=0;i<names.length;i++){
      var n=names[i];var on=rg[n]!==false&&lv!=='off';
      set('motion'+n.charAt(0).toUpperCase()+n.slice(1),on?'on':'off');
    }
    // 0.8.0：JS 动效（数字滚动、侧栏指示条）按这个倍数算时长。
    // 不写的话首帧读到的 --motion-scale 是空串，Number('') 是 0，动画会直接跳到终点。
    // 注意：setProperty 会走 CSSOM 重新序列化整个 style 属性（"a:1" 会变成 "a: 1;"），
    // 哪怕写进去的值一模一样，<html> 的 style 字符串也变了 —— 根元素上就是一次水合失败。
    // 所以先读、真的不同才写。（0.8.0 实测：这一行让 15 条路由全部抛 #418。）
    var sc = lv==='off'?0:(lv==='minimal'?0.45:(lv==='normal'?0.8:1));
    if(d.style.getPropertyValue('--motion-scale')!==String(sc)){d.style.setProperty('--motion-scale',String(sc));}
  }
}catch(e){}
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
  // 0.8.0：动效偏好也走 cookie，服务端直接画成 data-motion-* —— 首帧就不会「先动一下再停」
  const motion = resolveMotion(readMotionCookie(jar.get(MOTION_COOKIE)?.value), false);
  const motionAttrs = MOTION_REGIONS.reduce<Record<string, string>>((acc, region) => {
    const key = `data-motion-${region}`;
    acc[key] = motion.regions[region] && motion.level !== 'off' ? 'on' : 'off';
    return acc;
  }, {});

  // 首帧就把主题、玻璃、字体、侧栏密度画进 HTML，React 水合时两边一致。
  const htmlStyle = {
    '--glass-blur': `${ui.blur}px`,
    '--motion-scale': String(motion.scale),
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
      data-motion={motion.level}
      {...motionAttrs}
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
