// src/lib/score/localScore.ts
// 本地评分：不调用任何 AI，只用像素统计（曝光 / 清晰度 / 色彩）推导六项分数。
//
// 说明：用户提到的 IQA-PyTorch 是 Python + PyTorch 工具箱，模型与运行时加起来
// 几百 MB，无法塞进 Electron 安装包，也不允许在用户机器上装 Python。
// 这里用同一类「无参考图像质量评估」的思路做了轻量实现：
//   · 清晰度 → 边缘能量（类似 BRISQUE 的高频统计）
//   · 曝光   → 亮度直方图（欠曝/过曝/死黑死白）
//   · 色彩   → 饱和度与色彩丰富度
// 结果仍然客观、可复现、零成本，适合做批量初筛；主观审美仍建议用 AI。

import type { PhotoScore, ScoreBreakdown } from '@/types/domain';

import { measureImage } from './metrics';

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export interface LocalScoreResult {
  score: PhotoScore;
  advice: string[];
}

/** 纯本地评分（无网络） */
export async function computeLocalScore(blob: Blob): Promise<LocalScoreResult | null> {
  const metrics = await measureImage(blob);
  if (!metrics) return null;

  const { exposure, sharpness, color, stats } = metrics;

  // 构图：无参考图像很难真正判断构图，用对比度 + 曝光均衡度做代理，压低权重
  const composition = clamp(62 + (stats.contrast - 45) * 0.55 + (exposure - 70) * 0.18);
  const lighting = clamp(exposure * 0.82 + stats.contrast * 0.28);
  const colorScore = clamp(color);
  const subject = clamp(58 + sharpness * 0.32 + (stats.edgeEnergy - 18) * 0.35);
  const timing = clamp(60 + sharpness * 0.22 + (stats.contrast - 45) * 0.3);
  const technique = clamp(sharpness * 0.62 + color * 0.18 + exposure * 0.2);

  const breakdown: ScoreBreakdown = {
    composition: round1(composition),
    lighting: round1(lighting),
    color: round1(colorScore),
    subject: round1(subject),
    timing: round1(timing),
    technique: round1(technique),
  };

  const overall = round1(
    breakdown.composition * 0.25 +
      breakdown.lighting * 0.2 +
      breakdown.color * 0.15 +
      breakdown.subject * 0.2 +
      breakdown.timing * 0.1 +
      breakdown.technique * 0.1,
  );

  const advice: string[] = [];
  if (stats.clippedHigh > 0.06) advice.push('高光有溢出，后期压一下亮部');
  if (stats.clippedLow > 0.08) advice.push('暗部死黑偏多，提一点阴影');
  if (sharpness < 55) advice.push('清晰度偏低，注意对焦或快门速度');
  if (stats.contrast < 30) advice.push('画面偏灰，可适当加对比');
  if (stats.saturation < 18) advice.push('色彩偏淡，可轻微加饱和');
  if (advice.length === 0) advice.push('画质与曝光没有硬伤，可以进入文字打磨');

  return { score: { overall, breakdown }, advice };
}

export const LOCAL_SCORE_NOTE =
  '本地评分只看像素质量（曝光/清晰度/色彩），不判断内容好坏；需要审美判断时请切回 AI 评分。';
