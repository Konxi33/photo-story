/**
 * 照片墙的「距离场」：以视口中心为圆心，越靠外越小、越淡。
 *
 * 归一化：
 *   R = radiusFactor × hypot(vw, vh) / 2      // ≈ 中心到视口四角的距离
 *   t = clamp(d / R, 0, 1)                    // d = 方块中心到视口中心的屏幕距离
 *   e = t²(3-2t)                              // smoothstep：中心一片平缓、靠近边缘收得快
 *
 *   scale   = 1 - (1 - scaleMin) × e          // 1.00 → scaleMin
 *   opacity = 1 - (1 - opacityMin) × e        // 1.00 → opacityMin
 *
 * 两个映射都是 t 的连续函数（没有分档），所以拖动时方块的大小/亮度是连续变化的。
 */
export const FIELD = {
  /** 归一化半径系数：0.62 × 半对角线 */
  radiusFactor: 0.62,
  /**
   * 最边缘（t = 1）的缩放。
   * 0.7.2：原来 0.6，边缘方块被缩到六成、叠上 0.4 的不透明度，在米色纸面
   * 上看起来就是「一片空白方块」。收一点、提亮一点，照片才读得出来。
   */
  scaleMin: 0.74,
  /** 最边缘（t = 1）的不透明度 */
  opacityMin: 0.68,
} as const;

/** 视口对应的距离场半径（px）。 */
export function fieldRadius(vw: number, vh: number): number {
  const half = Math.hypot(vw, vh) / 2;
  return Math.max(1, FIELD.radiusFactor * half);
}

/** 给定「相对视口中心的偏移」，返回该位置应有的缩放与不透明度。 */
export function fieldAt(dx: number, dy: number, radius: number): { scale: number; opacity: number } {
  const t = Math.min(1, Math.hypot(dx, dy) / radius);
  const e = t * t * (3 - 2 * t);
  return {
    scale: 1 - (1 - FIELD.scaleMin) * e,
    opacity: 1 - (1 - FIELD.opacityMin) * e,
  };
}
