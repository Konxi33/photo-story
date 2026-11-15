// src/lib/export/metrics.ts
// 0.5.4：把「纸张 + 页边距 + 装订线」换算成实际可用宽度，供排版时用。
// 之前所有版面尺寸都写死 A4 标准边距（16.6cm），换 A5 或加装订线就会溢出页边。

import { WORD_BODY, WORD_PAPER, contentWidthCm } from '@/config/wordLayout';
import type { ExportSettings } from '@/types/domain';

export function exportMarginCm(settings: ExportSettings): number {
  return settings.margins === 'narrow' ? 1.6 : settings.margins === 'wide' ? 3.0 : 2.2;
}

/** 正文可用宽度（cm），已扣页边距与装订线 */
export function exportContentCm(settings: ExportSettings): number {
  return contentWidthCm(settings.paperSize ?? 'a4', exportMarginCm(settings), settings.gutter ?? 0);
}

/** 正文可用高度（cm），横向时按横向页高算 */
export function exportContentHeightCm(settings: ExportSettings): number {
  const paper = WORD_PAPER[settings.paperSize ?? 'a4'] ?? WORD_PAPER.a4;
  const margin = exportMarginCm(settings);
  const heightCm = settings.orientation === 'landscape' ? paper.widthCm : paper.heightCm;
  return Math.max(6, heightCm - margin * 2);
}

/** 图片框上限：左右不越过可用宽度，上下不超过一页可用高度的一半多（留出文字空间） */
export function exportFrameCm(settings: ExportSettings): { widthCm: number; heightCm: number } {
  const base = settings.layout === 'loose' ? WORD_BODY.frameLoose : WORD_BODY.frameCompact;
  const content = exportContentCm(settings);
  // 双栏时图片只能占一栏宽，否则在 Word 里会横跨到下一栏
  const usableWidth = settings.bodyColumns === 2 ? Math.max(5, content / 2 - 0.45) : content;
  const usableHeight = exportContentHeightCm(settings);
  return {
    widthCm: Math.min(base.widthCm, usableWidth),
    heightCm: Math.min(base.heightCm, Math.max(7, usableHeight - 3)),
  };
}
