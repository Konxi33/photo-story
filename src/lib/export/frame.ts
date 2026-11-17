// src/lib/export/frame.ts
// 相框与水印：在导出前把照片绘制到画布上，加边框、底部信息条与水印文字。
// 纯 canvas 实现，不依赖任何库。

import type { FrameStyle, ShootingParams } from '@/types/domain';

import { tidyParam } from './params';

export interface FrameOptions {
  style: FrameStyle;
  watermark: boolean;
  /** 机型，如 Xiaomi 14 Ultra */
  device?: string;
  /** 署名，如 摄影 / 张三 */
  author?: string;
  /** 拍摄参数，用于水印第二行 */
  params?: ShootingParams;
}

export const FRAME_PRESETS: { id: FrameStyle; label: string; note: string }[] = [
  { id: 'none', label: '无相框', note: '原图直出' },
  { id: 'white', label: '白边留白', note: '像画廊装裱' },
  { id: 'leica', label: '徕卡水印', note: '白底黑标，小米联名风' },
  { id: 'film', label: '胶片黑边', note: '黑色宽边，适合夜景' },
];

function loadImage(blob: Blob): Promise<HTMLImageElement> {
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

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 生成水印第二行：23mm · f/1.8 · 1/125s · ISO 100（与图注同口径，去掉「推测」这类字样） */
function paramLine(params?: ShootingParams): string {
  if (!params) return '';
  return [
    tidyParam(params.focalLength, 'focal'),
    tidyParam(params.aperture, 'aperture'),
    tidyParam(params.shutter, 'shutter'),
    tidyParam(params.iso, 'iso'),
  ]
    .filter((v) => v.trim())
    .join('  ·  ');
}

export async function applyFrame(blob: Blob, options: FrameOptions): Promise<Blob> {
  const { style, watermark } = options;
  if (style === 'none' && !watermark) return blob;

  const img = await loadImage(blob);
  const baseW = img.naturalWidth;
  const baseH = img.naturalHeight;

  // 各风格的边距比例（相对短边）
  const short = Math.min(baseW, baseH);
  const border =
    style === 'white' ? Math.round(short * 0.045)
    : style === 'leica' ? Math.round(short * 0.03)
    : style === 'film' ? Math.round(short * 0.035)
    : Math.round(short * 0.02);

  // 徕卡 / 胶片：底部再加一条信息条
  const barRatio = style === 'leica' ? 0.14 : style === 'film' ? 0.13 : 0.06;
  const bar = watermark || style === 'leica' || style === 'film' ? Math.round(baseH * barRatio) : 0;

  const canvas = document.createElement('canvas');
  canvas.width = baseW + border * 2;
  canvas.height = baseH + border * 2 + bar;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;

  const isDark = style === 'leica' || style === 'film';
  ctx.fillStyle = isDark ? '#0d0d0f' : '#fbfaf7';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 图片主体
  ctx.drawImage(img, border, border, baseW, baseH);

  if (bar > 0) {
    const barTop = border + baseH;
    const barH = bar + border;
    ctx.fillStyle = isDark ? '#0d0d0f' : '#ffffff';
    ctx.fillRect(0, barTop, canvas.width, barH);

    const pad = Math.round(border * 0.6 + barH * 0.12);
    const left = border;
    const centerY = barTop + barH / 2;

    if (style === 'leica') {
      // 红色小点（徕卡标）
      ctx.fillStyle = '#c8102e';
      ctx.beginPath();
      ctx.arc(left + pad * 0.6, centerY, Math.max(4, barH * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }

    const title = options.device?.trim() || '照片故事';
    const subtitle = [paramLine(options.params), tidyParam(options.params?.colorGrade, 'color')]
      .filter((v) => v && v.trim())
      .join('  ·  ');
    const author = options.author?.trim();

    const titleSize = Math.max(14, Math.round(barH * 0.26));
    const subSize = Math.max(11, Math.round(barH * 0.17));

    const textX = left + (style === 'leica' ? pad * 1.9 : pad);

    ctx.fillStyle = isDark ? '#f5f2ea' : '#1a1a1a';
    ctx.font = `600 ${titleSize}px "Songti SC","SimSun",serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(title, textX, centerY - (subtitle ? subSize * 0.55 : 0));

    if (subtitle) {
      ctx.fillStyle = isDark ? 'rgba(245,242,234,0.72)' : 'rgba(26,26,26,0.62)';
      ctx.font = `${subSize}px "Songti SC","SimSun",serif`;
      ctx.fillText(subtitle, textX, centerY + titleSize * 0.62);
    }

    if (author) {
      const size = Math.max(11, Math.round(barH * 0.17));
      ctx.fillStyle = isDark ? 'rgba(245,242,234,0.6)' : 'rgba(26,26,26,0.5)';
      ctx.font = `${size}px "Songti SC","SimSun",serif`;
      ctx.textAlign = 'right';
      ctx.fillText(author, canvas.width - border - pad * 0.4, centerY);
      ctx.textAlign = 'left';
    }
  } else if (watermark) {
    // 白边风格：右下角轻水印
    const size = Math.max(12, Math.round(short * 0.022));
    const text = [options.device, paramLine(options.params)].filter(Boolean).join('  ·  ');
    ctx.font = `${size}px "Songti SC","SimSun",serif`;
    const metrics = ctx.measureText(text);
    const pad = Math.round(border * 0.5);
    const x = canvas.width - metrics.width - pad;
    const y = canvas.height - size - pad;

    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    roundRect(ctx, x - size * 0.5, y - size * 0.8, metrics.width + size, size * 1.7, size * 0.35);
    ctx.fill();

    ctx.fillStyle = 'rgba(20,20,20,0.72)';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y - size * 0.05);
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('水印生成失败'))),
      'image/jpeg',
      0.92,
    );
  });
}
