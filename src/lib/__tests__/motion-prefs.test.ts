// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MOTION,
  MOTION_REGIONS,
  MOTION_STORAGE_KEY,
  allMotionRegions,
  applyMotion,
  motionEnabled,
  motionScale,
  normalizeMotion,
  readMotionCookie,
  resolveMotion,
} from '@/lib/motion-prefs';

describe('allMotionRegions', () => {
  it('每个区域都被写到', () => {
    const on = allMotionRegions(true);
    expect(Object.keys(on).sort()).toEqual([...MOTION_REGIONS].sort());
    expect(MOTION_REGIONS.every((r) => on[r])).toBe(true);
    expect(MOTION_REGIONS.some((r) => allMotionRegions(false)[r])).toBe(false);
  });
});

describe('normalizeMotion', () => {
  it('空值给默认（完整 + 全开）', () => {
    expect(normalizeMotion(undefined)).toEqual(DEFAULT_MOTION);
    expect(normalizeMotion(null)).toEqual(DEFAULT_MOTION);
    expect(normalizeMotion({})).toEqual(DEFAULT_MOTION);
  });

  it('未知档位回落 full，未知字段忽略', () => {
    const motion = normalizeMotion({ level: 'turbo', regions: { page: false, nope: true } });
    expect(motion.level).toBe('full');
    expect(motion.regions.page).toBe(false);
    expect(motion.regions.cards).toBe(true);
    expect('nope' in motion.regions).toBe(false);
  });

  it('兼容 0.7.x 的 animations:false → 关', () => {
    const motion = normalizeMotion({ animations: false, level: 'full' });
    expect(motion.level).toBe('off');
    expect(motion.regions.page).toBe(false);
    expect(motion.regions.background).toBe(false);
  });

  it('非布尔区域值不会把开关弄坏', () => {
    const motion = normalizeMotion({ level: 'normal', regions: { page: 'no' } });
    expect(motion.regions.page).toBe(true);
  });
});

describe('readMotionCookie', () => {
  it('没有 cookie 用默认', () => {
    expect(readMotionCookie(undefined)).toEqual(DEFAULT_MOTION);
    expect(readMotionCookie('')).toEqual(DEFAULT_MOTION);
  });

  it('解析档位 + 七个标志位', () => {
    const motion = readMotionCookie('minimal|0,1,1,0,1,1,1');
    expect(motion.level).toBe('minimal');
    expect(motion.regions.page).toBe(false);
    expect(motion.regions.cards).toBe(true);
    expect(motion.regions.sidebar).toBe(false);
  });

  it('标志位缺失/乱写时按开处理', () => {
    const motion = readMotionCookie('full|x,1');
    expect(motion.level).toBe('full');
    expect(motion.regions.page).toBe(true);
    expect(motion.regions.wall).toBe(true);
  });
});

describe('resolveMotion', () => {
  it('off 一把关掉所有区域，倍数为 0', () => {
    const resolved = resolveMotion({ level: 'off', regions: allMotionRegions(true) }, false);
    expect(resolved.level).toBe('off');
    expect(resolved.scale).toBe(0);
    expect(MOTION_REGIONS.some((r) => resolved.regions[r])).toBe(false);
  });

  it('系统要求减少动态时，完整/标准都降到克制', () => {
    const reduced = resolveMotion({ level: 'full', regions: allMotionRegions(true) }, true);
    expect(reduced.level).toBe('minimal');
    expect(reduced.reduced).toBe(true);
    expect(reduced.scale).toBe(0.45);
  });

  it('已经是关的，不再被 reduced 往上提', () => {
    expect(resolveMotion({ level: 'off', regions: allMotionRegions(true) }, true).level).toBe('off');
  });

  it('没有 reduced 时按用户选的档位给倍数', () => {
    expect(resolveMotion({ level: 'full', regions: allMotionRegions(true) }, false).scale).toBe(1);
    expect(resolveMotion({ level: 'normal', regions: allMotionRegions(true) }, false).scale).toBe(0.8);
    expect(resolveMotion({ level: 'minimal', regions: allMotionRegions(true) }, false).scale).toBe(0.45);
  });
});

describe('applyMotion / motionEnabled / motionScale', () => {
  // 这台机器上的 jsdom 有时不给 localStorage（源不透明/版本差异），
  // 没有就装一个内存版，测的是 applyMotion 的行为而不是 jsdom 的实现
  const memory = new Map<string, string>();
  beforeAll(() => {
    if (!window.localStorage) {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: (key: string) => memory.get(key) ?? null,
          setItem: (key: string, value: string) => void memory.set(key, String(value)),
          removeItem: (key: string) => void memory.delete(key),
          clear: () => memory.clear(),
          key: (index: number) => [...memory.keys()][index] ?? null,
          get length() {
            return memory.size;
          },
        },
      });
    }
  });

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    for (const attr of ['data-motion', 'data-motion-reduced']) {
      document.documentElement.removeAttribute(attr);
    }
    for (const region of MOTION_REGIONS) {
      document.documentElement.removeAttribute(`data-motion-${region}`);
    }
    memory.clear();
    window.localStorage.clear();
  });

  it('把档位与区域写到 html 上', () => {
    applyMotion({ level: 'normal', regions: { ...allMotionRegions(true), wall: false } }, false);
    const root = document.documentElement;
    expect(root.dataset.motion).toBe('normal');
    expect(root.dataset.motionWall).toBe('off');
    expect(root.dataset.motionPage).toBe('on');
    expect(root.style.getPropertyValue('--motion-scale')).toBe('0.8');
    expect(motionEnabled('wall')).toBe(false);
    expect(motionEnabled('page')).toBe(true);
    expect(motionScale()).toBe(0.8);
  });

  it('档位是 off 时，区域开关一律 off', () => {
    applyMotion({ level: 'off', regions: allMotionRegions(true) }, false);
    expect(motionEnabled('page')).toBe(false);
    expect(motionEnabled('numbers')).toBe(false);
  });

  it('persist=false 不落盘（设置页预览用）', () => {
    applyMotion({ level: 'minimal', regions: allMotionRegions(false) }, false);
    expect(window.localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
    expect(document.cookie).not.toContain('ps_mo=minimal');
  });

  it('persist=true 写 localStorage 与 cookie，且 cookie 记的是用户原档位', () => {
    applyMotion({ level: 'full', regions: { ...allMotionRegions(true), cards: false } });
    const raw = JSON.parse(window.localStorage.getItem(MOTION_STORAGE_KEY) ?? 'null');
    expect(raw.level).toBe('full');
    expect(raw.regions.cards).toBe(false);
    // 系统开了「减少动态」时 resolved 会降档，但 cookie 要记用户自己选的 full，
    // 否则关掉系统设置之后动画回不来
    expect(document.cookie).toContain('ps_mo=full|1,0,1,1,1,1,1');
  });

  it('没有任何标记时默认允许动效、倍数 1', () => {
    expect(motionEnabled('cards')).toBe(true);
    expect(motionScale()).toBe(1);
  });
});
