// src/lib/export/canvas.ts
//
// 0.8.4（第二轮重做）：让导出的页面跟「排版台」里摆的一模一样。
//
// 排版台存下来的是一张 12 列 × 24 行的画布，每个块占一块矩形（col/row/colSpan/rowSpan）。
// 以前导出把这些块重新「流式」排了一遍（分行带、压缩、让位），于是用户在排版台里精心对过的
// 位置、留白、并排关系全部失效 —— 这就是「我排版排出来的和真正出来的根本不是一个样子」。
//
// 现在导出直接用这张画布：列宽 = 版心宽 / cols，行高 = 版心高 / rows，块就落在它自己的格子里。
// 文字放不下时只做「按整句缩短」，绝不搬家、绝不改位置。

import type { ExportSettings, Photo } from '@/types/domain';
import type { PhotoBlockId } from '@/lib/export/blocks';
import { blockNeedCm, resolveLayout } from './layout';
import { blockHasContent } from './bands';

/** 一个块在页面上的精确矩形（cm），全部由画布推出，不做二次排版 */
export interface CanvasCell {
  id: PhotoBlockId;
  /** 左上角（相对版心，cm） */
  leftCm: number;
  topCm: number;
  widthCm: number;
  heightCm: number;
  /** 文字块算出来的字号（图片为 0） */
  fontPt: number;
  /** 该字号下这块文字需要的高度（cm） */
  needCm: number;
}

export interface CanvasPlan {
  cols: number;
  rows: number;
  colCm: number;
  rowCm: number;
  cells: CanvasCell[];
}

/** 字号阶梯：从常规往下收，只为了让一块文字尽量塞进它自己的格子 */
const FONT_LADDER = [10.5, 9.5, 9, 8.5];

export interface CanvasPlanInput {
  photo: Photo;
  settings: ExportSettings;
  /** 版心宽 / 版心高（cm） */
  contentCm: number;
  contentHeightCm: number;
  /** 这一页顶端已经压着章头时要让出的高度（cm） */
  reservedCm?: number;
  /** 照片画幅比（宽 / 高） */
  aspect: number;
  /** 第几张（图注/序号测量要用），从 1 起 */
  index?: number;
}

/**
 * 把「排版台画布」翻译成这一页的精确位置。
 *
 * 只做三件事：
 * 1. 去掉序号块（用户明确不要编号）与没有内容的块（没有评分就不留空格子）；
 * 2. 标题已经印在图上时，图注不再重复印一遍；
 * 3. 每块在自己的矩形里选一个放得下的字号。
 */
export function planCanvasPage(input: CanvasPlanInput): CanvasPlan {
  const layout = resolveLayout(input.settings);
  const cols = Math.max(1, layout.cols);
  const rows = Math.max(1, layout.rows);
  const reserved = Math.max(0, input.reservedCm ?? 0);
  const usableHeight = Math.max(4, input.contentHeightCm - reserved);
  const colCm = input.contentCm / cols;
  const rowCm = usableHeight / rows;

  const hasTitle =
    Boolean(input.photo.analysis?.title?.trim()) &&
    layout.items.some((item) => item.id === 'title');
  const dropped = new Set<PhotoBlockId>(['index']);
  // 标题已经印在图上：图注再印一遍就是重复（跟竖排版、行带排版同一口径）
  if (hasTitle) dropped.add('caption');

  const seen = new Set<PhotoBlockId>();
  const cells: CanvasCell[] = [];

  for (const item of layout.items) {
    if (dropped.has(item.id) || seen.has(item.id)) continue;
    if (!blockHasContent(item.id, input.photo, input.settings)) continue;
    seen.add(item.id);

    const span = Math.max(1, Math.min(item.colSpan, cols - item.col));
    const rowSpan = Math.max(1, Math.min(item.rowSpan, rows - item.row));
    const widthCm = span * colCm;
    const heightCm = rowSpan * rowCm;
    const leftCm = item.col * colCm;
    const topCm = item.row * rowCm;

    if (item.id === 'image') {
      // 图片按画幅收进格子：不裁切、不拉伸（和排版台预览一致）
      cells.push({ id: item.id, leftCm, topCm, widthCm, heightCm, fontPt: 0, needCm: heightCm });
      continue;
    }

    let fontPt = FONT_LADDER[FONT_LADDER.length - 1];
    let needCm = 0;
    // 0.8.5：格子实际可用高度 = 格子高 − 标签条（4.2mm）− 上下内边距。
    // 不减这块，按满格选出来的字号落进格子就少一行字，导出的 PDF 里标签块常被切半句
    // （用户看到的「被裁掉了」）。
    const budgetH = Math.max(1.2, heightCm - 0.55);
    for (const candidate of FONT_LADDER) {
      const need = blockNeedCm({
        id: item.id,
        widthCm,
        photo: input.photo,
        settings: input.settings,
        fontPt: candidate,
        index: input.index ?? 1,
      });
      if (need <= budgetH) {
        fontPt = candidate;
        needCm = need;
        break;
      }
      fontPt = candidate;
      needCm = need;
    }

    cells.push({ id: item.id, leftCm, topCm, widthCm, heightCm, fontPt, needCm });
  }

  return { cols, rows, colCm, rowCm, cells };
}
