// src/lib/score/blend.ts
// 把「模型主观判断」与「像素客观指标」混合成最终分数。
//
// 为什么不能只用模型：不同视觉模型的打分习惯差别很大（同一张照片智谱 62、
// DeepSeek 70、GPT 79 都常见），而且普遍往中间挤；只用模型，分数就取决于今天用
// 哪个 Key。为什么不能只用像素：像素读不出构图、主体、时机，也看不懂暗调是烟花
// 还是欠曝，给所有照片一个 70 多分的「平均脸」。
//
// 现在的口径：
//   1) 模型分先过一层「模型家族校准」（calibrate.ts），不同模型落到同一把尺；
//   2) 总分 = 校准后模型分与客观分按「一致性」加权：两者接近就多信模型，
//      分歧大就把话语权交给像素（agreementWeight 0.2–0.5）；
//   3) 六项条形图按总分等比缩放，保证「条形加权 = 总分」，不会自相矛盾。

import type { PhotoScore } from '@/types/domain';
import { agreementWeight, calibrateModelScore, type ScoreModelFamily } from './calibrate';
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

/**
 * 把模型的六维分逐项校准到公共坐标。
 * 场景修正只影响中心（暗调 +2、高调 -1），不改变六项之间的相对关系。
 */
function calibratePhoto(
  model: PhotoScore,
  family: ScoreModelFamily,
  scene?: ImageMetrics['scene'],
): PhotoScore {
  const breakdown: Breakdown = {
    composition: calibrateModelScore(model.breakdown.composition, family, scene),
    lighting: calibrateModelScore(model.breakdown.lighting, family, scene),
    color: calibrateModelScore(model.breakdown.color, family, scene),
    subject: calibrateModelScore(model.breakdown.subject, family, scene),
    timing: calibrateModelScore(model.breakdown.timing, family, scene),
    technique: calibrateModelScore(model.breakdown.technique, family, scene),
  };
  // overall 用校准后的小项重算，避免「小项已换尺、总分还是旧尺」的自相矛盾。
  return { overall: clamp(weighted(breakdown)), breakdown };
}

/**
 * @param family 模型家族；调用方从 meta.model 推断（见 calibrate.modelFamily）。
 *               默认 'unknown'：只拉伸、不做中心偏移，兼容尚未传 family 的旧调用。
 */
export function blendScore(
  model: PhotoScore,
  metrics: ImageMetrics | null,
  family: ScoreModelFamily = 'unknown',
): PhotoScore {
  // 拿不到像素（图片解码失败等）时仍然做校准：跨模型一致性靠校准就够了，
  // 只是没有场景修正。这样不会退回「今天用哪个模型就换一个分」的老问题。
  if (!metrics) return calibratePhoto(model, family);

  const calibrated = calibratePhoto(model, family, metrics.scene);

  // 客观分：曝光 40% + 清晰度 35% + 色彩 25%，映射到与模型同一量纲
  const objective = metrics.exposure * 0.4 + metrics.sharpness * 0.35 + metrics.color * 0.25;
  const objectiveScore = clamp(30 + objective * 0.62);

  const modelWeighted = weighted(calibrated.breakdown);
  const lowKey = metrics.scene === 'lowkey';

  // 常规场景：模型分与像素分一致就给模型 0.5，分歧大就压到 0.2（像素兜底）。
  // 暗调例外：这里的「分歧」来自像素指标本身不可靠（大片暗部拉低清晰度、色彩统计失真），
  // 不是模型错，所以不套 agreementWeight，沿用原来的 0.58，保住「烟花不是欠曝」的判断。
  const modelWeight = lowKey ? 0.58 : agreementWeight(modelWeighted, objectiveScore);
  const base = objectiveScore * (1 - modelWeight) + modelWeighted * modelWeight;

  // 以 75（暗调 78）为轴轻度扩张，拉开档位
  const pivot = lowKey ? 78 : 75;
  const overall = clamp(pivot + (base - pivot) * 1.15);

  // 分项：像素指标替换掉它最能解释的那一项，其余保留校准后的模型判断
  const mixed: Breakdown = {
    composition: calibrated.breakdown.composition,
    // 曝光在 objective 里已经占过 40%，这里不能再让像素曝光主导——
    // 否则同一份曝光信息被计两次，暗调/欠曝照片会被反复拉低。
    // 常规 55/45；暗调 60/40（暗调里像素曝光最不可信，多给模型一点）。
    lighting: round1(
      calibrated.breakdown.lighting * (lowKey ? 0.6 : 0.55) +
        metrics.exposure * (lowKey ? 0.4 : 0.45),
    ),
    color: round1(calibrated.breakdown.color * 0.4 + metrics.color * 0.6),
    subject: calibrated.breakdown.subject,
    timing: calibrated.breakdown.timing,
    technique: round1(calibrated.breakdown.technique * 0.3 + metrics.sharpness * 0.7),
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

/** 一步到位：读像素 → 校准 → 混合 */
export async function refineScore(
  modelScore: PhotoScore,
  blob: Blob,
  family: ScoreModelFamily = 'unknown',
): Promise<{ score: PhotoScore; metrics: ImageMetrics | null }> {
  const metrics = await measureImage(blob);
  return { score: blendScore(modelScore, metrics, family), metrics };
}