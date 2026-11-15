// src/lib/motion.ts
// 0.5.2：一处收口「从缩略图长成大图」的过渡。
//
// 为什么不用 CSS：FLIP 需要运行时才知道缩略图与大图各自的屏幕位置，
// CSS 类没法表达「从 (x1,y1,w1,h1) 长到 (x2,y2,w2,h2)」。
// 这里用 WAAPI 显式给首尾两帧，浏览器自己补中间帧，全程在合成器上跑。

/** 屏幕上的一块矩形（通常来自 getBoundingClientRect） */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectToScreenRect(rect: DOMRect | ClientRect): ScreenRect {
  return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
}

const EASE_SPRING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 0.7, 1)';

function reduceMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 从缩略图位置放大展开。
 * 没有 origin（例如键盘打开、页面直达）时退化成「轻微上浮 + 淡入」，不会显得生硬。
 */
export function growFrom(el: HTMLElement, origin?: ScreenRect | null): Animation {
  if (reduceMotion()) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 160,
      easing: 'linear',
      fill: 'both',
    });
  }

  const target = el.getBoundingClientRect();

  if (!origin || origin.w <= 0 || origin.h <= 0) {
    return el.animate(
      [
        { opacity: 0, transform: 'translate3d(0, 14px, 0) scale(0.972)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
      ],
      { duration: 300, easing: EASE_SPRING, fill: 'both' },
    );
  }

  // 让面板的中心对准缩略图的中心，并按面积比例缩到最小——视觉上像从那个洞眼里长出来
  const dx = origin.x + origin.w / 2 - (target.left + target.width / 2);
  const dy = origin.y + origin.h / 2 - (target.top + target.height / 2);
  const scale = Math.min(
    0.92,
    Math.max(0.16, Math.min(origin.w / Math.max(target.width, 1), origin.h / Math.max(target.height, 1))),
  );

  return el.animate(
    [
      {
        opacity: 0,
        transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`,
      },
      { opacity: 0.72, offset: 0.55 },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ],
    { duration: 420, easing: EASE_SPRING, fill: 'both' },
  );
}

/**
 * 收起：缩回缩略图位置。返回 Promise，调用方 await 之后再卸载，
 * 这样关闭也有落点，而不是「啪」地消失。
 */
export async function shrinkTo(el: HTMLElement, origin?: ScreenRect | null): Promise<void> {
  if (reduceMotion()) return;

  const target = el.getBoundingClientRect();
  const keyframes: Keyframe[] = origin && origin.w > 0
    ? [
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        {
          opacity: 0,
          transform: `translate3d(${(origin.x + origin.w / 2 - (target.left + target.width / 2)).toFixed(1)}px, ${(
            origin.y +
            origin.h / 2 -
            (target.top + target.height / 2)
          ).toFixed(1)}px, 0) scale(${Math.max(
            0.16,
            Math.min(origin.w / Math.max(target.width, 1), origin.h / Math.max(target.height, 1)),
          ).toFixed(3)})`,
        },
      ]
    : [
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
        { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.975)' },
      ];

  const anim = el.animate(keyframes, { duration: 220, easing: EASE_IN, fill: 'both' });
  await new Promise<void>((resolve) => {
    anim.onfinish = () => resolve();
    anim.oncancel = () => resolve();
    // 极端情况下（标签页被挂起）动画事件可能不派发，兜一层超时
    window.setTimeout(resolve, 400);
  });
}

/** 切换照片时的横向滑入：dir = 1 表示往后翻（内容从右侧进来） */
export function slideIn(el: HTMLElement, dir: 1 | -1): Animation {
  if (reduceMotion()) {
    return el.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 150,
      easing: 'linear',
      fill: 'both',
    });
  }
  return el.animate(
    [
      { opacity: 0, transform: `translate3d(${dir * 34}px, 0, 0) scale(0.985)` },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' },
    ],
    { duration: 320, easing: EASE_SPRING, fill: 'both' },
  );
}
