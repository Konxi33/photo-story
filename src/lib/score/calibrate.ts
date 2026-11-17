/**
 * 模型分校准：把不同视觉模型给出的原始评分，映射到同一把「赛事评审尺」上。
 *
 * 为什么需要校准：
 * 大模型的 0–100 分并不是真的一把尺子，而是「压缩」过的——实际只用到中间一段，
 * 而且不同 provider 挤的中心不一样。同一张照片，智谱可能打 62、DeepSeek 打 70、
 * GPT 打 79，差别来自模型的打分习惯（偏紧/偏松），不是照片本身。评分要「相对准确」、
 * 又要「不同模型之间相对一致」，就必须先扣掉这个系统性偏移，再谈照片好坏。
 *
 * 校准分三步（全部是纯数学，可被 node 直接 require 做数值验证）：
 *   1) 中心对齐：按 family 扣掉各自的中心偏移，统一到公共中轴 78；
 *   2) 分段线性拉伸：把 60–90 这段最拥挤的区间拉开（这正是所有模型都挤在一起的地方），
 *      60 以下与 90 以上用更缓的斜率外延，压住「20 分废片」与「97 分神作」两种极端；
 *   3) 轻度向中轴收缩：只保留 94% 的偏离量，防止极端值继续放大。
 *
 * 本文件不 import 任何运行时依赖、不使用浏览器 API、无副作用，
 * 因此既能被 Next.js 打包，也能被 .devtools 下的 .cjs/.mjs 脚本直接引用来验算。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 目前接入过的模型家族。unknown 用于未识别的 provider/model，只做拉伸不做中心偏移。 */
export type ScoreModelFamily = 'deepseek' | 'zhipu' | 'openai' | 'unknown';

/** 场景类型，与 metrics.ts 的 SceneKind 保持一致（这里不 import，避免循环依赖）。 */
type Scene = 'lowkey' | 'normal' | 'highkey';

// ---------------------------------------------------------------------------
// 常数（每个常数都写清取值理由；改动时同步 .devtools/calib-demo.cjs）
// ---------------------------------------------------------------------------

/**
 * 每个家族「原始分的中心」——即该模型给一张中等偏上的好照片大约会打的分数。
 *
 * 取值依据（题面给了 72/78/81 的量级示例，但同一张照片的 raw 62/70/79 隐含的
 * 中心差是 8 分与 9 分，若只差 3 分则校准后仍会拉开 5 分以上，达不到 ≤3 分的目标，
 * 所以按「同片偏差」而不是「示例中心」取值，宁可按真实偏差校准）：
 * · deepseek 78：本身中心就接近中轴，作为基准，偏移为 0；
 * · zhipu 70：GLM 系偏紧，同片平均比 DeepSeek 低 8 分左右（raw 62 对 70）；
 * · openai 85：GPT 系偏松，同片平均比 DeepSeek 高 7 分左右（raw 79 对 70）；
 * · unknown 78：不认识就当作 DeepSeek 量级，只拉伸不偏移（最保守，不会把分数推偏）。
 *
 * 注意：这里的「中心」只在做中心对齐时使用，不是最终分数。
 */
const FAMILY_CENTER: Record<ScoreModelFamily, number> = {
  deepseek: 78,
  zhipu: 70,
  openai: 85,
  unknown: 78,
};

/** 公共中轴：所有家族最终都对齐到 78 这条线上，方便与既有 pivot(75/78) 规则衔接。 */
const CANONICAL_CENTER = 78;

/**
 * 分段线性的节点：输入（已对齐中心）→ 输出（公共坐标）。
 *
 * 每段斜率：
 * · 60–70 段 1.5：模型在 60–70 这一段区分度最差（什么都往 65 挤），拉得最狠；
 * · 70–80 段 1.2：中间档稍拉开即可，拉太狠会让正常照片虚高；
 * · 80–90 段 1.1：高分段的区分度本来就好，只轻微放大。
 * 60→55 让及格线附近「掉下来」更明显（60 分是很多模型的「安慰分底」）；
 * 90→93 让真正的好片在 90 以上还能再往上走一点，但不至于轻易摸到 97。
 */
const KNOTS: ReadonlyArray<readonly [number, number]> = [
  [60, 55],
  [70, 70],
  [80, 82],
  [90, 93],
];

/**
 * 60 以下的外延斜率 0.8（比 60–70 段的 1.5 缓近一半）：
 * 防止把 20 分的废片抬成 40 分的「还能看」——低分段的信号本来就少，缓一点更稳。
 * 90 以上的外延斜率 0.55（比 80–90 段的 1.1 缓一半）：
 * 越往上越不该有把握，避免 95 被拉到 99、制造「年度获奖级」虚高。
 */
const LOW_SLOPE = 0.8;
const HIGH_SLOPE = 0.55;

/**
 * 轻度收缩系数 0.94：78 + (x - 78) * 0.94。
 * 拉伸会放大极端值，收缩把偏离中轴的距离再压掉 6%：
 * 95 附近约收 1 分，20 附近约收 3.5 分——高分端收得少（怕误伤好片），低分端收得多（怕踩死废片）。
 */
const SHRINK = 0.94;

/**
 * 场景中心修正：暗调照片的「合格线」本来就比常规片高（评委不会因为暗调就扣分，
 * 反而默认暗调是更难的表现手法），所以低调用 +2 把中心抬起；高调少一点，用 -1。
 * 只改中心、不改斜率，保证单调性。
 */
const SCENE_SHIFT: Record<Scene, number> = {
  lowkey: 2,
  normal: 0,
  highkey: -1,
};

/** 最终输出范围：18–97。与 blend.ts 的 clamp(20, 97) 同向，但下限再留 2 分余量给「明显废片」。 */
const OUT_MIN = 18;
const OUT_MAX = 97;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// ---------------------------------------------------------------------------
// 家族判定
// ---------------------------------------------------------------------------

/**
 * 按 provider / model 字符串判断模型家族。
 * 只认关键字，不请求网络、不读配置——调用方把 meta.model 传进来即可。
 * provider 与 model 都为空（或都不认识）时返回 'unknown'。
 */
export function modelFamily(provider?: string, model?: string): ScoreModelFamily {
  const hay = `${provider ?? ''} ${model ?? ''}`.toLowerCase();
  if (hay.trim() === '') return 'unknown';

  if (hay.includes('deepseek')) return 'deepseek';
  if (hay.includes('zhipu') || hay.includes('glm') || hay.includes('chatglm')) return 'zhipu';
  // gpt-4o / gpt-4.1 / o1 / o3 / o4-mini 都算 openai 系；
  // 用词边界避免把 "gpt" 之外的字母组合误判（如 "photogpt" 仍算，属可接受误差）。
  if (hay.includes('openai') || /(^|[^a-z])gpt([^a-z]|$)/.test(hay) || /(^|[^a-z])o[1-4]([^a-z]|$)/.test(hay)) {
    return 'openai';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// 校准曲线
// ---------------------------------------------------------------------------

/** 分段线性拉伸：输入必须是已对齐中心的坐标（60–90 最拥挤区被拉开）。 */
function stretch(x: number): number {
  const first = KNOTS[0];
  const last = KNOTS[KNOTS.length - 1];
  if (x <= first[0]) return first[1] - (first[0] - x) * LOW_SLOPE;
  if (x >= last[0]) return last[1] + (x - last[0]) * HIGH_SLOPE;
  for (let i = 1; i < KNOTS.length; i += 1) {
    const [x1, y1] = KNOTS[i];
    if (x <= x1) {
      const [x0, y0] = KNOTS[i - 1];
      const t = (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

/**
 * 把某个模型给出的原始分，校准到公共坐标（78 中轴）。
 *
 * 流程：
 *   x = clamp(raw, 0, 100)                       —— 非有限数按 0 处理，防 NaN 传播
 *   debiased = x - (center - 78)                 —— 扣掉该模型的系统性偏移
 *   stretched = stretch(debiased)                —— 分段线性拉伸
 *   out = 78 + (stretched - 78) * 0.94 + shift   —— 轻度收缩 + 场景中心修正
 *   return round1(clamp(out, 18, 97))
 *
 * 单调性：center 固定、stretch 严格递增、SHRINK > 0，因此 raw 增大时 out 单调不减
 * （只在 18/97 两端被截断），这也是「不同模型落到同一把尺」不会破坏排序的前提。
 */
export function calibrateModelScore(
  raw: number,
  family: ScoreModelFamily,
  scene?: Scene,
): number {
  const center = FAMILY_CENTER[family];
  const x = clamp(Number.isFinite(raw) ? raw : 0, 0, 100);
  const debiased = x - (center - CANONICAL_CENTER);
  const stretched = stretch(debiased);
  const shifted = CANONICAL_CENTER + (stretched - CANONICAL_CENTER) * SHRINK;
  const out = shifted + (scene ? SCENE_SHIFT[scene] : 0);
  return round1(clamp(out, OUT_MIN, OUT_MAX));
}

// ---------------------------------------------------------------------------
// 一致性权重
// ---------------------------------------------------------------------------

/**
 * 模型分与像素分的一致性权重：两者越接近，越信模型；分歧越大，越信像素。
 *
 * 公式（d = |model - objective|，单位：分）：
 *   t = clamp((d - 4) / 20, 0, 1)      —— 4 分以内视为「同向」，不罚；24 分以上视为「各说各话」
 *   s = t²(3 - 2t)                     —— smoothstep，两端平缓、中间陡，避免在阈值附近抖动
 *   w = 0.5 - 0.3 * s                  —— 权重量程 0.5 → 0.2
 *
 * 为什么这样：
 * · 4 分以内是评委间正常的口径差，模型分是有信息量的，给到上限 0.5；
 * · 24 分以上说明模型和像素至少一方错了，像素指标（曝光/锐度/色彩统计）虽然有场景盲区，
 *   但不会「情绪化」，此时把模型权重压到 0.2，靠像素兜底；
 * · 用 smoothstep 而不是线性，是为了让 8–16 分这段「可疑区」的变化更明显，
 *   而 4 分内与 24 分外的判断保持稳定（同一张照片不会因为 1 分抖动就换权重）。
 */
export function agreementWeight(modelScore: number, objectiveScore: number): number {
  const m = clamp(Number.isFinite(modelScore) ? modelScore : 0, 0, 100);
  const o = clamp(Number.isFinite(objectiveScore) ? objectiveScore : 0, 0, 100);
  const spread = Math.abs(m - o);
  const t = clamp((spread - 4) / 20, 0, 1);
  const s = t * t * (3 - 2 * t);
  return Math.round((0.5 - 0.3 * s) * 1000) / 1000;
}