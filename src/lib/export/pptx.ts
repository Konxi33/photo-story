// src/lib/export/pptx.ts
'use client';

// 导出 PPT：封面一页 + 每张照片一页（图左文右）。
// pptxgenjs 的浏览器包放在 public/vendor，运行时按需加载，不打进 Next bundle。

import { AssetRepository } from '@/lib/db';
import { formatDate } from '@/lib/utils';
import type { ExportSettings, Photo, Project } from '@/types/domain';

import { paperTintOption } from './bookStyle';
import { applyFrame } from './frame';
import { encodeImageForDocx, type EncodedImage } from './image-encode';
import { saveDocument } from './output';

/**
 * 0.8.5：PPT 底色跟着「纸面底色」走。
 * 之前封面和每页都写死 'FBFAF7'，用户选米白导出还是白的（m07076）。
 */
function pptPaper(settings: ExportSettings | undefined): string {
  return paperTintOption(settings?.paper).bg.replace('#', '').toUpperCase();
}

/** pptxgenjs 浏览器包的运行期形态（只用到其中几个方法） */
interface PptxSlide {
  background?: { color: string };
  addText: (text: string, options: Record<string, unknown>) => void;
  addImage: (options: Record<string, unknown>) => void;
}

interface PptxInstance {
  layout: string;
  author: string;
  title: string;
  addSlide: () => PptxSlide;
  write: (options: { outputType: string }) => Promise<unknown>;
}

interface PptxConstructor {
  new (): PptxInstance;
}

declare global {
  interface Window {
    PptxGenJS?: PptxConstructor;
  }
}

const VENDOR_SRC = '/vendor/pptxgen.bundle.js';
let loading: Promise<PptxConstructor> | null = null;

function loadPptx(): Promise<PptxConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('仅支持浏览器环境'));
  if (window.PptxGenJS) return Promise.resolve(window.PptxGenJS);
  if (loading) return loading;

  loading = new Promise<PptxConstructor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = VENDOR_SRC;
    script.async = true;
    script.onload = () => {
      if (window.PptxGenJS) resolve(window.PptxGenJS);
      else reject(new Error('PPT 组件加载失败'));
    };
    script.onerror = () => reject(new Error('PPT 组件加载失败，请检查 public/vendor 是否完整'));
    document.head.appendChild(script);
  });

  return loading;
}

export interface ExportPptxParams {
  project: Project;
  photos: Photo[];
  imageEdge?: number;
  /** 相框与水印设置 */
  settings?: ExportSettings;
  onProgress?: (done: number, total: number) => void;
  /** 0.5.4：固定导出目录 */
  outputDir?: string;
}

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN = 0.55;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return btoa(binary);
}

function fitBox(
  image: { width: number; height: number },
  box: { w: number; h: number },
): { w: number; h: number } {
  const scale = Math.min(box.w / image.width, box.h / image.height);
  return { w: image.width * scale, h: image.height * scale };
}

export async function exportToPptx(
  params: ExportPptxParams,
): Promise<{ fileName: string; bytes: number; filePath?: string }> {
  const { project, photos, onProgress } = params;
  const edge = params.imageEdge ?? 1600;

  const Pptx = await loadPptx();
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = '照片故事';
  pptx.title = project.name;

  const cover = pptx.addSlide();
  cover.background = { color: pptPaper(params.settings) };
  cover.addText(project.name, {
    x: MARGIN,
    y: 2.4,
    w: SLIDE_W - MARGIN * 2,
    h: 1.2,
    fontSize: 40,
    bold: true,
    color: '1A1A1A',
    fontFace: '宋体',
  });
  cover.addText('照片故事', {
    x: MARGIN,
    y: 3.6,
    w: SLIDE_W - MARGIN * 2,
    h: 0.6,
    fontSize: 16,
    color: '6B6B6B',
    fontFace: '宋体',
  });
  // 0.8.4：日期跟「封面印日期」同一个开关走，关掉后只留张数。
  cover.addText(
    (params.settings?.showDate === false ? '' : formatDate(new Date()) + ' · ') + '共 ' + photos.length + ' 张',
    {
      x: MARGIN,
      y: 4.2,
      w: SLIDE_W - MARGIN * 2,
      h: 0.5,
      fontSize: 12,
      color: '8A8A8A',
      fontFace: '宋体',
    },
  );

  const frameSettings = params.settings;
  let done = 0;
  for (const photo of photos) {
    let encoded: EncodedImage | null = null;
    try {
      const asset = await AssetRepository.get(photo.id, 'doc');
      if (asset) {
        const framed =
          !frameSettings || (frameSettings.frame === 'none' && !frameSettings.watermark)
            ? asset.blob
            : await applyFrame(asset.blob, {
                style: frameSettings.frame ?? 'none',
                watermark: frameSettings.watermark,
                device: frameSettings.watermarkText,
                author: frameSettings.watermarkAuthor,
                params: photo.analysis?.params,
              });
        encoded = await encodeImageForDocx(
          framed,
          edge,
          framed === asset.blob ? photo.id : photo.id + ':frame',
        );
      }
    } catch {
      encoded = null;
    }

    const slide = pptx.addSlide();
    slide.background = { color: pptPaper(params.settings) };

    const imgBox = { x: MARGIN, y: MARGIN, w: 7.1, h: SLIDE_H - MARGIN * 2 };
    if (encoded) {
      const size = fitBox(encoded, { w: imgBox.w, h: imgBox.h });
      slide.addImage({
        data: 'image/jpeg;base64,' + bytesToBase64(encoded.data),
        x: imgBox.x + (imgBox.w - size.w) / 2,
        y: imgBox.y + (imgBox.h - size.h) / 2,
        w: size.w,
        h: size.h,
      });
    }

    const textX = imgBox.x + imgBox.w + 0.5;
    const textW = SLIDE_W - textX - MARGIN;
    const a = photo.status === 'success' ? photo.analysis : undefined;

    slide.addText(a?.title || photo.fileName, {
      x: textX,
      y: 0.8,
      w: textW,
      h: 1.0,
      fontSize: 26,
      bold: true,
      color: '1A1A1A',
      fontFace: '宋体',
    });

    slide.addText(a?.story || '（待补充）', {
      x: textX,
      y: 1.9,
      w: textW,
      h: 3.0,
      fontSize: 12,
      color: a?.story ? '3A3A3A' : '8A8A8A',
      fontFace: '宋体',
      valign: 'top',
      lineSpacingMultiple: 1.3,
    });

    if (a) {
      // 0.3.2：参数条 + 评分徽标
      const paramLine = a.params
        ? [a.params.focalLength, a.params.aperture, a.params.shutter, a.params.iso, a.params.colorGrade]
            .filter((v) => v && v.trim())
            .join('   ')
        : '';

      if (paramLine) {
        slide.addText(paramLine, {
          x: textX,
          y: 1.62,
          w: textW,
          h: 0.3,
          fontSize: 9,
          color: '8A8A8A',
          fontFace: '宋体',
        });
      }

      if (a.score) {
        slide.addText(a.score.overall.toFixed(1), {
          x: textX,
          y: 6.28,
          w: 0.95,
          h: 0.5,
          fontSize: 20,
          bold: true,
          color: '1A1A1A',
          fontFace: '宋体',
          valign: 'middle',
        });
        slide.addText(
          '/100   构图 ' +
            a.score.breakdown.composition.toFixed(1) +
            '   光线 ' +
            a.score.breakdown.lighting.toFixed(1) +
            '   调色 ' +
            a.score.breakdown.color.toFixed(1),
          {
            x: textX + 0.9,
            y: 6.28,
            w: textW - 0.9,
            h: 0.5,
            fontSize: 8.5,
            color: '6B6B6B',
            fontFace: '宋体',
            valign: 'middle',
          },
        );
      }

      const tech = [
        ['构图', a.technique.composition],
        ['光线', a.technique.lighting],
        ['色彩', a.technique.color],
        ['镜头', a.technique.lens],
        ['后期', a.technique.post],
      ]
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => k + ' · ' + v)
        .join('\n');

      if (tech) {
        slide.addText(tech, {
          x: textX,
          y: 4.9,
          w: textW,
          h: 2.0,
          fontSize: 9,
          color: '6B6B6B',
          fontFace: '宋体',
          valign: 'top',
          lineSpacingMultiple: 1.15,
        });
      }

      if (a.tags.length > 0) {
        slide.addText(a.tags.map((t) => '#' + t).join('  '), {
          x: textX,
          y: 6.95,
          w: textW,
          h: 0.35,
          fontSize: 9,
          color: '8A8A8A',
          fontFace: '宋体',
        });
      }
    }

    done += 1;
    onProgress?.(done, photos.length);
  }

  const fileName = '照片故事_' + Date.now() + '.pptx';
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  const saved = await saveDocument(blob, fileName, params.outputDir);

  return { fileName, bytes: blob.size, filePath: saved.filePath };
}
