// src/lib/page-veil.ts
/**
 * 0.8.1：进入项目时的那一下「过门」。
 *
 * 为什么需要它：项目工作台（/projects/[id]）不走 AppShell，它有自己的顶栏和
 * 三栏布局，所以 0.8.0 给普通页面做的 3D 转场根本没机会作用到它身上 ——
 * 从项目列表点一张卡，是一帧之内直接换成工作台，看起来像「没做动效」。
 *
 * 这里用一层全屏「帷幕」把这一跳接起来：
 *   · 点击卡片时同步把帷幕盖上来（不拦导航，Link 照常跳，中键/新标签都不受影响）
 *   · 工作台挂载后再把帷幕抹掉，同时工作台自己从 1.6% 缩放收正
 * 合起来就是「镜头推进去、落定」。
 *
 * 只做 opacity + transform，且完全不碰 filter —— 0.8.0 已经吃过一次
 * 「每帧全页高斯模糊」的亏（那张页面在软件合成下 20ms/帧）。
 *
 * 尊重设置里的「动效 · 页面转场」：关掉或系统要求减少动态时，这里直接不动。
 */

import { motionEnabled } from '@/lib/motion-prefs';

const VEIL_ID = 'ps-page-veil';

function veilEnabled(): boolean {
  if (typeof document === 'undefined') return false;
  return motionEnabled('page');
}

function ensureVeil(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(VEIL_ID);
  if (existing) return existing;

  const veil = document.createElement('div');
  veil.id = VEIL_ID;
  veil.setAttribute('aria-hidden', 'true');
  veil.dataset.state = 'in';
  veil.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:80',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'pointer-events:none',
    'background:var(--color-paper)',
    'opacity:0',
  ].join(';');

  // 中间那行小字：分组名 + 项目名，像翻到新一册时的扉页
  const label = document.createElement('div');
  label.style.cssText = [
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:10px',
    'transform:translateY(6px)',
  ].join(';');
  const kicker = document.createElement('span');
  kicker.className = 'ps-cap';
  kicker.textContent = '正在打开';
  kicker.style.cssText = 'font-size:10px;letter-spacing:0.18em;color:var(--color-ink-faint)';
  const name = document.createElement('span');
  name.className = 'ps-serif';
  name.style.cssText = 'font-size:22px;letter-spacing:-0.01em;color:var(--color-ink);max-width:60vw;text-align:center';
  label.append(kicker, name);

  // 一道铜色细线：帷幕合上时从中间往两边扫开，给这半秒一个「动作」
  const seam = document.createElement('span');
  seam.style.cssText = [
    'position:absolute',
    'left:50%',
    'top:calc(50% + 30px)',
    'width:0',
    'height:1px',
    'background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--color-copper) 60%,transparent),transparent)',
    'transform:translateX(-50%)',
  ].join(';');

  veil.append(label, seam);
  document.body.appendChild(veil);
  return veil;
}

/** 盖上来。可在 Link 的 onClick 里同步调用——它只加一层 DOM，不拦默认行为。 */
export function veilIn(projectName?: string): void {
  if (!veilEnabled()) return;
  const veil = ensureVeil();
  if (!veil) return;

  const name = veil.querySelector('span.ps-serif') as HTMLElement | null;
  if (name) name.textContent = projectName ?? '';
  const seam = veil.lastElementChild as HTMLElement | null;

  veil.animate([{ opacity: 0 }, { opacity: 1 }], {
    duration: 170,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards',
  });
  const label = veil.firstElementChild as HTMLElement | null;
  label?.animate([{ transform: 'translateY(6px)' }, { transform: 'translateY(0)' }], {
    duration: 220,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards',
  });
  seam?.animate([{ width: '0px' }, { width: '160px' }], {
    duration: 260,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    fill: 'forwards',
  });
}

/** 抹掉帷幕。新页面挂载后调用，晚一帧再淡出，让底下的内容先完成首帧布局。 */
export function veilOut(delay = 40): void {
  if (typeof document === 'undefined') return;
  const veil = document.getElementById(VEIL_ID);
  if (!veil) return;
  const run = () => {
    const anim = veil.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 240,
      easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
      fill: 'forwards',
    });
    anim.onfinish = () => veil.remove();
    // 兜底：万一 onfinish 没来（标签页切走等），1 秒后强制清掉，别留一层挡路的白幕
    window.setTimeout(() => {
      if (veil.isConnected) veil.remove();
    }, 1000);
  };
  if (delay > 0) window.setTimeout(run, delay);
  else run();
}

/** 有没有一层帷幕正盖着（工作台用它决定要不要播「落定」动画）。 */
export function veilPending(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.getElementById(VEIL_ID));
}
