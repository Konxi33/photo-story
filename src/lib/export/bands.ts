/**
 * 0.8.4 导出排版内核：把「排版台上的绝对格子」折算成「自上而下的行带」。
 *
 * 为什么要有这一层：
 * 排版台的画布是 12×24 的等分格子，用户摆的「序号 / 标题 / 大图 / 图注 / 正文」
 * 实际只占其中一部分。旧导出直接把这些格子按 1/24 的高度绝对定位画出来，
 * 于是照片被塞进一个「高度刚好够」的格子再垂直居中 —— 标题和照片之间空一大块、
 * 照片和图注之间又空一大块、页底再留 1/3 白（用户原话：「排版很杂乱」「很多空的白区域」）。
 *
 * 这一层换成「内容说话」：
 *   1. 先按 row 把块聚成「行带」（同一横缝上互不重叠的列 → 并排；纵向叠在同一列的 → 同格）；
 *   2. 每带的高度 = 这一带里最高那一格的真实内容高度（文字用 measureTextCm 量，图片按画幅比算）；
 *   3. 总高超过版心时，先压图片（保画幅、只缩小），再按优先级让块，最后才降字号；
 *   4. 富余高度平均分给上下留白（画册里的照片本来就该在纸面中间，而不是贴着页眉）。
 *
 * 纯函数、不碰 DOM，PDF 与 Word 共用同一套结果 —— 两边导出才能真的长得一样。
 */
import type { ExportSettings, Photo } from '@/types/domain';
import type { LayoutItem, PageLayout } from './layout';
import { blockNeedCm } from './layout';
import type { PhotoBlockId } from './blocks';

/** 行带之间的间距（cm）：一段文字和图注之间比起标题下面要松一点 */
export const BAND_GAP_CM = 0.5;
/** 标题与照片之间：黑体标题直接贴住图边会很挤，留一口气（0.8.4） */
export const BAND_GAP_TITLE_IMAGE_CM = 0.62;
/** 照片与图注之间：图注是照片的注脚，贴紧一点才像一个整体（0.8.4） */
export const BAND_GAP_IMAGE_CAPTION_CM = 0.3;
/** 照片无论如何不小于这个高度（cm），再小就没法看了 */
export const MIN_IMAGE_CM = 6.2;
/** 字号阶梯：还装不下才往下走一档 */
export const BAND_FONT_LADDER = [10.5, 9.5, 9, 8.5] as const;

/** 挤不下时按这个顺序让块（照片、标题、图注、正文永远保住） */
const DROP_ORDER: PhotoBlockId[] = [
  'alt',
  'mood',
  'tags',
  'category',
  'exif',
  'params',
  'score',
  'advice',
  'technique',
];

/** 窄于 4/12 列时中文一行放不下几个字，要保底 */
const LONG_TEXT_IDS: PhotoBlockId[] = ['story', 'technique', 'advice', 'score', 'params', 'alt'];

/** 并排两栏之间的间隙（cm） */
const CELL_GAP_CM = 0.36;
/** 同一栏里上下两块之间的间隙（cm） */
const STACK_GAP_CM = 0.16;

/** 一条行带里的一格：占第 col..col+span 列，里面自上而下叠着 ids */
export interface BandRange {
  col: number;
  span: number;
  ids: PhotoBlockId[];
}

/** 规划好的一格 */
export interface BandItemPlan {
  id: PhotoBlockId;
  col: number;
  span: number;
  /** 这一格实际可用的宽度（cm，已扣掉栏间间隙） */
  widthCm: number;
  /** 这一块需要的高度（cm） */
  needCm: number;
  /** 图片按这一格宽度算出来的自然高度（cm），非图片为 0 */
  imageHeightCm: number;
}

/** 规划好的一条行带 */
export interface BandPlan {
  items: BandItemPlan[];
  /** 这一带的高度（cm）= 带内最高那格的高度 */
  heightCm: number;
  /** 与下一带的间距（cm） */
  gapAfterCm: number;
  hasImage: boolean;
  /** 这一带里最高那格的宽度（图片按这个宽度铺满，再等比收高） */
  widestCm: number;
}

export interface PageBands {
  bands: BandPlan[];
  /** 所有带 + 间距的总高（cm） */
  totalCm: number;
  /** 顶部留白（cm）：富余高度的上半给上面，下半给下面 */
  topPadCm: number;
  /** 最终用的正文字号（pt） */
  fontPt: number;
  /** 为了塞进这一页而被省掉的块 */
  dropped: PhotoBlockId[];
  /** 照片最终画多高、多宽（cm）；没有照片时都是 0 */
  imageHeightCm: number;
  imageWidthCm: number;
}

export interface PageBandsInput {
  photo: Photo;
  index: number;
  settings: ExportSettings;
  layout: PageLayout;
  /** 版心宽（cm） */
  contentCm: number;
  /** 版心高（cm） */
  contentHeightCm: number;
  /** 画幅比（宽 / 高）；没有照片给 0 */
  aspect: number;
}

/** 这个块到底有没有内容 —— 有内容才占地方，空的直接不排 */
export function blockHasContent(id: PhotoBlockId, photo: Photo, settings: ExportSettings): boolean {
  const a = photo.status === 'success' ? photo.analysis : undefined;
  switch (id) {
    case 'image':
      return true;
    case 'title':
      return Boolean((a?.title || photo.fileName || '').trim());
    case 'caption':
      return settings.captionUnderImage !== false;
    case 'story':
      return settings.includeStory !== false && Boolean(a?.story?.trim());
    case 'category':
      return Boolean((a?.tags?.[0] || a?.mood || '').trim());
    case 'mood':
      return Boolean(a?.mood?.trim());
    case 'tags':
      return (a?.tags?.length ?? 0) > 0;
    case 'technique':
      return Boolean(a && Object.values(a.technique ?? {}).some((v) => String(v ?? '').trim().length > 0));
    case 'exif':
      return Boolean(photo.exif);
    case 'params':
      return Boolean(
        a?.params && Object.values(a.params).some((v) => String(v ?? '').trim().length > 0),
      );
    case 'score':
      return Boolean(a?.score);
    case 'advice':
      return Boolean(
        a && ((a.whyGood?.length ?? 0) + (a.improve?.length ?? 0) + (a.imitate?.length ?? 0)) > 0,
      );
    case 'alt':
      return Boolean(a?.alt?.trim());
    default:
      return false;
  }
}

/**
 * 把画布切成行带（与 Word 画布流式同一套切法，只是这里只关心「结构」）。
 *
 * 切缝取所有块的 row 与 row+rowSpan（外加 0 和 rows）；相邻两条缝之间，
 * 覆盖它的块集合是稳定的 —— 这些块的列区间互不重叠，所以一条横缝天然就是「一行单元格」。
 * 若干条横缝的列区间分布完全一致时并成一条带，右栏竖着堆的块就落在同一格里。
 */
export function groupBands(items: LayoutItem[], rows: number): BandRange[][] {
  const cuts = new Set<number>([0, rows]);
  for (const item of items) {
    cuts.add(Math.max(0, Math.min(rows, item.row)));
    cuts.add(Math.max(0, Math.min(rows, item.row + item.rowSpan)));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const slabs: BandRange[][] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const top = points[i];
    const bottom = points[i + 1];
    if (bottom <= top) continue;
    const active = items
      .filter((item) => item.row <= top && item.row + item.rowSpan >= bottom)
      .sort((a, b) => a.col - b.col || a.row - b.row);
    // 整段空白行（用户摆得比较松）：不占版面，Word 那边靠段间距补，这里直接跳过
    if (active.length === 0) continue;
    slabs.push(active.map((item) => ({ col: item.col, span: item.colSpan, ids: [item.id] })));
  }

  const bands: BandRange[][] = [];
  for (const slab of slabs) {
    const last = bands[bands.length - 1];
    const same =
      last &&
      last.length === slab.length &&
      last.every((range, i) => range.col === slab[i].col && range.span === slab[i].span);
    if (same) {
      slab.forEach((range, i) => {
        for (const id of range.ids) {
          if (!last[i].ids.includes(id)) last[i].ids.push(id);
        }
      });
      continue;
    }
    bands.push(slab.map((range) => ({ ...range, ids: [...range.ids] })));
  }

  // 0.8.4：一个块横跨两条带（它的 row 起在上一段、over 到下一段）时，
  // 会在两条带里各出现一次 —— 那一页就会把整段正文印两遍（grid-full 实测页底
  // 多出一整段重复文字并顶出纸外）。块只在它「开始」的那条带里画一次。
  const emitted = new Set<PhotoBlockId>();
  for (const band of bands) {
    for (const range of band) {
      range.ids = range.ids.filter((id) => {
        if (emitted.has(id)) return false;
        emitted.add(id);
        return true;
      });
    }
  }
  return bands.filter((band) => band.some((range) => range.ids.length > 0));
}

/** 一格至少要多宽（列数）才不会把字挤成竖排 */
function floorCols(ids: PhotoBlockId[]): number {
  if (ids.length === 0) return 0;
  if (ids.includes('image')) return 4;
  return Math.max(...ids.map((id) => (LONG_TEXT_IDS.includes(id) ? 4 : 2)));
}

/**
 * 把一条行带补成整 cols 列，并给「不够宽」的格子匀一点宽度。
 * 总和永远等于 cols，版面不会被撑宽。
 */
function distribute(
  ranges: BandRange[],
  cols: number,
): { col: number; span: number; ids: PhotoBlockId[] }[] {
  const cells: { col: number; span: number; ids: PhotoBlockId[] }[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (range.col > cursor) {
      cells.push({ col: cursor, span: range.col - cursor, ids: [] });
    }
    const span = Math.max(1, Math.min(range.span, cols - range.col));
    cells.push({ col: range.col, span, ids: range.ids });
    cursor = range.col + span;
  }
  if (cursor < cols) cells.push({ col: cursor, span: cols - cursor, ids: [] });

  const spans = cells.map((cell) => cell.span);
  const floors = cells.map((cell) => Math.min(cell.span, floorCols(cell.ids)));
  for (let i = 0; i < spans.length; i += 1) {
    let need = floors[i] - spans[i];
    if (need <= 0) continue;
    const donors = spans
      .map((span, j) => ({ j, slack: cells[j].ids.length === 0 ? span : Math.max(0, span - floors[j]) }))
      .filter((donor) => donor.j !== i && donor.slack > 0)
      .sort((a, b) => b.slack - a.slack);
    for (const donor of donors) {
      if (need <= 0) break;
      const take = Math.min(donor.slack, need);
      spans[donor.j] -= take;
      spans[i] += take;
      need -= take;
    }
  }
  return cells.map((cell, i) => ({ ...cell, span: spans[i] })).filter((cell) => cell.span > 0);
}

/** 文字块之间的间距已经算在 blockNeedCm 的 +0.1~0.35 里，这里只补叠放的小间隙 */
const stackGap = (count: number): number => (count > 1 ? STACK_GAP_CM * (count - 1) : 0);

interface BuildResult {
  bands: BandPlan[];
  totalCm: number;
}

/** 按给定字号与图片高度上限，算一遍行带 */
function build(
  input: PageBandsInput,
  activeIds: PhotoBlockId[],
  fontPt: number,
  imageCapCm: number,
  squeeze = 1,
): BuildResult {
  const { photo, settings, layout, contentCm, aspect } = input;
  const cols = Math.max(1, layout.cols);
  const items = layout.items.filter((item) => activeIds.includes(item.id));
  const shapes = groupBands(items, layout.rows);

  const bands: BandPlan[] = [];
  for (const shape of shapes) {
    const cells = distribute(shape, cols);
    const planned: BandItemPlan[] = [];
    let bandHeight = 0;
    let widest = 0;

    for (const cell of cells) {
      if (cell.ids.length === 0) continue;
      // 列间距由 CSS 的 column-gap 提供，所以每格都要让出 CELL_GAP_CM：
      // n 格总宽 = contentCm - n*gap + (n-1)*gap = contentCm - gap，永远留一点余量，
      // 不会因为累计误差把最后一格挤出纸外（挤出就会被 overflow 切掉）。
      const cellWidthCm = Math.max(1.6, (cell.span / cols) * contentCm - CELL_GAP_CM);
      let cellHeight = 0;
      for (const id of cell.ids) {
        const need =
          id === 'image'
            ? Math.min(cellWidthCm / Math.max(0.2, aspect || 1.5), imageCapCm)
            : // squeeze < 1 是最后一道兜底：按比例收窄每块分到的高度，
              // blockInner 会用 fitText 按整句缩短（不会切半句），页面因此不会顶出纸外。
              Math.max(0.9, blockNeedCm({ id, widthCm: cellWidthCm, photo, settings, fontPt, index: input.index }) * squeeze);
        planned.push({
          id,
          col: cell.col,
          span: cell.span,
          widthCm: cellWidthCm,
          needCm: need,
          imageHeightCm: id === 'image' ? need : 0,
        });
        cellHeight += need;
      }
      cellHeight += stackGap(cell.ids.length);
      bandHeight = Math.max(bandHeight, cellHeight);
      if (cellHeight >= bandHeight - 0.001) widest = Math.max(widest, cellWidthCm);
    }

    if (planned.length === 0) continue;
    const hasImage = planned.some((item) => item.id === 'image');
    bands.push({ items: planned, heightCm: bandHeight, gapAfterCm: 0, hasImage, widestCm: widest });
  }

  // 间距分三档（0.8.4）：标题压着照片时留一点气口（否则黑体标题直接贴住图边，很挤），
  // 照片与图注贴紧（图注是照片的注脚，隔开就散了），其余按常规行距。
  for (let i = 0; i < bands.length - 1; i += 1) {
    const prev = bands[i];
    const next = bands[i + 1];
    const prevTitle = prev.items.some((item) => item.id === 'title');
    const nextCaption = next.items.some((item) => item.id === 'caption');
    let gap = BAND_GAP_CM;
    if (prevTitle && next.hasImage) gap = BAND_GAP_TITLE_IMAGE_CM;
    else if (prev.hasImage && nextCaption) gap = BAND_GAP_IMAGE_CAPTION_CM;
    else if (prev.hasImage || next.hasImage) gap = BAND_GAP_IMAGE_CAPTION_CM;
    prev.gapAfterCm = gap;
  }

  const totalCm =
    bands.reduce((sum, band) => sum + band.heightCm, 0) +
    bands.reduce((sum, band) => sum + band.gapAfterCm, 0);
  return { bands, totalCm };
}

/**
 * 规划一页的行带。
 *
 * 顺序是：字号从常规往下走 → 图片先压（保画幅）→ 还有装不下的块按 DROP_ORDER 让位。
 * 富余高度平均分到上下（topPadCm），照片因此在纸面中间，而不是顶着页眉、页底一大片白。
 */
export function planPageBands(input: PageBandsInput): PageBands {
  const { photo, settings, aspect, contentHeightCm } = input;
  const available = Math.max(6, contentHeightCm);

  // 有照片时，照片的自然高度（按整栏宽度算）
  const naturalImageCm = aspect > 0 ? Math.min(input.contentCm / aspect, available) : 0;

  // 该排哪些块：没有内容的、序号一律不排；标题已经印在图上时不再重复印图注
  const present = new Set(
    input.layout.items
      .map((item) => item.id)
      .filter((id) => id !== 'index' && blockHasContent(id, photo, settings)),
  );
  const active = [...present];
  // 默认预设里 caption 与 title 同时存在：标题已经印在图上方，图注再印一遍就是重复
  if (active.includes('title') && active.includes('caption')) {
    const style = settings.captionStyle ?? 'title';
    if (style === 'title') active.splice(active.indexOf('caption'), 1);
  }
  if (active.length === 0) {
    return {
      bands: [],
      totalCm: 0,
      topPadCm: 0,
      fontPt: BAND_FONT_LADDER[0],
      dropped: [],
      imageHeightCm: 0,
      imageWidthCm: 0,
    };
  }

  const dropped: PhotoBlockId[] = [];
  let fontIdx = 0;
  let imageCap = naturalImageCm > 0 ? naturalImageCm : 0;
  let result = build(input, active, BAND_FONT_LADDER[fontIdx], imageCap);

  // 最多迭代 60 次：每次要么压一点图片、要么让掉一块、要么降一档字号，一定会收敛
  for (let guard = 0; guard < 60 && result.totalCm > available + 0.01; guard += 1) {
    const overflow = result.totalCm - available;
    const imageBand = result.bands.find((band) => band.hasImage);
    const shrinkable = imageBand
      ? Math.max(0, (imageBand.items.find((item) => item.id === 'image')?.imageHeightCm ?? 0) - MIN_IMAGE_CM)
      : 0;
    if (shrinkable > 0.05) {
      imageCap = Math.max(MIN_IMAGE_CM, imageCap - Math.min(shrinkable, overflow + 0.05));
      result = build(input, active, BAND_FONT_LADDER[fontIdx], imageCap);
      continue;
    }
    const next = DROP_ORDER.find((id) => {
      const at = active.indexOf(id);
      return at >= 0 && id !== 'image' && id !== 'title' && id !== 'caption' && id !== 'story';
    });
    if (next) {
      active.splice(active.indexOf(next), 1);
      dropped.push(next);
      result = build(input, active, BAND_FONT_LADDER[fontIdx], imageCap);
      continue;
    }
    if (fontIdx < BAND_FONT_LADDER.length - 1) {
      fontIdx += 1;
      result = build(input, active, BAND_FONT_LADDER[fontIdx], imageCap);
      continue;
    }
    break;
  }

  // 还有富余、并且照片被压过：把照片放大回去（页面上照片越大越好看）
  if (naturalImageCm > 0 && imageCap < naturalImageCm) {
    const slack = available - result.totalCm;
    if (slack > 0.05) {
      const grown = build(input, active, BAND_FONT_LADDER[fontIdx], Math.min(naturalImageCm, imageCap + slack));
      // 放回去不能把页面撑破；撑破就保持原样（build 的结果是「刚好」的那一版）
      if (grown.totalCm <= available + 0.01) result = grown;
    }
  }

  // 最后一层兜底（0.8.4）：图压到最小、能扔的块也扔完了、字号也降到底，还是装不下
  // （比如预设里塞了整段 600 字正文），就按比例收文字可用高度 —— blockInner 会
  // 按整句缩短，宁可少印两句，也不让正文顶出纸外（那是「一张纸装不下」的观感）。
  if (result.totalCm > available + 0.01) {
    let lo = 0.3;
    let hi = 1;
    for (let step = 0; step < 14; step += 1) {
      const mid = (lo + hi) / 2;
      const attempt = build(input, active, BAND_FONT_LADDER[fontIdx], imageCap, mid);
      if (attempt.totalCm <= available + 0.01) {
        result = attempt;
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }

  const imageItem = result.bands
    .flatMap((band) => band.items)
    .find((item) => item.id === 'image');
  const slack = Math.max(0, available - result.totalCm);

  return {
    bands: result.bands,
    totalCm: result.totalCm,
    // 富余高度上下平分：照片因此在纸面中间，而不是顶着页眉、页底一大片白。
    // 0.8.4 之前这里硬封顶 8cm，横构图那页就变成「上面堆着、底下 1/3 全白」。
    topPadCm: Math.min(slack / 2, 20),
    fontPt: BAND_FONT_LADDER[fontIdx],
    dropped,
    imageHeightCm: imageItem?.imageHeightCm ?? 0,
    imageWidthCm: imageItem && aspect > 0 ? imageItem.imageHeightCm * aspect : 0,
  };
}
