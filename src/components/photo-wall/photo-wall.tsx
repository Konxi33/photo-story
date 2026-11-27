'use client';

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Maximize2, Minimize2, RotateCcw, X } from 'lucide-react';
import type { Photo } from '@/types/domain';
import { motionEnabled } from '@/lib/motion-prefs';
import { loadPreview, peekPreview } from './preview-cache';
import { fieldAt, fieldRadius } from './wall-field';

/** 方块之间的均匀间隙 / 方块边长（窄屏换成小一号） */
const GAP = 16;
const TILE_WIDE = 208;
const TILE_NARROW = 126;
const NARROW_MAX = 768;

/** 每帧「当前值 → 目标值」的插值系数 */
const LERP = 0.2;
/** 松手惯性：每 16.7ms 衰减到 0.9 倍 */
const FRICTION = 0.9;
/** 速度低于它就算停下（px/ms） */
const STOP_VELOCITY = 0.02;
/** 位移小于它算点击 */
const SLOP = 4;
/** 池子上限（视口约 6×4 = 24 个，留足余量给回收边界） */
const MAX_NODES = 240;
/** 停下后预热视口外一圈的数量上限 */
const PREFETCH_LIMIT = 160;

interface WallNode {
  el: HTMLDivElement;
  img: HTMLImageElement;
  cap: HTMLDivElement;
  badge: HTMLDivElement;
  pid: string | null;
  /** 插值中的当前值 */
  k: number;
  o: number;
  /** 上一次真正写进 style 的值（相同就跳过赋值） */
  sx: number;
  sy: number;
  sk: number;
  so: number;
}

interface WallLayout {
  cols: number;
  rows: number;
}

export interface PhotoWallProps {
  photos: Photo[];
  onOpen: (index: number, rect: DOMRect) => void;
  onAddSelected: (ids: string[]) => void;
  className?: string;
  /** 方块基础边长（宽屏）。0.7.2 起可在照片库里拖滑块调，默认 208 */
  tileBase?: number;
  /** 让墙面撑满父容器（照片库改成满屏工作台后用它，不再用固定 clamp 高度） */
  fill?: boolean;
  /** 是否在墙面左上角浮一枚用法胶囊（默认不出，页面顶部已有图标提示） */
  hint?: boolean;
}

/** 照片均匀铺成一个 cols × rows 的世界平面。 */
function layoutFor(count: number): WallLayout {
  const cols = Math.min(96, Math.max(1, Math.round(Math.sqrt(Math.max(count, 1) * 1.9))));
  const rows = Math.max(1, Math.ceil(Math.max(count, 1) / cols));
  return { cols, rows };
}

function makeNode(tile: number): WallNode {
  const el = document.createElement('div');
  el.className = 'ps-wall-tile';
  el.style.width = `${tile}px`;
  el.style.height = `${tile}px`;

  const img = document.createElement('img');
  img.className = 'ps-wall-img';
  /*
   * 0.7.2：这里原来是 loading='lazy'。
   * 方块是靠 transform 挪到世界坐标上的，浏览器判断「在不在视口」时对变换后的
   * 位置并不总是及时更新，于是刚进照片库时常出现「一圈空框，拖一下才出图」。
   * 解码并发已经由 preview-cache 限到 10，这里直接 eager 更稳。
   */
  img.loading = 'eager';
  img.decoding = 'async';
  img.draggable = false;
  img.alt = '';

  const cover = document.createElement('div');
  cover.className = 'ps-wall-cover';

  const veil = document.createElement('div');
  veil.className = 'ps-wall-veil';

  const cap = document.createElement('div');
  cap.className = 'ps-wall-cap';

  const ring = document.createElement('div');
  ring.className = 'ps-wall-ring';

  const badge = document.createElement('div');
  badge.className = 'ps-wall-badge';

  /*
   * 0.7.2 修「照片全是空白」的真凶：
   * 这几层原来按 img → cover 的顺序塞进方块，而 `.ps-wall-cover` 是一层
   * 近乎不透明的浅色渐变（它本来只是「图还没解码时」的占位）。DOM 顺序一错，
   * 它就盖在照片上面 —— 图片解码得好好的（naturalWidth 640、complete true），
   * 屏幕上却只剩一块淡淡的米色。占位层必须在图片**下面**。
   */
  el.append(cover, img, veil, cap, ring, badge);
  el.style.transform = 'translate3d(-9999px, -9999px, 0) scale(1)';
  el.style.opacity = '0';
  return { el, img, cap, badge, pid: null, k: 1, o: 1, sx: -9999, sy: -9999, sk: 1, so: 0 };
}

function resizeNode(node: WallNode, tile: number): void {
  node.el.style.width = `${tile}px`;
  node.el.style.height = `${tile}px`;
}

export function PhotoWall({
  photos,
  onOpen,
  onAddSelected,
  className,
  tileBase = TILE_WIDE,
  fill = false,
  hint = false,
}: PhotoWallProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [immersive, setImmersive] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<WallNode[]>([]);
  const freeRef = useRef<WallNode[]>([]);
  const liveRef = useRef<Map<string, WallNode>>(new Map());

  const sizeRef = useRef({ w: 0, h: 0 });
  const tileRef = useRef(TILE_WIDE);
  // 0.7.2：方块尺寸可以由用户拖滑块调；窄屏按同一比例缩小，保持「一面墙」的观感
  const baseRef = useRef(tileBase);
  const layoutRef = useRef<WallLayout>(layoutFor(photos.length));
  const photosRef = useRef<Photo[]>(photos);
  const indexRef = useRef<Map<string, number>>(new Map(photos.map((p, i) => [p.id, i])));

  const panRef = useRef({ x: 0, y: 0 });
  const velRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(0);
  const pressedRef = useRef(false);

  const selRef = useRef<Set<string>>(new Set());
  const orderRef = useRef<Map<string, number>>(new Map());
  const downRef = useRef<{
    pid: number;
    x: number;
    y: number;
    panX: number;
    panY: number;
    lastX: number;
    lastY: number;
    lastT: number;
    moved: boolean;
    shift: boolean;
    multi: boolean;
    photoId: string | null;
  } | null>(null);

  const drawRef = useRef<() => boolean>(() => true);
  const stepRef = useRef<(ts: number) => void>(() => {});

  /* ------------------------------- 节点池 ------------------------------- */

  const acquire = useCallback((): WallNode | null => {
    const free = freeRef.current.pop();
    if (free) return free;
    if (nodesRef.current.length >= MAX_NODES) return null;
    const stage = stageRef.current;
    if (!stage) return null;
    const node = makeNode(tileRef.current);
    stage.appendChild(node.el);
    nodesRef.current.push(node);
    return node;
  }, []);

  const release = useCallback((node: WallNode) => {
    node.pid = null;
    node.el.dataset.photoId = '';
    node.el.dataset.selected = '0';
    node.badge.textContent = '';
    node.el.style.willChange = 'auto';
    node.el.style.opacity = '0';
    node.el.style.transform = 'translate3d(-9999px, -9999px, 0) scale(1)';
    node.sx = -9999;
    node.sy = -9999;
    node.so = 0;
    freeRef.current.push(node);
  }, []);

  const bind = useCallback((node: WallNode, slot: string, photo: Photo) => {
    node.el.dataset.slot = slot;
    node.el.dataset.photoId = photo.id;
    node.el.style.willChange = 'transform, opacity';
    if (node.pid === photo.id) return;
    node.pid = photo.id;
    node.el.dataset.selected = selRef.current.has(photo.id) ? '1' : '0';
    node.cap.textContent = photo.analysis?.title || photo.fileName || '';
    const url = peekPreview(photo.id);
    if (url) {
      node.img.src = url;
      node.img.style.opacity = '1';
      return;
    }
    node.img.style.opacity = '0';
    void loadPreview(photo.id).then((next) => {
      if (next && node.pid === photo.id) {
        node.img.src = next;
        node.img.style.opacity = '1';
      }
    });
  }, []);

  /* ------------------------------- 绘制一帧 ------------------------------- */

  const draw = useCallback((): boolean => {
    const stage = stageRef.current;
    if (!stage) return true;
    const { w: vw, h: vh } = sizeRef.current;
    if (vw < 4 || vh < 4) return true;

    const tile = tileRef.current;
    const cell = tile + GAP;
    const { cols, rows } = layoutRef.current;
    const list = photosRef.current;
    const pan = panRef.current;
    const radius = fieldRadius(vw, vh);
    const cx = vw / 2;
    const cy = vh / 2;
    const live = liveRef.current;
    const keep = new Set<string>();
    let settled = true;

    const c0 = Math.floor(pan.x / cell);
    const c1 = Math.floor((pan.x + vw) / cell);
    const r0 = Math.floor(pan.y / cell);
    const r1 = Math.floor((pan.y + vh) / cell);

    for (let row = r0; row <= r1; row += 1) {
      const pr = ((row % rows) + rows) % rows;
      for (let col = c0; col <= c1; col += 1) {
        const pc = ((col % cols) + cols) % cols;
        const photo = list[pr * cols + pc];
        if (!photo) continue;
        const key = `${col}:${row}`;
        const sx = Math.round((col * cell - pan.x) * 10) / 10;
        const sy = Math.round((row * cell - pan.y) * 10) / 10;
        const target = fieldAt(sx + tile / 2 - cx, sy + tile / 2 - cy, radius);

        let node = live.get(key);
        if (!node) {
          const fresh = acquire();
          if (!fresh) continue;
          node = fresh;
          // 新进入视野（或被回收复用）的方块直接对齐目标值：
          // 它出现在视口边缘，本来就很淡，从旧值插值会「飞」一下。
          node.k = target.scale;
          node.o = target.opacity;
          bind(node, key, photo);
          live.set(key, node);
        } else {
          node.k += (target.scale - node.k) * LERP;
          node.o += (target.opacity - node.o) * LERP;
          if (Math.abs(target.scale - node.k) > 0.003 || Math.abs(target.opacity - node.o) > 0.003) {
            settled = false;
          }
          if (node.pid !== photo.id) bind(node, key, photo);
        }

        keep.add(key);

        // 只写 transform / opacity（合成层属性），位置跟手不插值
        if (Math.abs(node.sx - sx) > 0.3 || Math.abs(node.sy - sy) > 0.3 || Math.abs(node.sk - node.k) > 0.002) {
          node.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) scale(${node.k.toFixed(3)})`;
          node.sx = sx;
          node.sy = sy;
          node.sk = node.k;
        }
        if (Math.abs(node.so - node.o) > 0.004) {
          node.el.style.opacity = node.o.toFixed(3);
          node.so = node.o;
        }

        const on = selRef.current.has(photo.id) ? '1' : '0';
        if (node.el.dataset.selected !== on) node.el.dataset.selected = on;
        const ord = orderRef.current.get(photo.id);
        const label = ord ? String(ord) : '';
        if (node.badge.textContent !== label) node.badge.textContent = label;
      }
    }

    for (const [key, node] of live) {
      if (keep.has(key)) continue;
      live.delete(key);
      release(node);
    }

    return settled;
  }, [acquire, bind, release]);

  drawRef.current = draw;

  /* --------------------------- 停下后预热外圈 --------------------------- */

  const prefetch = useCallback(() => {
    const tile = tileRef.current;
    const cell = tile + GAP;
    const { cols, rows } = layoutRef.current;
    const list = photosRef.current;
    const pan = panRef.current;
    const { w: vw, h: vh } = sizeRef.current;
    const c0 = Math.floor(pan.x / cell) - 1;
    const c1 = Math.floor((pan.x + vw) / cell) + 1;
    const r0 = Math.floor(pan.y / cell) - 1;
    const r1 = Math.floor((pan.y + vh) / cell) + 1;
    let n = 0;
    for (let row = r0; row <= r1 && n < PREFETCH_LIMIT; row += 1) {
      const pr = ((row % rows) + rows) % rows;
      for (let col = c0; col <= c1 && n < PREFETCH_LIMIT; col += 1) {
        const pc = ((col % cols) + cols) % cols;
        const photo = list[pr * cols + pc];
        if (!photo || peekPreview(photo.id)) continue;
        n += 1;
        void loadPreview(photo.id);
      }
    }
  }, []);

  /* ------------------------------ 动画循环 ------------------------------ */

  const ensure = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame((ts) => {
      rafRef.current = null;
      stepRef.current(ts);
    });
  }, []);

  stepRef.current = (ts: number) => {
    const dt = Math.min(48, Math.max(1, ts - lastTsRef.current)) || 16.7;
    lastTsRef.current = ts;

    // 0.8.0：设置里关掉「照片墙」区域 → 松手即停，不再有惯性滑行
    if (!motionEnabled('wall')) {
      velRef.current.x = 0;
      velRef.current.y = 0;
    }

    let moving = pressedRef.current;
    if (!pressedRef.current) {
      const v = velRef.current;
      if (Math.abs(v.x) > STOP_VELOCITY || Math.abs(v.y) > STOP_VELOCITY) {
        panRef.current.x += v.x * dt;
        panRef.current.y += v.y * dt;
        const decay = Math.pow(FRICTION, dt / 16.7);
        v.x *= decay;
        v.y *= decay;
        if (Math.abs(v.x) <= STOP_VELOCITY) v.x = 0;
        if (Math.abs(v.y) <= STOP_VELOCITY) v.y = 0;
        moving = true;
      } else {
        v.x = 0;
        v.y = 0;
      }
    }

    const settled = draw();
    if (moving || !settled) {
      ensure();
      return;
    }

    const stage = stageRef.current;
    if (stage && stage.dataset.moving === '1') stage.dataset.moving = '0';
    prefetch();
  };

  /* ------------------------------- 生命周期 ------------------------------- */

  /**
   * 0.7.2：把整面墙摆到舞台正中。
   *
   * 之前 pan 初值是 (0,0)，等于「世界原点贴在舞台左上角」，所以二十张照片
   * 全挤在左上角、右下大半张舞台是空的点阵 —— 观感上像「照片墙没加载出来」。
   * 现在按内容尺寸算一次居中偏移；拖动之后就不再自动回中。
   */
  const centerPan = useCallback(() => {
    const { w, h } = sizeRef.current;
    const tile = tileRef.current;
    const cell = tile + GAP;
    const { cols, rows } = layoutRef.current;
    /**
     * 居中之后再对齐到格子步长：不然舞台上下两条边会各切掉半排照片，
     * 顶部看起来像一条深色的「脏边」。按 cell 取整后，方块的边界正好落在
     * 舞台边上，四边都是完整的一排。
     */
    panRef.current = {
      x: Math.round((((cols - 1) * cell + tile) / 2 - w / 2) / cell) * cell,
      y: Math.round((((rows - 1) * cell + tile) / 2 - h / 2) / cell) * cell,
    };
    velRef.current = { x: 0, y: 0 };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.dataset.moving = '0';

    const apply = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      const prevW = sizeRef.current.w;
      sizeRef.current = { w, h };
      const narrow = w > 0 && w < NARROW_MAX;
      // 窄屏用比宽屏更小的间距比例，但跟随用户选的尺寸一起缩放
      const scaled = narrow
        ? Math.max(84, Math.round((baseRef.current * TILE_NARROW) / TILE_WIDE))
        : Math.round(baseRef.current);
      const tile = scaled;
      if (Math.abs(tile - tileRef.current) > 0.5) {
        tileRef.current = tile;
        for (const node of nodesRef.current) resizeNode(node, tile);
      }
      // 首次量到尺寸（或从 0 变到有尺寸）：居中一次
      if (prevW === 0 && w > 0) centerPan();
      drawRef.current();
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(stage);
    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [centerPan]);

  /**
   * 0.7.2：滑块改了方块尺寸 —— 已挂上的方块一起改，并立刻重画一帧。
   * 不做动画：方块是被 transform 摆位的一格格，缩放过程中插值会互相穿过，
   * 直接「啪」地重排更像换了一块更疏/更密的墙。
   */
  useEffect(() => {
    baseRef.current = tileBase;
    const stage = stageRef.current;
    const narrow = stage ? stage.clientWidth > 0 && stage.clientWidth < NARROW_MAX : false;
    const tile = narrow
      ? Math.max(84, Math.round((tileBase * TILE_NARROW) / TILE_WIDE))
      : Math.round(tileBase);
    if (Math.abs(tile - tileRef.current) <= 0.5) return;
    tileRef.current = tile;
    for (const node of nodesRef.current) resizeNode(node, tile);
    centerPan();
    drawRef.current();
  }, [tileBase, centerPan]);

  useEffect(() => {
    photosRef.current = photos;
    layoutRef.current = layoutFor(photos.length);
    indexRef.current = new Map(photos.map((p, i) => [p.id, i]));
    centerPan();
    for (const node of nodesRef.current) {
      node.pid = null;
      node.el.dataset.photoId = '';
    }
    liveRef.current.clear();
    freeRef.current = nodesRef.current.slice();
    setSelected((prev) => {
      const alive = prev.filter((id) => indexRef.current.has(id));
      return alive.length === prev.length ? prev : alive;
    });
    drawRef.current();
    prefetch();
  }, [photos, prefetch, centerPan]);

  useEffect(() => {
    const set = new Set(selected);
    const order = new Map<string, number>();
    selected.forEach((id, i) => order.set(id, i + 1));
    selRef.current = set;
    orderRef.current = order;
    drawRef.current();
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return;
      if (e.key === 'Escape') {
        if (immersive) setImmersive(false);
        else setSelected([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [immersive]);

  /* -------------------------------- 交互 -------------------------------- */

  const setSelection = useCallback((next: string[]) => {
    const set = new Set(next);
    const order = new Map<string, number>();
    next.forEach((id, i) => order.set(id, i + 1));
    selRef.current = set;
    orderRef.current = order;
    setSelected(next);
    ensure();
  }, [ensure]);

  const applyClick = useCallback(
    (photoId: string | null, shift: boolean, multi: boolean) => {
      if (!photoId) {
        if (!shift && !multi) setSelection([]);
        return;
      }
      const prev = Array.from(selRef.current);
      if (shift || multi) {
        setSelection(prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId]);
        return;
      }
      setSelection(prev.length === 1 && prev[0] === photoId ? prev : [photoId]);
    },
    [setSelection],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-wall-ui]')) return;
    if (e.button !== 0 && e.button !== 1) return;
    const stage = stageRef.current;
    if (!stage) return;
    if (e.button === 1) e.preventDefault();
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* 合成事件没有真实指针，忽略 */
    }
    velRef.current.x = 0;
    velRef.current.y = 0;
    pressedRef.current = true;
    const tileEl = el.closest('[data-photo-id]') as HTMLElement | null;
    downRef.current = {
      pid: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
      lastX: e.clientX,
      lastY: e.clientY,
      lastT: performance.now(),
      moved: false,
      shift: e.shiftKey,
      multi: e.ctrlKey || e.metaKey,
      photoId: tileEl?.dataset.photoId || null,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = downRef.current;
    if (!d || d.pid !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < SLOP) return;
      d.moved = true;
      const stage = stageRef.current;
      if (stage) stage.dataset.moving = '1';
    }
    panRef.current.x = d.panX - dx;
    panRef.current.y = d.panY - dy;

    const now = performance.now();
    const span = Math.max(1, now - d.lastT);
    const vx = (d.lastX - e.clientX) / span;
    const vy = (d.lastY - e.clientY) / span;
    // 指数平滑，避免最后一帧的抖动放大成甩飞
    velRef.current.x = velRef.current.x * 0.65 + vx * 0.35;
    velRef.current.y = velRef.current.y * 0.65 + vy * 0.35;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    d.lastT = now;
    ensure();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = downRef.current;
    if (!d || d.pid !== e.pointerId) return;
    downRef.current = null;
    pressedRef.current = false;
    const stage = stageRef.current;
    if (stage) {
      try {
        stage.releasePointerCapture(e.pointerId);
      } catch {
        /* 忽略 */
      }
    }

    if (!d.moved) {
      applyClick(d.photoId, d.shift, d.multi);
      if (stage) stage.dataset.moving = '0';
      return;
    }

    const v = velRef.current;
    if (Math.abs(v.x) < 0.06) v.x = 0;
    if (Math.abs(v.y) < 0.06) v.y = 0;
    ensure();
  };

  const onPointerCancel = () => {
    downRef.current = null;
    pressedRef.current = false;
    const stage = stageRef.current;
    if (stage && stage.dataset.moving === '1') stage.dataset.moving = '0';
    ensure();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (el.closest('[data-wall-ui]')) return;
    const tileEl = el.closest('[data-photo-id]') as HTMLElement | null;
    const id = tileEl?.dataset.photoId;
    if (!id) return;
    const index = indexRef.current.get(id);
    if (index === undefined) return;
    onOpen(index, tileEl.getBoundingClientRect());
  };

  const resetPan = () => {
    // 0.7.2：回到起点 = 回到「摆正中」的那一屏，而不是世界的左上角
    centerPan();
    ensure();
  };

  return (
    <div
      className={`ps-wall${immersive ? ' ps-wall--immersive' : ''}${fill ? ' ps-wall--fill' : ''}${className ? ` ${className}` : ''}`}
    >
      <div
        ref={stageRef}
        className="ps-wall-stage"
        role="application"
        aria-label="照片墙，按住拖动可以一直滑下去"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={onDoubleClick}
      />

      {/* 0.7.2：这枚「按住拖动 · 松手滑行 · 双击看大图」的胶囊原来压在照片上，
          而页首已经有一排带图标的用法提示了 —— 同一句话讲两遍，还挡图。
          现在只在外部明确要（hint）时才出。 */}
      {hint && (
        <div className="ps-wall-hint" data-wall-ui="">
          按住拖动 · 松手滑行 · 双击看大图
        </div>
      )}

      {/* 0.7.2：照片库顶部已经写了「20 / 共 20 张」，这枚 HUD 平时什么都不显示，
          只在你按住 Ctrl 选了照片时才浮出来（否则它压在墙上像一个多余的标签）。 */}
      <div className="ps-wall-hud" data-wall-ui="">
        {selected.length === 0 ? null : (
          <span className="ps-wall-hud-item is-on">已选 {selected.length} 张</span>
        )}
        {selected.length > 0 && (
          <>
            <button
              type="button"
              className="ps-wall-btn is-primary"
              onClick={() => onAddSelected(selected)}
            >
              <Check size={13} strokeWidth={2.2} />
              <span className="ps-wall-btn-text">加入选片</span>
            </button>
            <button
              type="button"
              className="ps-wall-btn is-icon"
              aria-label="取消选择"
              onClick={() => setSelection([])}
            >
              <X size={13} strokeWidth={2.2} />
            </button>
          </>
        )}
      </div>

      <div className="ps-wall-tools" data-wall-ui="">
        <button type="button" className="ps-wall-btn is-icon" aria-label="回到起点" onClick={resetPan}>
          <RotateCcw size={14} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="ps-wall-btn is-icon"
          aria-label={immersive ? '退出全屏' : '全屏看墙'}
          onClick={() => setImmersive((v) => !v)}
        >
          {immersive ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
        </button>
      </div>
    </div>
  );
}
