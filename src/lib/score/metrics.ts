// src/lib/score/metrics.ts
// 从像素里算客观分：曝光、清晰度、色彩。用来和模型的主观判断混合，
// 避免免费模型给所有照片一个相近的分数（区分度全靠模型是不可靠的）。
//
// 0.5.2 重做曝光：旧版拿平均亮度当唯一标准（target 0.5），夜景/烟花/舞台照
// 平均亮度只有 0.10–0.15，一律被判成「欠曝」拿 25–40 分——把好好的照片打死了。
// 现在先分场景（lowkey / normal / highkey），再按各自的健康标准打分：
//   · lowkey：暗部本来就该暗，看的是「亮部够不够亮」「暗部有没有留到底」「动态范围」
//   · highkey：看的是「高光有没有溢死」「暗部会不会脏成黑块」
//   · normal：中位亮度 + 高光/阴影溢出惩罚

export type SceneKind = 'lowkey' | 'normal' | 'highkey';

export interface ImageMetrics {
  /** 曝光健康度 0–100 */
  exposure: number;
  /** 清晰度 / 细节 0–100 */
  sharpness: number;
  /** 色彩表现 0–100 */
  color: number;
  /** 场景类型，决定曝光怎么算、也决定混合时谁说话 */
  scene: SceneKind;
  stats: {
    meanLuma: number;
    contrast: number;
    clippedHigh: number;
    clippedLow: number;
    saturation: number;
    edgeEnergy: number;
    /** 亮度分位：判断场景与动态范围用 */
    p05: number;
    p50: number;
    p95: number;
  };
}

const SAMPLE_W = 220;

async function loadBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片解码失败'));
    };
    img.src = url;
  });
}

const clamp = (n: number, min = 0, max = 100): number => Math.min(max, Math.max(min, n));

export async function measureImage(blob: Blob): Promise<ImageMetrics | null> {
  try {
    const src = await loadBitmap(blob);
    const sw =
      'naturalWidth' in src ? src.naturalWidth : (src as ImageBitmap).width;
    const sh =
      'naturalHeight' in src ? src.naturalHeight : (src as ImageBitmap).height;
    if (!sw || !sh) return null;

    const w = SAMPLE_W;
    const h = Math.max(1, Math.round((sh / sw) * w));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
    if ('close' in src && typeof src.close === 'function') src.close();

    const { data } = ctx.getImageData(0, 0, w, h);
    const luma = new Float32Array(w * h);
    const sat = new Float32Array(w * h);

    let sum = 0;
    let clippedHigh = 0;
    let clippedLow = 0;
    let satSum = 0;

    for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
      const r = data[i]! / 255;
      const g = data[i + 1]! / 255;
      const b = data[i + 2]! / 255;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      luma[p] = y;
      sum += y;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const s = max === 0 ? 0 : (max - min) / max;
      sat[p] = s;
      satSum += s;

      if (y >= 0.98) clippedHigh += 1;
      if (y <= 0.02) clippedLow += 1;
    }

    const count = w * h;
    const mean = sum / count;

    // 对比度：亮度标准差
    let variance = 0;
    for (let p = 0; p < count; p += 1) {
      const d = luma[p]! - mean;
      variance += d * d;
    }
    const contrast = Math.sqrt(variance / count);

    // 清晰度：4 邻域拉普拉斯响应均值（越大越锐）
    let edge = 0;
    let edgeCount = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        const v =
          4 * luma[i]! - luma[i - 1]! - luma[i + 1]! - luma[i - w]! - luma[i + w]!;
        edge += Math.abs(v);
        edgeCount += 1;
      }
    }
    const edgeEnergy = edgeCount > 0 ? edge / edgeCount : 0;

    const saturation = satSum / count;
    const highRatio = clippedHigh / count;
    const lowRatio = clippedLow / count;

    // 亮度分位：平均值会被大片黑底拉低，分位数才看得出「这是暗调还是欠曝」
    const sorted = Float32Array.from(luma).sort();
    const at = (q: number): number =>
      sorted[Math.min(count - 1, Math.max(0, Math.round(q * (count - 1))))] ?? 0;
    const p05 = at(0.05);
    const p50 = at(0.5);
    const p95 = at(0.95);

    const scene: SceneKind =
      p50 < 0.22 && p95 >= 0.3 ? 'lowkey' : p50 > 0.78 ? 'highkey' : 'normal';

    const exposure = exposureFor({ scene, p05, p50, p95, highRatio, lowRatio });

    // 清晰度：拉普拉斯均值经验区间 0.005–0.06，取对数映射
    const sharpness = clamp(
      34 + Math.log10(Math.max(edgeEnergy, 1e-4) / 0.008) * 26 + Math.min(contrast, 0.32) * 90,
      5,
      100,
    );

    // 色彩：饱和度适中最好（0.18–0.42），过低发灰、过高发脏
    const satScore =
      saturation < 0.18
        ? 100 - (0.18 - saturation) * 320
        : saturation > 0.42
          ? 100 - (saturation - 0.42) * 210
          : 96;
    const color = clamp(satScore * 0.8 + Math.min(contrast, 0.3) * 60, 5, 100);

    return {
      exposure: Math.round(exposure * 10) / 10,
      sharpness: Math.round(sharpness * 10) / 10,
      color: Math.round(color * 10) / 10,
      scene,
      stats: {
        meanLuma: Math.round(mean * 1000) / 1000,
        contrast: Math.round(contrast * 1000) / 1000,
        clippedHigh: Math.round(highRatio * 1000) / 1000,
        clippedLow: Math.round(lowRatio * 1000) / 1000,
        saturation: Math.round(saturation * 1000) / 1000,
        edgeEnergy: Math.round(edgeEnergy * 10000) / 10000,
        p05: Math.round(p05 * 1000) / 1000,
        p50: Math.round(p50 * 1000) / 1000,
        p95: Math.round(p95 * 1000) / 1000,
      },
    };
  } catch {
    return null;
  }
}

interface ExposureInput {
  scene: SceneKind;
  p05: number;
  p50: number;
  p95: number;
  highRatio: number;
  lowRatio: number;
}

/**
 * 按场景判曝光。
 * 暗调照片不该因为「暗」而被判死：烟花、夜景、舞台、烛光都靠大面积暗衬托亮点。
 */
function exposureFor({ scene, p05, p50, p95, highRatio, lowRatio }: ExposureInput): number {
  if (scene === 'lowkey') {
    // 亮部够亮（烟花/灯串要亮得起来），p95 落在 0.85 以上才算「亮得通透」
    const highlight = clamp((p95 - 0.28) * 135, 0, 100);
    // 动态范围：最暗到最亮拉得开，画面才通透
    const range = clamp((p95 - p05) * 170, 0, 100);
    // 暗部允许大面积存在，但整片死黑（没有任何细节）还是要扣
    const shadow = clamp(100 - Math.max(0, lowRatio - 0.55) * 160, 0, 100);
    const score =
      highlight * 0.42 + range * 0.3 + shadow * 0.28 - Math.max(0, highRatio - 0.06) * 90;
    return clamp(score, 5, 94);
  }

  if (scene === 'highkey') {
    // 高调（雪景、白背景）：主调偏高是正常的，扣的是溢死与脏暗部
    const base = 100 - Math.abs(p50 - 0.8) * 120;
    const shadow = clamp(100 - Math.max(0, lowRatio - 0.06) * 200, 0, 100);
    const range = clamp((p95 - p05) * 120, 0, 100);
    return clamp(
      base * 0.7 + shadow * 0.2 + range * 0.1 - Math.max(0, highRatio - 0.12) * 80,
      5,
      100,
    );
  }

  // 常规：中位亮度落在 0.38–0.55 最稳；轻微溢出不扣，成片溢死才扣
  const base = 100 - Math.abs(p50 - 0.46) * 130;
  return clamp(
    base - Math.max(0, highRatio - 0.02) * 150 - Math.max(0, lowRatio - 0.08) * 90,
    5,
    100,
  );
}
