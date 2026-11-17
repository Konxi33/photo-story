// src/lib/export/pdf.ts
'use client';

// 导出 PDF：先生成排版好的 HTML，交由 Electron 的 Chromium 打印成矢量 PDF。
// 非桌面环境（浏览器里跑 dev）时退化为打开打印窗口，用系统「另存为 PDF」。
//
// 0.5.4 打印改版：
// - 纸张跟设置走（A4 / A5）、支持横向、页边距与装订线由主进程传给 printToPDF，
//   不再把 @page 写死成 A4 + default margin（那样设置里的选项在 PDF 里全失效）；
// - 补上总览页与章节扉页，与 Word 版的成书结构一致；
// - 「评分卡与解读」开关同样生效，关掉后每页只有图 / 图注 / 正文 / 拍摄手法。

import { AssetRepository } from '@/lib/db';
import { formatCamera, formatExifLine } from '@/lib/image/exif';
import { formatDate } from '@/lib/utils';
import type { ExportSettings, Photo, Project, Technique } from '@/types/domain';

import { type PhotoBlockId, planPhotoPage, resolveBlocks } from './blocks';
import { applyFrame } from './frame';
import { encodeImageForDocx } from './image-encode';
import { tidyParam } from './params';

interface Candidate {
  photo: Photo;
  dataUrl: string | null;
}

/** 纸张尺寸（mm），键与 ExportSettings.paperSize 对齐 */
const PAPER_MM: Record<'a4' | 'a5', [number, number]> = {
  a4: [210, 297],
  a5: [148, 210],
};

const MARGIN_MM: Record<'narrow' | 'normal' | 'wide', number> = {
  narrow: 12,
  normal: 18,
  wide: 26,
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toDataUrl(bytes: Uint8Array, mime = 'image/jpeg'): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[],
    );
  }
  return 'data:' + mime + ';base64,' + btoa(binary);
}

const TECH_LABELS: { key: keyof Technique; label: string }[] = [
  { key: 'composition', label: '构图' },
  { key: 'lighting', label: '光线' },
  { key: 'color', label: '色彩' },
  { key: 'lens', label: '镜头' },
  { key: 'post', label: '后期' },
];

const pad2 = (n: number) => String(n).padStart(2, '0');

export interface ExportPdfParams {
  project: Project;
  photos: Photo[];
  settings: ExportSettings;
  /** 0.5.4：编排里的章节（有就按章节顺序排版并插扉页） */
  chapters?: { id: string; title: string; note: string; photoIds: string[] }[];
  onProgress?: (done: number, total: number) => void;
  /** 0.5.4：固定导出目录（给了就不弹保存框） */
  outputDir?: string;
}

interface Layout {
  paper: 'a4' | 'a5';
  landscape: boolean;
  marginMm: number;
  gutterMm: number;
  contentW: number;
  contentH: number;
}

function resolveLayout(settings: ExportSettings): Layout {
  const paper = settings.paperSize === 'a5' ? 'a5' : 'a4';
  const [w, h] = PAPER_MM[paper];
  const landscape = settings.orientation === 'landscape';
  const marginMm = MARGIN_MM[settings.margins] ?? MARGIN_MM.normal;
  const gutterMm = settings.gutter ?? 0;
  const pageW = landscape ? h : w;
  const pageH = landscape ? w : h;
  return {
    paper,
    landscape,
    marginMm,
    gutterMm,
    contentW: Math.max(60, pageW - marginMm * 2 - gutterMm),
    contentH: Math.max(90, pageH - marginMm * 2),
  };
}

/** 按章节重排照片；没有编排就按原顺序 */
function orderPhotos(
  photos: Photo[],
  chapters: ExportPdfParams['chapters'],
): { chapters: { title: string; note: string; photos: Photo[] }[]; rest: Photo[] } {
  if (!chapters || chapters.length === 0) return { chapters: [], rest: photos };
  const byId = new Map(photos.map((p) => [p.id, p]));
  const used = new Set<string>();
  const groups = chapters.map((chapter) => {
    const picked: Photo[] = [];
    for (const id of chapter.photoIds) {
      const photo = byId.get(id);
      if (!photo || used.has(id)) continue;
      used.add(id);
      picked.push(photo);
    }
    return { title: chapter.title, note: chapter.note, photos: picked };
  });
  return { chapters: groups, rest: photos.filter((p) => !used.has(p.id)) };
}

/** 构建整册 HTML（打印用） */
async function buildAlbumHtml(params: ExportPdfParams): Promise<string> {
  const { project, photos, settings, onProgress } = params;
  const edge =
    settings.imageQuality === 'ultra' ? 2000 : settings.imageQuality === 'high' ? 1500 : 1000;
  const layout = resolveLayout(settings);

  const encoded = new Map<string, string | null>();
  // 总览页单独用 400px 缩略图：直接复用大图会让整份 PDF 里每张照片被嵌两遍
  const thumbs = new Map<string, string | null>();
  let done = 0;
  for (const photo of photos) {
    let dataUrl: string | null = null;
    let thumbUrl: string | null = null;
    try {
      const asset = await AssetRepository.get(photo.id, 'doc');
      if (asset) {
        const framed =
          settings.frame === 'none' && !settings.watermark
            ? asset.blob
            : await applyFrame(asset.blob, {
                style: settings.frame ?? 'none',
                watermark: settings.watermark,
                device: settings.watermarkText,
                author: settings.watermarkAuthor,
                params: photo.analysis?.params,
              });
        const out = await encodeImageForDocx(
          framed,
          edge,
          framed === asset.blob ? photo.id : photo.id + ':frame',
        );
        dataUrl = toDataUrl(out.data);
        if (settings.includeOverview) {
          const small = await encodeImageForDocx(
            framed,
            400,
            (framed === asset.blob ? photo.id : photo.id + ':frame') + ':thumb',
            3 / 2,
          );
          thumbUrl = toDataUrl(small.data);
        }
      }
    } catch {
      dataUrl = null;
      thumbUrl = null;
    }
    encoded.set(photo.id, dataUrl);
    thumbs.set(photo.id, thumbUrl);
    done += 1;
    onProgress?.(done, photos.length);
  }

  const items = (list: Photo[]): Candidate[] =>
    list.map((photo) => ({ photo, dataUrl: encoded.get(photo.id) ?? null }));

  // 0.5.7：PDF 与 Word 共用同一套「板块」顺序（src/lib/export/blocks.ts）。
  // 用户把「点评」拖到图上面，PDF 里也得在图上面。
  const blocks = resolveBlocks(settings);

  const photoSection = ({ photo, dataUrl }: Candidate, index: number, noBreak = false): string => {
    const a = photo.status === 'success' ? photo.analysis : undefined;
    const parts: Partial<Record<PhotoBlockId, string>> = {};

    // 0.5.7：这一页的图片能占多高，交给和 Word 完全相同的预算函数算，
    // 这样「照片 + 它的全部文字」一定落在同一页里（.page 设了 break-inside: avoid）。
    const fit = planPhotoPage({
      photo,
      settings,
      contentCm: layout.contentW / 10,
      contentHeightCm: layout.contentH / 10,
      hasChapterHeading: noBreak,
    });
    const imageRoomMm = Math.max(66, Math.round(fit.imageRoomCm * 10));

    if (blocks.includes('index')) parts.index = `<p class="idx">${pad2(index)}</p>`;
    if (blocks.includes('title')) {
      parts.title = `<h2>${escapeHtml(a?.title || photo.fileName)}</h2><div class="rule"></div>`;
    }
    if (blocks.includes('image') && dataUrl) {
      parts.image = `<figure><img src="${dataUrl}" alt="${escapeHtml(a?.title || photo.fileName)}" style="max-height:${imageRoomMm}mm"></figure>`;
    }

    // 图注：与 Word 同一口径（编号 + 标题，参数进附录）
    const capStyle = settings.captionStyle ?? 'title';
    const paramLine = a?.params
      ? [
          tidyParam(a.params.shutter, 'shutter'),
          tidyParam(a.params.aperture, 'aperture'),
          tidyParam(a.params.iso, 'iso'),
          tidyParam(a.params.focalLength, 'focal'),
        ]
          .filter((v) => v)
          .map((v) => escapeHtml(v))
          .join(' · ')
      : '';
    const capTitle = escapeHtml((a?.title || '').trim());
    const capParts =
      capStyle === 'param'
        ? [paramLine]
        : capStyle === 'both'
          ? [capTitle, paramLine]
          : [capTitle || paramLine];
    const capText = capParts.filter((v) => v).join(' · ');
    if (blocks.includes('caption') && capText) {
      parts.caption = `<p class="cap">图 ${pad2(index)} · ${capText}</p>`;
    }

    if (blocks.includes('story') && a?.story) {
      parts.story = `<p class="story">${escapeHtml(a.story)}</p>`;
    }

    if (blocks.includes('technique') && a) {
      const tech = TECH_LABELS.filter(({ key }) => a.technique[key] && a.technique[key].trim())
        .map(
          ({ key, label }) =>
            `<div class="tech"><span>${label}</span><p>${escapeHtml(a.technique[key])}</p></div>`,
        )
        .join('');
      if (tech) parts.technique = `<div class="techs">${tech}</div>`;
    }

    if (blocks.includes('exif') && photo.exif) {
      const camera = formatCamera(photo.exif);
      const shot = formatExifLine(photo.exif);
      const stamp = photo.exif.takenAt
        ? new Date(photo.exif.takenAt).toLocaleString('zh-CN', { hour12: false })
        : '';
      const text = [camera, shot, stamp].filter(Boolean).join('　·　');
      if (text) parts.exif = `<p class="exif">${escapeHtml(text)}</p>`;
    }

    if (blocks.includes('params') && a?.params) {
      const chips = [
        ['焦段', a.params.focalLength],
        ['光圈', a.params.aperture],
        ['快门', a.params.shutter],
        ['ISO', a.params.iso],
        ['调色', a.params.colorGrade],
      ]
        .filter(([, v]) => v && v.trim())
        .map(([k, v]) => `<span class="chip"><b>${k}</b>${escapeHtml(v as string)}</span>`)
        .join('');
      if (chips) parts.params = `<div class="chips">${chips}</div>`;
    }

    if (blocks.includes('score') && a?.score) {
      parts.score = `<div class="module score">
             <div class="score-num">${a.score.overall.toFixed(1)}<small>/100</small></div>
             <div class="score-grid">
               ${(
                 [
                   ['构图', a.score.breakdown.composition],
                   ['光线', a.score.breakdown.lighting],
                   ['调色', a.score.breakdown.color],
                   ['主体', a.score.breakdown.subject],
                   ['时机', a.score.breakdown.timing],
                   ['技术', a.score.breakdown.technique],
                 ] as const
               )
                 .map(
                   ([k, v]) =>
                     `<div class="bar"><span>${k}</span><i><em style="width:${Math.min(100, v)}%"></em></i><u>${v.toFixed(1)}</u></div>`,
                 )
                 .join('')}
             </div>
           </div>`;
    }

    if (blocks.includes('advice') && a) {
      const advice = [
        ['为什么好看', a.whyGood],
        ['可以更好', a.improve],
        ['下次这样拍', a.imitate],
      ].filter(([, list]) => (list as string[]).length > 0);
      if (advice.length > 0) {
        parts.advice = `<div class="advice">${advice
          .map(
            ([label, list]) =>
              `<div class="card"><p class="card-title">${label}</p>${(list as string[])
                .map((item) => `<p class="card-line">· ${escapeHtml(item)}</p>`)
                .join('')}</div>`,
          )
          .join('')}</div>`;
      }
    }

    if (blocks.includes('category')) {
      const category = a?.tags?.[0]?.trim() || a?.mood?.trim() || '';
      if (category) parts.category = `<p class="category">类别：${escapeHtml(category)}</p>`;
    }

    if (blocks.includes('tags') && a && a.tags.length) {
      parts.tags = `<p class="tags">${a.tags.map((t) => '#' + escapeHtml(t)).join('&nbsp;&nbsp;')}</p>`;
    }

    if (blocks.includes('mood') && a?.mood) {
      parts.mood = `<p class="mood">氛围：${escapeHtml(a.mood)}</p>`;
    }

    if (blocks.includes('alt') && a?.alt) {
      parts.alt = `<p class="alt">无障碍：${escapeHtml(a.alt)}</p>`;
    }

    const rendered = blocks
      .map((id) => parts[id] ?? '')
      .filter(Boolean)
      .join('\n      ');

    return `
    <section class="page figure-page ${noBreak ? '' : 'break'}">
      ${rendered}
    </section>`;
  };

  const { chapters, rest } = orderPhotos(photos, params.chapters);

  // 章节扉页 + 每章的照片；章节外剩余照片接在最后（不丢片）
  let order = 0;
  const bodyParts: string[] = [];
  chapters.forEach((chapter, chapterIndex) => {
    if (chapter.photos.length === 0) return;
    // 与 Word 口径一致：≤3 张的小章节用「紧凑章头」压在同一页顶端，
    // 只有照片够多的章节才单独占一页扉页（否则短的书会被扉页切碎）。
    const single = chapter.photos.length <= 3;
    bodyParts.push(
      `<section class="page ${single ? 'chapter-inline' : 'chapter-break'}">
         <p class="chapter-no">第 ${pad2(chapterIndex + 1)} 章</p>
         <h3 class="chapter-name">${escapeHtml(chapter.title || '未命名章节')}</h3>
         ${chapter.note ? `<p class="chapter-note">${escapeHtml(chapter.note)}</p>` : ''}
         <div class="rule short"></div>
       </section>`,
    );
    chapter.photos.forEach((photo, photoIndex) => {
      order += 1;
      // 单张章节：章头已排在同一页顶端，照片别再另起一页
      bodyParts.push(
        photoSection({ photo, dataUrl: encoded.get(photo.id) ?? null }, order, single && photoIndex === 0),
      );
    });
  });
  rest.forEach((photo) => {
    order += 1;
    bodyParts.push(photoSection({ photo, dataUrl: encoded.get(photo.id) ?? null }, order));
  });

  // 总览页：3 或 4 列缩略图墙，一页之内按张数自动分列
  const overview = settings.includeOverview
    ? `<section class="page break">
         <h2 class="ov-title">总览</h2>
         <div class="rule"></div>
         <div class="ov-grid cols-${items(photos).length > 12 ? 4 : 3}">
           ${items(photos)
             .map(
               ({ photo }, index) => {
                 const small = thumbs.get(photo.id) ?? null;
                 return `
             <figure class="ov-cell">
               ${small ? `<img src="${small}" alt="">` : '<div class="ov-ph"></div>'}
               <figcaption>${pad2(index + 1)} · ${escapeHtml(photo.analysis?.title || photo.fileName)}</figcaption>
             </figure>`;
               },
             )
             .join('')}
         </div>
       </section>`
    : '';

  const cover = `
    <section class="page cover">
      <h1>${escapeHtml(project.name)}</h1>
      <div class="rule short"></div>
      <p class="sub">照片故事</p>
      <p class="meta">${formatDate(new Date())} · 共 ${photos.length} 张</p>
    </section>`;

  const figMaxH = Math.round(layout.contentH * 0.46);
  const coverMinH = Math.round(layout.contentH - 12);
  // 版面边距写进 @page：Chromium 里 CSS 的 @page margin 优先于打印设置，
  // 之前写 margin:0 会让自定义边距与装订线全部失效（正文直接顶到纸边）。
  const mSide = `${layout.marginMm}mm`;
  const mLeft = `${layout.marginMm + layout.gutterMm}mm`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(project.name)}</title>
<style>
  /* 页边距与纸张由 printToPDF 传入，这里只声明纸张大小，避免两套边距打架 */
  @page { size: ${layout.paper.toUpperCase()} ${layout.landscape ? 'landscape' : 'portrait'};
    margin: ${mSide} ${mSide} ${mSide} ${mLeft}; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body { color:#1a1a1a; background:#fff;
    font-family: "Source Han Serif SC","Songti SC","SimSun","宋体",serif;
    font-size: 11pt; line-height: 1.7; -webkit-print-color-adjust: exact; }
  .page { break-inside: auto; orphans: 2; widows: 2; }
  /* 0.5.7：一张照片和它的全部文字必须落在同一页，不许被拆成两页 */
  .page.figure-page { break-inside: avoid; }
  .page.break { break-before: page; }
  .cover { display:flex; flex-direction:column; align-items:center; justify-content:center;
    min-height: ${coverMinH}mm; text-align:center; }
  .cover h1 { font-size: 30pt; margin: 0; letter-spacing:.04em; }
  .sub { color:#6b6b6b; font-size:12pt; margin:10px 0 0; }
  .meta { color:#8a8a8a; font-size:10.5pt; margin-top:22px; }
  .rule { width:40mm; height:1px; background:#d8d4cc; margin:12px auto 18px; }
  .rule.short { width:34mm; margin:14px auto; }
  .idx { text-align:center; color:#8a8a8a; font-size:10pt; margin:0 0 4px; }
  h2 { text-align:center; font-size:18pt; margin:0; font-weight:600; letter-spacing:.02em; }
  figure { margin: 14px 0 10px; text-align:center; break-inside: avoid; }
  figure img { max-width:100%; max-height: ${figMaxH}mm; object-fit:contain; }
  /* 0.5.5：图注左对齐、离图约 5mm（原来居中且贴图，像说明书不像画册） */
  .cap { text-align:left; font-size:8.5pt; color:#8a8a8a; margin:1.8mm 0 5mm; line-height:1.45;
    font-variant-numeric: tabular-nums; }
  .story { font-size:11pt; line-height:1.85; text-align:justify; text-indent:2em; margin:0 0 12px; }
  .techs { margin: 4px 0 10px; }
  .tech { display:flex; gap:8px; font-size:10.5pt; line-height:1.6; margin-bottom:4px; break-inside: avoid; }
  .tech span { flex:0 0 3em; color:#6b6b6b; font-weight:600; }
  .tech p { margin:0; color:#3a3a3a; }
  .tags { text-align:center; font-size:10pt; color:#6b6b6b; margin:10px 0 0; }
  .exif { text-align:center; font-size:9pt; color:#6b6b6b; margin:8px 0 0;
    font-variant-numeric: tabular-nums; }
  .category { text-align:center; font-size:10pt; color:#6b6b6b; margin:10px 0 0; }
  .mood { text-align:center; font-size:10pt; color:#6b6b6b; margin:4px 0 0; }
  .alt { text-align:center; font-size:8.5pt; color:#8a8a8a; margin:4px 0 0; }

  .chapter-break { display:flex; flex-direction:column; align-items:center; justify-content:center;
    min-height: ${coverMinH}mm; text-align:center; break-before: page; }
  .chapter-inline { break-before: page; padding-top: 2mm; margin-bottom: 6mm; }
  .chapter-no { margin:0; font-size:10pt; letter-spacing:.32em; color:#8a8a8a; }
  .chapter-name { margin:10px 0 0; font-size:26pt; font-weight:600; letter-spacing:.04em; }
  .chapter-inline .chapter-name { font-size:17pt; }
  .chapter-note { margin:10px 0 0; font-size:11pt; color:#6b6b6b; }

  .ov-title { margin: 0; }
  .ov-grid { display:grid; gap: 4mm 4mm; margin-top: 4mm; }
  .ov-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .ov-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .ov-cell { margin:0; break-inside: avoid; }
  .ov-cell img, .ov-ph { width:100%; aspect-ratio: 3 / 2; object-fit: cover; background:#f2efe9; }
  .ov-cell figcaption { margin-top:2mm; font-size:8.5pt; color:#6b6b6b;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

  .chips { display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin:0 0 12px; }
  .chip { border:1px solid #e6e2d9; background:#faf8f4; border-radius:4px;
    padding:2px 7px; font-size:9pt; color:#3a3a3a; }
  .chip b { color:#8a8a8a; font-weight:400; margin-right:5px; }
  .module { border:1px solid #e6e2d9; background:#faf8f4; border-radius:6px;
    padding:8px 10px; margin:0 0 10px; break-inside: avoid; }
  .score { display:flex; align-items:center; gap:14px; }
  .score-num { font-size:24pt; font-weight:600; line-height:1; white-space:nowrap; }
  .score-num small { font-size:8pt; color:#8a8a8a; font-weight:400; margin-left:3px; }
  .score-grid { flex:1; display:grid; grid-template-columns:1fr 1fr; gap:3px 16px; }
  .bar { display:grid; grid-template-columns:2.6em 1fr 2.2em; align-items:center;
    gap:6px; font-size:8.5pt; color:#6b6b6b; }
  .bar i { display:block; height:3px; background:#e6e2d9; border-radius:2px; overflow:hidden; }
  .bar em { display:block; height:100%; background:#9a958a; }
  .bar u { text-decoration:none; text-align:right; color:#3a3a3a; font-variant-numeric: tabular-nums; }
  .advice { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin:0 0 10px; }
  .advice .card { border:1px solid #e6e2d9; background:#faf8f4; border-radius:6px; padding:7px 9px;
    break-inside: avoid; }
  .card-title { margin:0 0 4px; font-size:8.5pt; letter-spacing:.08em; color:#8a8a8a; }
  .card-line { margin:0 0 2px; font-size:9pt; line-height:1.5; color:#2a2a2a; }
</style></head><body>
${settings.includeCover ? cover : ''}
${overview}
${bodyParts.join('\n')}
</body></html>`;
}

export interface PdfResult {
  ok: boolean;
  filePath?: string;
  canceled?: boolean;
  fallback?: boolean;
  error?: string;
}

export async function exportToPdf(params: ExportPdfParams): Promise<PdfResult> {
  const html = await buildAlbumHtml(params);
  const defaultName = '照片故事_' + params.project.name + '.pdf';
  const api = typeof window !== 'undefined' ? window.photoStory : undefined;
  const layout = resolveLayout(params.settings);

  if (api?.exportPdf) {
    return api.exportPdf({
      html,
      defaultName,
      dir: (params.outputDir ?? '').trim() || undefined,
      pageSize: layout.paper === 'a5' ? 'A5' : 'A4',
      landscape: layout.landscape,
      // 主进程按英寸接收；装订线加到左边距
      marginMm: layout.marginMm,
      gutterMm: layout.gutterMm,
    });
  }

  // 浏览器环境：打开打印窗口，让系统另存为 PDF
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return { ok: false, error: '浏览器拦截了弹出窗口' };
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 600);
  return { ok: true, fallback: true };
}
