// src/lib/export/params.ts
// 拍摄参数规格化：AI 猜的参数是「推测 14mm」「ISO ISO 400」这类自由文本，
// 直接印在图注/相框/幻灯片上既重复又不像印刷品，统一在这里清洗。
// 放在独立文件里，是为了让 canvas 相框（frame.ts）也能用，而不必拖进 docx。

export type ParamKind = 'focal' | 'aperture' | 'shutter' | 'iso' | 'color';

export function tidyParam(raw: unknown, kind: ParamKind): string {
  let value = (raw ?? '').toString().trim();
  if (!value) return '';
  if (kind !== 'color') {
    value = value.replace(/^(推测|推断|估计|估算|约|大约|大概|可能是|可能)\s*/u, '').trim();
  }
  if (kind === 'focal') {
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? match[0] + 'mm' : '';
  }
  if (kind === 'aperture') {
    const match = value.match(/\d+(?:\.\d+)?/);
    return match ? 'f/' + match[0] : '';
  }
  if (kind === 'shutter') {
    const match = value.match(/\d+(?:\/\d+)?/);
    return match ? match[0] + 's' : '';
  }
  if (kind === 'iso') {
    const match = value.match(/\d{2,6}/);
    return match ? 'ISO ' + match[0] : '';
  }
  return value;
}

/** 一行参数：50mm · f/1.8 · 1/125s · ISO 100 · 暖调低饱和 */
export function paramLineInline(params?: {
  focalLength?: string;
  aperture?: string;
  shutter?: string;
  iso?: string;
  colorGrade?: string;
}): string {
  if (!params) return '';
  return [
    tidyParam(params.focalLength, 'focal'),
    tidyParam(params.aperture, 'aperture'),
    tidyParam(params.shutter, 'shutter'),
    tidyParam(params.iso, 'iso'),
    tidyParam(params.colorGrade, 'color'),
  ]
    .filter((v) => v.trim())
    .join(' · ');
}