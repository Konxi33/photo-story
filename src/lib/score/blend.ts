// src/lib/score/blend.ts
// 把「模型主观判断」与「像素客观指标」混合成最终分数。
//
// 为什么不能只用模型：免费视觉模型对构图/光线的判断很粗，给所有照片都打 85–95，
// 压完校准曲线后用户看到的是「每张都 70 多分」，完全没有区分度。
//
// 现在的口径：
//   总分 = 50% 客观分（曝光/清晰度/色彩，从像素量出来）+ 50% 模型分（构图/主体/时机）
//   六项条形图按总分等比缩放，保证「条形加权 = 总分」，不会自相矛盾。

import type { PhotoScore } from '@/types/domain';
import { measureImage, type ImageMetrics } from './metrics';

const round1 = (n: number): number => Math.round(n * 10) / 10;
const clamp = (n: number, min = 20, max = 97): number =>
  Math.min(max, Math.max(min, round1(n)));

/** 权重与提示词保持一致 */
const WEIGHTS = {
  composition: 0.25,
  lighting: 0.2,
  color: 0.15,
  subject: 0.2,
  timing: 0.1,
  technique: 0.1,
} as const;

type Breakdown = PhotoScore['breakdown'];

function weighted(breakdown: Breakdown): number {
  return (
    breakdown.composition * WEIGHTS.composition +
    breakdown.lighting * WEIGHTS.lighting +
    breakdown.color * WEIGHTS.color +
    breakdown.subject * WEIGHTS.subject +
    breakdown.timing * WEIGHTS.timing +
    breakdown.technique * WEIGHTS.technique
  );
}

const scale = (value: number, factor: number): number => clamp(value * factor);

export function blendScore(model: PhotoScore, metrics: ImageMetrics | null): PhotoScore {
  if (!metrics) return model;

  // 客观分：曝光 40% + 清晰度 35% + 色彩 25%，映射到与模型同一量纲
  const objective = metrics.exposure * 0.4 + metrics.sharpness * 0.35 + metrics.color * 0.25;
  const objectiveScore = clamp(30 + objective * 0.62);

  const modelWeighted = weighted(model.breakdown);
  const lowKey = metrics.scene === 'lowkey';

  // 暗调画面里像素指标天然偏低（大片暗部拉低清晰度与色彩），
  // 这种场景把话语权多给模型一点——它能看懂「这是烟花，不是欠曝」。
  const wObjective = lowKey ? 0.42 : 0.6;
  const base = objectiveScore * wObjective + modelWeighted * (1 - wObjective);

  // 以 75（暗调 78）为轴轻度扩张，拉开档位
  const pivot = lowKey ? 78 : 75;
  const overall = clamp(pivot + (base - pivot) * 1.15);

  // 分项：像素指标替换掉它最能解释的那一项，其余保留模型判断
  const mixed: Breakdown = {
    composition: model.breakdown.composition,
    lighting: round1(model.breakdown.lighting * (lowKey ? 0.6 : 0.35) + metrics.exposure * (lowKey ? 0.4 : 0.65)),
    color: round1(model.breakdown.color * 0.4 + metrics.color * 0.6),
    subject: model.breakdown.subject,
    timing: model.breakdown.timing,
    technique: round1(model.breakdown.technique * 0.3 + metrics.sharpness * 0.7),
  };

  // 等比缩放，让分项加权正好等于总分
  const mixedWeighted = weighted(mixed);
  const factor = mixedWeighted > 0 ? overall / mixedWeighted : 1;

  const breakdown: Breakdown = {
    composition: scale(mixed.composition, factor),
    lighting: scale(mixed.lighting, factor),
    color: scale(mixed.color, factor),
    subject: scale(mixed.subject, factor),
    timing: scale(mixed.timing, factor),
    technique: scale(mixed.technique, factor),
  };

  return { overall: clamp(weighted(breakdown)), breakdown };
}

/** 一步到位：读像素 → 混合 */
export async function refineScore(
  modelScore: PhotoScore,
  blob: Blob,
): Promise<{ score: PhotoScore; metrics: ImageMetrics | null }> {
  const metrics = await measureImage(blob);
  return { score: blendScore(modelScore, metrics), metrics };
}
