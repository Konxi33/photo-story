// src/lib/export/layout.ts
// 0.6.0：把「一张照片那一页」从「一条竖着的板块链」升级成「一张 A4 纸上的积木」。
//
// 0.5.7 的做法是让用户拖一列板块的上下顺序，用户说他其实想要的是：给他一张
// A4 纸大小的画布，上面摆着像俄罗斯方块一样的积木（照片、正文、评分、建议…），
// 他自己决定每块放在纸的哪个位置、占多大地方；他摆完之后，再由 AI 检查一遍，
// 免得摆错、印出来错版。
//
// 于是这里把一页抽象成一张网格：12 列 × 24 行。每个积木占若干个格子
// （col/row/colSpan/rowSpan），页面的几何关系完全由这份数据决定。三条硬规矩：
//
//   1. **几何固定**：用户摆好的位置就是印出来的位置，导出时不会偷偷重排；
//   2. **不许溢出**：某个格子里文字太多时，先自动缩小字号（11.5pt → 7.5pt），
//      还装不下才截断并在导出报告里如实写明 —— 绝对不让一块文字撑破版面；
//   3. **不许跨页**：一张照片和它的所有文字永远在同一页。
//
// 图片块是唯一「自适应」的：它按格子给的空间等比缩放到刚好放得下（contain），
// 永远不会溢出。

import type { ExportSettings, Photo, PhotoAnalysis } from '@/types/domain';
import { exportContentCm, exportContentHeightCm } from './metrics';

import { BLOCK_MAP, BLOCKS, resolveBlocks, type PhotoBlockId } from './blocks';

/* ------------------------------- 网格基础 ------------------------------- */

/** 一页的网格：12 列 × 24 行，A4 版心 16.6cm × 25.2cm 时每格约 1.38cm × 1.05cm */
export const GRID_COLS = 12;
export const GRID_ROWS = 24;

export interface LayoutItem {
  id: PhotoBlockId;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface PageLayout {
  cols: number;
  rows: number;
  items: LayoutItem[];
}

/** 每个积木允许的最小尺寸（再小就印不清了） */
export const MIN_BOX: Record<PhotoBlockId, { colSpan: number; rowSpan: number }> = {
  image: { colSpan: 4, rowSpan: 6 },
  index: { colSpan: 1, rowSpan: 1 },
  title: { colSpan: 3, rowSpan: 1 },
  caption: { colSpan: 3, rowSpan: 1 },
  story: { colSpan: 4, rowSpan: 2 },
  technique: { colSpan: 4, rowSpan: 3 },
  params: { colSpan: 4, rowSpan: 3 },
  score: { colSpan: 4, rowSpan: 3 },
  advice: { colSpan: 4, rowSpan: 3 },
  category: { colSpan: 3, rowSpan: 1 },
  tags: { colSpan: 3, rowSpan: 1 },
  mood: { colSpan: 3, rowSpan: 1 },
  alt: { colSpan: 3, rowSpan: 1 },
  exif: { colSpan: 4, rowSpan: 1 },
};

/** 从工具箱拖出来时给的默认尺寸 */
export const DEFAULT_BOX: Record<PhotoBlockId, { colSpan: number; rowSpan: number }> = {
  image: { colSpan: 12, rowSpan: 11 },
  index: { colSpan: 1, rowSpan: 1 },
  title: { colSpan: 11, rowSpan: 1 },
  caption: { colSpan: 12, rowSpan: 1 },
  story: { colSpan: 12, rowSpan: 4 },
  technique: { colSpan: 6, rowSpan: 5 },
  params: { colSpan: 6, rowSpan: 3 },
  score: { colSpan: 6, rowSpan: 5 },
  advice: { colSpan: 6, rowSpan: 5 },
  category: { colSpan: 6, rowSpan: 1 },
  tags: { colSpan: 12, rowSpan: 1 },
  mood: { colSpan: 6, rowSpan: 1 },
  alt: { colSpan: 6, rowSpan: 1 },
  exif: { colSpan: 6, rowSpan: 1 },
};

export function overlaps(a: LayoutItem, b: LayoutItem): boolean {
  return (
    a.col < b.col + b.colSpan &&
    b.col < a.col + a.colSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  );
}

/** 把单个积木夹回画布内并按最小值补齐 */
export function clampItem(item: LayoutItem, layout: PageLayout): LayoutItem {
  const min = MIN_BOX[item.id] ?? { colSpan: 1, rowSpan: 1 };
  const colSpan = Math.max(min.colSpan, Math.min(layout.cols, Math.round(item.colSpan)));
  const rowSpan = Math.max(min.rowSpan, Math.min(layout.rows, Math.round(item.rowSpan)));
  const col = Math.max(0, Math.min(layout.cols - colSpan, Math.round(item.col)));
  const row = Math.max(0, Math.min(layout.rows - rowSpan, Math.round(item.row)));
  return { id: item.id, col, row, colSpan, rowSpan };
}

/**
 * 规范化一份排版：去重、夹回边界、丢掉互相压住的（先来的优先）。
 * 用户手改配置文件、或者 AI 返回的方案越界时，都靠这个兜底。
 */
export function normalizeLayout(layout: PageLayout | undefined): PageLayout {
  const cols = GRID_COLS;
  const rows = GRID_ROWS;
  const items: LayoutItem[] = [];
  const seen = new Set<PhotoBlockId>();
  for (const raw of layout?.items ?? []) {
    if (!raw || !raw.id || seen.has(raw.id)) continue;
    if (!(raw.id in BLOCK_MAP)) continue;
    seen.add(raw.id);
    const item = clampItem(raw, { cols, rows, items: [] });
    if (items.some((other) => overlaps(item, other))) continue;
    items.push(item);
  }
  if (items.length === 0) return verticalLayout(['image']);
  return { cols, rows, items };
}

/** 竖着堆：0.5.7 及以前的样子，也是老项目升级过来的默认值 */
export function verticalLayout(ids: PhotoBlockId[]): PageLayout {
  const items: LayoutItem[] = [];
  const hasImage = ids.includes('image');
  const textIds = ids.filter((id) => id !== 'image');
  // 文字块按经验高度分配行数，剩下的行全给图片
  const weights = textIds.map((id) => Math.max(1, Math.round((BLOCK_MAP[id]?.heightCm ?? 1) / 1.05)));
  const textRows = weights.reduce((total, value) => total + value, 0);
  const imageRows = hasImage ? Math.max(MIN_BOX.image.rowSpan, GRID_ROWS - textRows) : 0;

  let cursor = 0;
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index];
    if (id === 'image') {
      items.push({ id, col: 0, row: cursor, colSpan: GRID_COLS, rowSpan: imageRows });
      cursor += imageRows;
      continue;
    }
    const rowSpan = Math.max(MIN_BOX[id]?.rowSpan ?? 1, weights[textIds.indexOf(id)] ?? 1);
    const remaining = GRID_ROWS - cursor;
    const span = Math.max(1, Math.min(rowSpan, Math.max(1, remaining)));
    items.push({ id, col: 0, row: cursor, colSpan: GRID_COLS, rowSpan: span });
    cursor += span;
  }
  return { cols: GRID_COLS, rows: GRID_ROWS, items };
}

/** 老设置（没有 layout 字段）→ 等价积木排版，保证升级后打开旧项目版式不变 */
export function legacyLayout(settings: ExportSettings): PageLayout {
  return verticalLayout(resolveBlocks(settings));
}

/** 取这一页实际用的排版 */
export function resolveLayout(settings: ExportSettings): PageLayout {
  // 0.6.3：没在排版台摆过版式时，给一个「左大图 + 右信息栏」的版式。
  // 0.6.1 那时是整条竖排，用户把 14 个块全打开，就会变成一条又长又挤的竖列，
  // 底部还会溢出页面被裁掉 —— 也就是他说的「字超出自定义的框」。
  if (settings.useGrid === false) return blockLayout(settings);
  const grid = settings.grid;
  if (grid && Array.isArray(grid.items) && grid.items.length > 0) {
    return normalizeLayout(grid);
  }
  return legacyLayout(settings);
}

/**
 * 由「板块清单」推出一个通栏版式：左 8 格放序号/标题/大图/图注/正文，
 * 右 4 格按优先级竖排其余的块（评分、参数、拍摄手法、标签……）。
 * 右栏放不下的块直接不排（比塞爆被裁好看），数量与顺序仍由用户在对话框里决定。
 */
export function blockLayout(settings: ExportSettings): PageLayout {
  const ids = resolveBlocks(settings);
  if (!ids.includes('image')) return verticalLayout(ids);

  const items: LayoutItem[] = [];
  const put = (id: PhotoBlockId, col: number, row: number, colSpan: number, rowSpan: number) => {
    if (rowSpan <= 0) return;
    items.push({ id, col, row, colSpan, rowSpan });
  };

  const LEFT = 8;
  const RIGHT = GRID_COLS - LEFT;
  let row = 0;
  if (ids.includes('index')) {
    put('index', 0, row, 2, 1);
    row += 1;
  }
  if (ids.includes('title')) {
    put('title', 0, row, LEFT, 2);
    row += 2;
  }

  const wantsCaption = ids.includes('caption');
  const wantsStory = ids.includes('story');
  // 图框固定 9 行（约 9.4cm 高、11cm 宽 → 正好装 3:2 的横图），剩下的行全给正文
  const imageRows = Math.min(9, Math.max(6, GRID_ROWS - row - (wantsCaption ? 1 : 0) - 4));
  put('image', 0, row, LEFT, imageRows);
  row += imageRows;
  if (wantsCaption) {
    put('caption', 0, row, LEFT, 1);
    row += 1;
  }
  if (wantsStory) put('story', 0, row, LEFT, Math.max(2, GRID_ROWS - row));

  // 右栏：按「越靠前越重要」的顺序往下堆，放不下的不排
  const RIGHT_ORDER: PhotoBlockId[] = [
    'score',
    'advice',
    'technique',
    'params',
    'exif',
    'category',
    'tags',
    'mood',
    'alt',
  ];
  const rowsFor = (id: PhotoBlockId): number => {
    if (id === 'score') return 4;
    if (id === 'advice') return 6;
    if (id === 'technique') return 5;
    if (id === 'params') return 3;
    if (id === 'exif') return 2;
    return 1;
  };
  let r = 0;
  for (const id of RIGHT_ORDER) {
    if (!ids.includes(id)) continue;
    const rows = rowsFor(id);
    if (r + rows > GRID_ROWS) continue;
    put(id, LEFT, r, RIGHT, rows);
    r += rows;
  }

  return normalizeLayout({ cols: GRID_COLS, rows: GRID_ROWS, items });
}

/** 积木的阅读顺序（从上到下、从左到右），写回 blocks 时用 */
export function layoutOrder(layout: PageLayout): PhotoBlockId[] {
  return [...normalizeLayout(layout).items]
    .sort((a, b) => (a.row === b.row ? a.col - b.col : a.row - b.row))
    .map((item) => item.id);
}

/** 排版写回设置：顺带维护 0.5.x 的旧布尔开关（PPT/预览还在读） */
export function applyLayout(settings: ExportSettings, layout: PageLayout): ExportSettings {
  const normalized = normalizeLayout(layout);
  const order = layoutOrder(normalized);
  const set = new Set(order);
  return {
    ...settings,
    grid: normalized,
    blocks: order,
    includeStory: set.has('story'),
    includeTechnique: set.has('technique') || set.has('params') || set.has('score') || set.has('advice'),
    includeTags: set.has('tags'),
    includeMood: set.has('mood'),
    includeAlt: set.has('alt'),
    includeScoreDetail: set.has('score') || set.has('advice'),
    captionUnderImage: set.has('caption'),
  };
}

/* ------------------------------- 固定模板 ------------------------------- */

export interface LayoutPreset {
  id: string;
  name: string;
  hint: string;
  layout: PageLayout;
  /** 套用模板时连带改掉的其它设置 */
  patch?: Partial<ExportSettings>;
}

function page(items: LayoutItem[]): PageLayout {
  return { cols: GRID_COLS, rows: GRID_ROWS, items };
}

export const LAYOUT_PRESETS: LayoutPreset[] = [
  {
    id: 'photobook',
    name: '摄影集',
    hint: '整页大图，下面一行图注和一段正文，最像正式画册',
    layout: page([
      { id: 'index', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { id: 'title', col: 1, row: 0, colSpan: 11, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 12, rowSpan: 11 },
      { id: 'caption', col: 0, row: 12, colSpan: 12, rowSpan: 1 },
      { id: 'story', col: 0, row: 13, colSpan: 12, rowSpan: 6 },
    ]),
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'contest',
    name: '参赛投稿',
    hint: '上图下文，带类别、评分与改进建议，适合投比赛',
    layout: page([
      { id: 'index', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { id: 'title', col: 1, row: 0, colSpan: 11, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 12, rowSpan: 10 },
      { id: 'caption', col: 0, row: 11, colSpan: 12, rowSpan: 1 },
      { id: 'category', col: 0, row: 12, colSpan: 6, rowSpan: 1 },
      { id: 'mood', col: 6, row: 12, colSpan: 6, rowSpan: 1 },
      { id: 'story', col: 0, row: 13, colSpan: 12, rowSpan: 4 },
      { id: 'score', col: 0, row: 17, colSpan: 6, rowSpan: 4 },
      { id: 'advice', col: 6, row: 17, colSpan: 6, rowSpan: 7 },
    ]),
    patch: { includeScoreDetail: true, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'tech',
    name: '技术档案',
    hint: '左图右参数，机身、参数、手法、评分全印，给同行看',
    layout: page([
      { id: 'index', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { id: 'title', col: 1, row: 0, colSpan: 11, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 8, rowSpan: 7 },
      { id: 'exif', col: 8, row: 1, colSpan: 4, rowSpan: 1 },
      { id: 'params', col: 8, row: 2, colSpan: 4, rowSpan: 3 },
      { id: 'score', col: 8, row: 5, colSpan: 4, rowSpan: 4 },
      { id: 'caption', col: 0, row: 8, colSpan: 8, rowSpan: 1 },
      { id: 'technique', col: 0, row: 9, colSpan: 8, rowSpan: 5 },
      { id: 'story', col: 8, row: 9, colSpan: 4, rowSpan: 5 },
      { id: 'advice', col: 0, row: 14, colSpan: 8, rowSpan: 6 },
      { id: 'tags', col: 8, row: 14, colSpan: 4, rowSpan: 1 },
      { id: 'mood', col: 8, row: 15, colSpan: 4, rowSpan: 1 },
      { id: 'alt', col: 8, row: 16, colSpan: 4, rowSpan: 2 },
      { id: 'category', col: 0, row: 20, colSpan: 12, rowSpan: 1 },
    ]),
    patch: { includeScoreDetail: true, captionStyle: 'both', pageBreakPerPhoto: true },
  },
  {
    id: 'minimal',
    name: '极简画册',
    hint: '一张大图加一行图注，留白最多，打印最省墨',
    layout: page([
      { id: 'image', col: 0, row: 3, colSpan: 12, rowSpan: 11 },
      { id: 'caption', col: 0, row: 14, colSpan: 12, rowSpan: 1 },
    ]),
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'journal',
    name: '图文随笔',
    hint: '标题、图、一段正文、标签与氛围，像旅行日记',
    layout: page([
      { id: 'title', col: 0, row: 0, colSpan: 12, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 12, rowSpan: 10 },
      { id: 'caption', col: 0, row: 11, colSpan: 12, rowSpan: 1 },
      { id: 'story', col: 0, row: 12, colSpan: 12, rowSpan: 7 },
      { id: 'tags', col: 0, row: 19, colSpan: 6, rowSpan: 1 },
      { id: 'mood', col: 6, row: 19, colSpan: 6, rowSpan: 1 },
    ]),
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'magazine',
    name: '杂志对开',
    hint: '左边大图、右边一栏文字，像杂志内页',
    layout: page([
      { id: 'index', col: 0, row: 0, colSpan: 2, rowSpan: 1 },
      { id: 'title', col: 2, row: 0, colSpan: 10, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 8, rowSpan: 7 },
      { id: 'caption', col: 0, row: 8, colSpan: 8, rowSpan: 1 },
      { id: 'advice', col: 0, row: 9, colSpan: 8, rowSpan: 7 },
      { id: 'story', col: 8, row: 1, colSpan: 4, rowSpan: 12 },
      { id: 'score', col: 8, row: 13, colSpan: 4, rowSpan: 3 },
      { id: 'tags', col: 0, row: 16, colSpan: 12, rowSpan: 1 },
      { id: 'mood', col: 0, row: 17, colSpan: 12, rowSpan: 1 },
    ]),
    patch: { includeScoreDetail: true, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'postcard',
    name: '明信片',
    hint: '四周留白、居中一张图加一行字，最干净',
    layout: page([
      { id: 'image', col: 1, row: 3, colSpan: 10, rowSpan: 9 },
      { id: 'title', col: 1, row: 12, colSpan: 10, rowSpan: 1 },
      { id: 'caption', col: 1, row: 13, colSpan: 10, rowSpan: 1 },
    ]),
    patch: { includeScoreDetail: false, captionStyle: 'title', pageBreakPerPhoto: true },
  },
  {
    id: 'full',
    name: '完整档案',
    hint: '所有积木都摆上，信息最全（图和字都会小一点）',
    layout: page([
      { id: 'index', col: 0, row: 0, colSpan: 1, rowSpan: 1 },
      { id: 'title', col: 1, row: 0, colSpan: 11, rowSpan: 1 },
      { id: 'image', col: 0, row: 1, colSpan: 7, rowSpan: 6 },
      { id: 'caption', col: 0, row: 7, colSpan: 7, rowSpan: 1 },
      { id: 'exif', col: 0, row: 8, colSpan: 7, rowSpan: 1 },
      { id: 'params', col: 0, row: 9, colSpan: 7, rowSpan: 3 },
      { id: 'technique', col: 0, row: 12, colSpan: 7, rowSpan: 3 },
      { id: 'tags', col: 0, row: 15, colSpan: 7, rowSpan: 1 },
      { id: 'mood', col: 0, row: 16, colSpan: 7, rowSpan: 1 },
      { id: 'alt', col: 0, row: 17, colSpan: 7, rowSpan: 1 },
      { id: 'story', col: 7, row: 1, colSpan: 5, rowSpan: 8 },
      { id: 'score', col: 7, row: 9, colSpan: 5, rowSpan: 4 },
      { id: 'category', col: 7, row: 13, colSpan: 5, rowSpan: 1 },
      { id: 'advice', col: 7, row: 14, colSpan: 5, rowSpan: 6 },
    ]),
    patch: { includeScoreDetail: true, captionStyle: 'both', pageBreakPerPhoto: true },
  },
];

export function getLayoutPreset(id: string | undefined): LayoutPreset | undefined {
  return LAYOUT_PRESETS.find((preset) => preset.id === id);
}

/** 默认排版：摄影集 */
export const DEFAULT_LAYOUT: PageLayout = LAYOUT_PRESETS[0].layout;

/* ------------------------------- 尺寸换算 ------------------------------- */

/** 一行多少 cm */
export function rowHCm(layout: PageLayout, contentHeightCm: number): number {
  return contentHeightCm / Math.max(1, layout.rows);
}

/** 一列多少 cm */
export function colWCm(layout: PageLayout, contentCm: number): number {
  return contentCm / Math.max(1, layout.cols);
}

/** 积木的格子换算成厘米 */
export function itemBoxCm(
  item: LayoutItem,
  layout: PageLayout,
  contentCm: number,
  contentHeightCm: number,
): { widthCm: number; heightCm: number } {
  return {
    widthCm: colWCm(layout, contentCm) * item.colSpan,
    heightCm: rowHCm(layout, contentHeightCm) * item.rowSpan,
  };
}

/** 1pt 字号的 1em 大约多宽（cm）：中文按 1em，西文数字按 0.55em 折算 */
const PT_TO_CM = 0.03528;

function emCount(text: string): number {
  let total = 0;
  for (const char of text) {
    total += char.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
  }
  return total;
}

export interface TextMetrics {
  lines: number;
  charsPerLine: number;
  needCm: number;
}

/** 一段文字在给定宽度、字号下要占多少行、多少厘米 */
export function measureTextCm(
  text: string,
  widthCm: number,
  fontPt: number,
  lineRatio = 1.6,
): TextMetrics {
  const clean = text.replace(/\s+/g, ' ').trim();
  const emPerLine = Math.max(1, (widthCm - 0.2) / (fontPt * PT_TO_CM));
  const charsPerLine = Math.max(4, Math.floor(emPerLine));
  const totalEm = emCount(clean);
  const lines = Math.max(1, Math.ceil(totalEm / emPerLine));
  return { lines, charsPerLine, needCm: lines * fontPt * PT_TO_CM * lineRatio };
}

/** 字号阶梯：装不下就往下走一档，到 7.5pt 还装不下才截断 */
export const FONT_LADDER = [11.5, 10.5, 10, 9.5, 9, 8.5, 8, 7.5] as const;

function techniqueLines(analysis: PhotoAnalysis | undefined): number {
  if (!analysis) return 0;
  return Object.values(analysis.technique).filter((value) => String(value ?? '').trim().length > 0).length;
}

function adviceLines(analysis: PhotoAnalysis | undefined): number {
  if (!analysis) return 0;
  return Math.max(
    analysis.whyGood?.length ?? 0,
    analysis.improve?.length ?? 0,
    analysis.imitate?.length ?? 0,
  );
}

/**
 * 一个文字类积木在给定盒子里「需要多高」（cm）。
 * 表格类（参数/评分/建议）按行数估，正文按字符估。
 */
export interface NeedInput {
  id: PhotoBlockId;
  widthCm: number;
  photo: Photo;
  settings: ExportSettings;
  fontPt: number;
  index: number;
}

export function blockNeedCm(input: NeedInput): number {
  const { id, widthCm, photo, settings, fontPt } = input;
  const analysis = photo.status === 'success' ? photo.analysis : undefined;
  const lineH = fontPt * PT_TO_CM * 1.6;
  const twoCol = widthCm > 7.5;

  switch (id) {
    case 'image':
      return 0;
    case 'index':
    case 'category':
    case 'mood':
      return lineH + 0.1;
    case 'caption': {
      const text =
        (settings.captionStyle ?? 'title') === 'param'
          ? '图 01 · 1/250s · f/5.6 · ISO 200 · 50mm'
          : `图 ${String(input.index).padStart(2, '0')} · ${analysis?.title ?? photo.fileName}`;
      return measureTextCm(text, widthCm, Math.min(fontPt, 8.5), 1.5).needCm + 0.2;
    }
    case 'title': {
      const text = analysis?.title || photo.fileName;
      return measureTextCm(text, widthCm, Math.min(fontPt + 6, 18), 1.35).needCm + 0.3;
    }
    case 'story': {
      const text = analysis?.story?.trim() ?? '';
      if (!text) return 0;
      return measureTextCm(text, widthCm, fontPt, 1.65).needCm + 0.3;
    }
    case 'alt': {
      const text = analysis?.alt?.trim() ?? '';
      if (!text) return 0;
      return measureTextCm(text, widthCm, Math.min(fontPt, 9), 1.5).needCm + 0.1;
    }
    case 'tags': {
      const count = analysis?.tags?.length ?? 0;
      if (count === 0) return 0;
      const text = (analysis?.tags ?? []).map((tag) => `#${tag}`).join('  ');
      return measureTextCm(text, widthCm, Math.min(fontPt, 9.5), 1.6).needCm + 0.1;
    }
    case 'technique': {
      const lines = techniqueLines(analysis);
      if (lines === 0) return 0;
      const label = lineH + 0.15;
      const body = lines * lineH;
      return label + body + 0.35;
    }
    case 'exif': {
      if (!photo.exif) return 0;
      return lineH * 1.9 + 0.2;
    }
    case 'params': {
      const count = analysis?.params
        ? [
            analysis.params.focalLength,
            analysis.params.aperture,
            analysis.params.shutter,
            analysis.params.iso,
            analysis.params.colorGrade,
          ].filter((value) => String(value ?? '').trim().length > 0).length
        : 0;
      if (count === 0) return 0;
      const perRow = twoCol ? 2 : 1;
      const rows = Math.ceil(count / perRow);
      return rows * (lineH + 0.12) + 0.3;
    }
    case 'score': {
      if (!analysis?.score) return 0;
      const perRow = twoCol ? 2 : 1;
      const rows = Math.ceil(6 / perRow);
      return (lineH + 0.1) * 2 + rows * (lineH + 0.08) + 0.35;
    }
    case 'advice': {
      const lines = adviceLines(analysis);
      if (lines === 0) return 0;
      const perRow = twoCol ? 2 : 1;
      const rows = Math.ceil(lines / perRow);
      return (lineH + 0.1) + rows * (lineH + 0.1) + 0.35;
    }
    default:
      return 0;
  }
}

/* ------------------------------- 整页预算 ------------------------------- */

export interface LayoutPlanInput {
  photo: Photo;
  index: number;
  settings: ExportSettings;
  contentCm: number;
  contentHeightCm: number;
}

export interface ItemPlan {
  item: LayoutItem;
  widthCm: number;
  heightCm: number;
  fontPt: number;
  needCm: number;
  /** 内容是否放得下（放不下时会缩字号或截断） */
  fits: boolean;
  /** 缩到最小字号还放不下 → 会被截断 */
  truncated: boolean;
  /** 字号被压小了 */
  shrunk: boolean;
}

export interface LayoutPlan {
  layout: PageLayout;
  items: ItemPlan[];
  rowHCm: number;
  colWCm: number;
  /** 需要提醒用户的说明（会出现在导出报告里） */
  warnings: string[];
}

/**
 * 给一页算每个积木的落位与字号。这是导出时唯一的排版真源：
 * Word 与 PDF 都照着它画，翻页预览也照着它画。
 */
export function planLayoutPage(input: LayoutPlanInput): LayoutPlan {
  const base = resolveLayout(input.settings);
  const layout: PageLayout = {
    ...base,
    items: base.items.map((item) => ({ ...item })),
  };
  // 0.6.2：竖排先按真实文字高度重排，剩下的行全给照片（否则半页空白、照片很小）
  let dropped: PhotoBlockId[] = [];
  if (isVertical(layout)) {
    const before = layout.items.map((item) => item.id);
    layout.items = fitVertical(layout, input).items;
    const kept = new Set(layout.items.map((item) => item.id));
    dropped = before.filter((id) => !kept.has(id));
  }
  let plan = planOnce(layout, input);
  for (const id of dropped) {
    plan.warnings.push(`这一页放不下「${BLOCK_MAP[id]?.label ?? id}」，导出时省略了这一块`);
  }
  // 0.6.1：文字放不下时，先让照片把行数让出来（最少让到 MIN_BOX.image 的高），
  // 让完还放不下才截断 —— 用户抱怨「字超出自定义框」，多半是照片占得太满。
  const image = layout.items.find((item) => item.id === 'image');
  if (image) {
    let guard = 0;
    const minRows = MIN_BOX.image?.rowSpan ?? 6;
    while (plan.items.some((i) => i.truncated) && image.rowSpan > minRows && guard < 16) {
      guard += 1;
      const oldBottom = image.row + image.rowSpan;
      image.rowSpan -= 1;
      const newBottom = image.row + image.rowSpan;
      const freed = oldBottom - newBottom;
      for (const item of layout.items) {
        if (item === image) continue;
        if (item.row >= oldBottom) item.row -= freed;
      }
      plan = planOnce(layout, input);
    }
  }

  // 0.6.2：底部用不完的行全部给照片块，下面那些块顺次往下挪 —— 用户抱怨「空白很多、图太小」。
  // 只挪不改大小，所以字不会被挤掉；挪完再用 planOnce 重算一遍。
  const growable = layout.items.find((item) => item.id === 'image');
  if (growable) {
    const usedBottom = Math.max(...layout.items.map((item) => item.row + item.rowSpan));
    const slack = layout.rows - usedBottom;
    if (slack > 0) {
      const imageBottom = growable.row + growable.rowSpan;
      const below = layout.items.filter((item) => item !== growable && item.row >= imageBottom);
      growable.rowSpan += slack;
      for (const item of below) item.row += slack;
      const overflow = Math.max(...layout.items.map((item) => item.row + item.rowSpan)) - layout.rows;
      if (overflow > 0) {
        growable.rowSpan = Math.max(MIN_BOX.image?.rowSpan ?? 6, growable.rowSpan - overflow);
        for (const item of below) item.row -= overflow;
      }
      plan = planOnce(layout, input);
    }
  }

  return plan;
}

/** 竖排（每块都占满整宽）—— 老项目/关掉排版台时走这条 */
function isVertical(layout: PageLayout): boolean {
  return layout.items.every((item) => item.col === 0 && item.colSpan === layout.cols);
}

/**
 * 0.6.2：竖排时按「真实文字高度」重新分行，剩下的行全给照片。
 * 以前是按经验高度估的，估多了就留一片空白、照片被压得很小（用户实测一页下半截是空的）。
 */
function fitVertical(layout: PageLayout, input: LayoutPlanInput): PageLayout {
  const rows = layout.rows;
  const rowH = rowHCm(layout, input.contentHeightCm);
  const colW = colWCm(layout, input.contentCm);
  const order = [...layout.items].sort((a, b) => a.row - b.row || a.col - b.col);
  const hasImage = order.some((item) => item.id === 'image');
  const textIds = order.filter((item) => item.id !== 'image').map((item) => item.id);
  const minImageRows = hasImage ? MIN_BOX.image?.rowSpan ?? 6 : 0;

  // 竖排的优先级：标题、图、图注、正文、拍摄手法必须保住；
  // 挤不下时从「无障碍 → 氛围 → 标签 → 类别 → 机身 → 参数 → 建议 → 评分」依次让位，
  // 不去压字号把正文压成一行（用户实测过：那样正文只剩半句）。
  const DROP_ORDER: PhotoBlockId[] = ['alt', 'mood', 'tags', 'category', 'exif', 'params', 'advice', 'score'];
  const active = textIds.slice();
  // 先降字号（9.5 → 9 → 8.5），还不行再按 DROP_ORDER 让块
  let baseFont = 9.5;
  let spans: number[] = [];
  let total = 0;
  for (const fontPt of [9.5, 9, 8.5]) {
    spans = active.map((id) => {
      const need = blockNeedCm({ ...input, id, widthCm: colW * layout.cols, fontPt });
      return Math.max(MIN_BOX[id]?.rowSpan ?? 1, Math.ceil((need + 0.12) / rowH));
    });
    total = spans.reduce((sum, span) => sum + span, 0);
    baseFont = fontPt;
    if (total + minImageRows <= rows) break;
  }
  for (const candidate of DROP_ORDER) {
    if (total + minImageRows <= rows) break;
    const at = active.indexOf(candidate);
    if (at < 0) continue;
    active.splice(at, 1);
    spans = active.map((id) => {
      const need = blockNeedCm({ ...input, id, widthCm: colW * layout.cols, fontPt: baseFont });
      return Math.max(MIN_BOX[id]?.rowSpan ?? 1, Math.ceil((need + 0.12) / rowH));
    });
    total = spans.reduce((sum, span) => sum + span, 0);
  }

  const imageRows = Math.max(1, rows - total);
  const items: LayoutItem[] = [];
  let cursor = 0;
  for (const item of order) {
    if (item.id === 'image') {
      items.push({ ...item, col: 0, row: cursor, colSpan: layout.cols, rowSpan: imageRows });
      cursor += imageRows;
      continue;
    }
    const at = active.indexOf(item.id);
    if (at < 0) continue; // 被挤掉的块这一页不印
    const span = spans[at] ?? 1;
    items.push({ ...item, col: 0, row: cursor, colSpan: layout.cols, rowSpan: span });
    cursor += span;
  }
  return { ...layout, items };
}

function planOnce(layout: PageLayout, input: LayoutPlanInput): LayoutPlan {
  const rowH = rowHCm(layout, input.contentHeightCm);
  const colW = colWCm(layout, input.contentCm);
  const items: ItemPlan[] = [];
  const warnings: string[] = [];

  for (const item of layout.items) {
    const widthCm = colW * item.colSpan;
    const heightCm = rowH * item.rowSpan;
    if (item.id === 'image') {
      items.push({ item, widthCm, heightCm, fontPt: 0, needCm: heightCm, fits: true, truncated: false, shrunk: false });
      continue;
    }

    let chosen = FONT_LADDER[FONT_LADDER.length - 1];
    let need = 0;
    let fits = false;
    let shrunk = false;
    for (const fontPt of FONT_LADDER) {
      need = blockNeedCm({ ...input, id: item.id, widthCm, fontPt });
      chosen = fontPt;
      if (need <= heightCm) {
        fits = true;
        break;
      }
    }
    if (fits) {
      shrunk = chosen < FONT_LADDER[0];
    }
    const truncated = !fits;
    if (truncated) {
      warnings.push(`${BLOCK_MAP[item.id]?.label ?? item.id} 的格子太小，内容会被截断`);
    } else if (shrunk) {
      warnings.push(`${BLOCK_MAP[item.id]?.label ?? item.id} 的字被压到 ${chosen}pt 才放得下`);
    }
    items.push({ item, widthCm, heightCm, fontPt: chosen, needCm: need, fits, truncated, shrunk });
  }

  // 0.6.2：同一页里的文字只用一个字号 —— 用户抱怨「字体大小不定，看着乱」。
  // 目标字号 = 各文字块能装下的最大字号里的最小值，但不低于 9pt（别整页都变蚂蚁字）；
  // 个别格子实在装不下，才自己再往下降 —— 这样一页里最多两种字号，且都是被迫的。
  const fitted = items.filter((item) => item.item.id !== 'image' && !item.truncated);
  if (fitted.length > 1) {
    const target = Math.max(9, Math.min(...fitted.map((item) => item.fontPt)));
    const candidates = FONT_LADDER.filter((fontPt) => fontPt <= target).slice().reverse();
    for (const item of fitted) {
      if (item.fontPt === target) continue;
      let applied = item.fontPt;
      for (const fontPt of candidates) {
        const need = blockNeedCm({ ...input, id: item.item.id, widthCm: item.widthCm, fontPt });
        if (need <= item.heightCm) {
          item.fontPt = fontPt;
          item.needCm = need;
          applied = fontPt;
          break;
        }
      }
      item.shrunk = applied < FONT_LADDER[0];
    }
  }

  // 图片是唯一需要「兜底」的：没有图片块时补一句提醒
  if (!layout.items.some((item) => item.id === 'image')) {
    warnings.push('这一页没有照片积木，导出的页面上不会有图片');
  }

  return { layout, items, rowHCm: rowH, colWCm: colW, warnings };
}

/** 一页里有没有某块 */
export function layoutHas(layout: PageLayout, id: PhotoBlockId): boolean {
  return layout.items.some((item) => item.id === id);
}

/* ---------------------------- 给模型看的说明 ---------------------------- */

/**
 * 把「这一页印成什么样」翻译成一句给模型看的话（0.5.7 的 pageHint 升级版）：
 * 现在不只是「印不印」，还有「占多大地方」—— 格子小，文字就得短。
 */
export function pageHint(settings: ExportSettings): string {
  const layout = resolveLayout(settings);
  const items = layout.items;
  const has = (id: PhotoBlockId) => items.some((item) => item.id === id);
  const spans = (id: PhotoBlockId) => items.find((item) => item.id === id)?.colSpan ?? 0;
  const parts: string[] = [];

  if (!has('title')) {
    parts.push('这一页不印标题，标题只作内部标记，请写最短、最能指认的一张（4–8 字）');
  }
  if (!has('story')) {
    parts.push('这一页不印正文，story 只写 1 句（30–50 字），把最值得说的一件事说完就停');
    return parts.join('；');
  }

  const storySpan = spans('story');
  const storyRowSpan = items.find((item) => item.id === 'story')?.rowSpan ?? 4;
  const contentCm = exportContentCm(settings);
  const contentHeightCm = exportContentHeightCm(settings);
  const storyWidthCm = colWCm(layout, contentCm) * storySpan;
  const storyHeightCm = rowHCm(layout, contentHeightCm) * storyRowSpan;
  const perLine = measureTextCm('字'.repeat(20), storyWidthCm, 10).charsPerLine;
  const storyLines = Math.max(1, Math.floor((storyHeightCm - 0.4) / (10 * PT_TO_CM * 1.6)));
  const storyCap = Math.max(30, perLine * storyLines);
  if (storyWidthCm >= 3 && storyLines >= 1) {
    parts.push(
      `这一页正文的格子约 ${storyWidthCm.toFixed(1)}cm 宽、可排 ${storyLines} 行（每行约 ${perLine} 字），` +
        `story 请写到 ${Math.max(30, Math.floor(storyCap * 0.8))}–${storyCap} 字之间，超过 ${storyCap} 字一定会被截断`,
    );
    return parts.join('；');
  }
  if (storySpan <= 4) {
    parts.push(
      `这一页的正文只占一小栏（约 ${Math.round(storyRowSpan * 0.6)} 行、每行十几字），story 控制在 60–90 字，写多了会被截断`,
    );
  } else if (storySpan >= 10) {
    parts.push('这一页正文占满整幅宽度，story 可以写到 120–180 字');
  } else {
    parts.push('这一页正文占大半幅，story 控制在 90–130 字');
  }

  if (has('score') || has('advice') || has('params')) {
    parts.push('同页还印参数/评分/建议，story 不要再长');
  }
  if (has('caption') && (settings.captionStyle ?? 'title') !== 'both') {
    parts.push('图注只印编号加标题，画面里的关键信息请写进 story');
  }
  if (has('category')) parts.push('会单独印「类别」，请让 tags 的第一个是最准确的题材词');
  if (!has('technique')) parts.push('这一页不印拍摄手法，构图/光线/调色不必在 story 里复述');
  if (has('alt')) parts.push('会印无障碍描述，story 请避免与 alt 重复');

  return parts.join('；');
}

/** 人类可读的一页描述，用于排版台的状态条 */
export function describeLayout(layout: PageLayout): string {
  const order = layoutOrder(layout);
  const labels = order.map((id) => BLOCK_MAP[id]?.label ?? id);
  return labels.join(' · ');
}

/** 工具箱（按分组），排版台左侧用 */
export function toolboxBlocks(): { group: string; items: typeof BLOCKS }[] {
  const groups = ['版面', '文字', '解读'] as const;
  return groups.map((group) => ({
    group,
    items: BLOCKS.filter((block) => block.group === group),
  }));
}
