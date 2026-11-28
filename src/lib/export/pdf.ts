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
//
// 0.6.0 积木排版：
// - 有 `settings.grid`（用户在画布上摆过积木）时，照片页交给 pdf-grid.ts 用
//   position:absolute 按 12 列 × 24 行的网格画，位置就是用户摆的位置；
// - 没有 grid 的老项目继续走下面的竖排实现（板块顺序 + 段落流），版式不变。
//   两条路的规划都来自 src/lib/export/layout.ts 的 planLayoutPage，不会各算一套。

import { AssetRepository } from '@/lib/db';
import { padForBook } from '@/lib/book/signature';
import { formatCamera, formatExifLine } from '@/lib/image/exif';
import { formatDate } from '@/lib/utils';
import type { ExportSettings, Photo, Project, Technique } from '@/types/domain';

import { resolveBlocks } from './blocks';
import { applyFrame } from './frame';
import { encodeImageForDocx } from './image-encode';
import { tidyParam } from './params';
import { GRID_HEADING_RESERVE_CM, buildGridPhotoPage } from './pdf-grid';
import { exportContentCm, exportContentHeightCm, exportMarginCm } from './metrics';
import { HEAD_FONT_CSS, bodyFontOption, normalizeExportSettings, paperTintOption } from './bookStyle';
import { type PageEnv, designCss, renderChapterPage, renderFigurePage } from './pdf-design';
import { makeFont, measureLines, singleLineWidthMm, PT_TO_MM } from './text-measure';
import { pageStyle } from './typography';

interface Candidate {
  photo: Photo;
  dataUrl: string | null;
}

// 0.6.3：纸张尺寸、边距、版心宽高一律来自 metrics.ts 与 wordLayout.ts 的 WORD_PAPER，
// 这里不再维护第二套常量 —— 以前 PDF 用 12/18/26mm、Word 用 16/22/30mm，
// 同一份稿子在两个格式里版心宽度差 8mm，右侧内容自然顶出纸边。

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

/**
 * 单行文字适配：按真实字宽逐步砍字并补「…」，保证整行一定排得进给定宽度。
 * 总览页缩略图下面那行标题用 —— 以前靠 `white-space:nowrap + text-overflow:ellipsis`，
 * 英文长单词会被从中间切掉且看不出被切，现在改成先量再缩，省略号是唯一的截断痕迹。
 */
function fitOneLine(text: string, widthMm: number, familyCss: string, sizePt: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || widthMm <= 0) return clean;
  const font = makeFont(familyCss, sizePt, sizePt * 1.45);
  if (singleLineWidthMm(clean, font) <= widthMm) return clean;
  const chars = Array.from(clean);
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (singleLineWidthMm(chars.slice(0, mid).join('') + '…', font) <= widthMm) lo = mid;
    else hi = mid - 1;
  }
  return chars.slice(0, lo).join('') + '…';
}

/**
 * 紧凑章头（`.chapter-inline`）在版心里实际占掉的高度（cm）。
 *
 * 章头是下面这段 HTML 自己拼的，高度由 CSS 决定（padding-top 2mm / 10px 外边距 /
 * 10pt 章号 / 17pt 章名 / 34mm 短横线 / 6mm 下边距）。这里逐项照着算，章名和章注
 * 都按真实字宽折行 —— 估少了，同一页的网格页会被整体顶到下一页，前一页只印着章头
 * （用户看到的「白页」）；估多了，又多出一块莫名其妙的留白。
 */
function inlineHeadingHeightCm(title: string, note: string | undefined, contentWmm: number): number {
  const pxMm = 25.4 / 96; // CSS px → mm
  const lineMm = (pt: number): number => pt * 1.7 * PT_TO_MM;
  let h = 2; // .chapter-inline { padding-top: 2mm }
  h += lineMm(10); // .chapter-no 10pt / 1.7
  const nameLines = Math.max(1, measureLines(title, contentWmm, makeFont(HEAD_FONT_CSS, 17, 17 * 1.7, 600, 0.04)));
  h += 10 * pxMm + nameLines * lineMm(17); // .chapter-name { margin-top:10px; font-size:17pt }
  if (note) {
    const noteLines = Math.max(1, measureLines(note, contentWmm, makeFont(HEAD_FONT_CSS, 11, 11 * 1.7)));
    h += 10 * pxMm + noteLines * lineMm(11); // .chapter-note { margin-top:10px; font-size:11pt }
  }
  h += 28 * pxMm + pxMm; // .rule.short { height:1px; margin:14px auto }
  h += 6; // .chapter-inline { margin-bottom: 6mm }
  return h / 10 + 0.2; // 上面全按 mm 累加，转成 cm；0.2cm 安全余量：宁可让网格页矮一点，也不能被顶到下一页
}

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
  const landscape = settings.orientation === 'landscape';
  const marginMm = exportMarginCm(settings) * 10;
  /**
   * 0.6.3 修：以前这里用的是自己那套 12/18/26mm 边距、并把 settings.gutter（单位是 cm）
   * 当 mm 用，于是 PDF 的版心比 Word 宽 8mm，积木按 16.6cm 摆、页面按 17.4cm 画，
   * 右栏文字就顶到纸边甚至被裁。现在版心宽高**只来自 metrics.ts**，与 Word 完全同一套。
   */
  const gutterMm = (settings.gutter ?? 0) * 10;
  const contentW = exportContentCm(settings) * 10;
  const contentH = exportContentHeightCm(settings) * 10;
  return { paper, landscape, marginMm, gutterMm, contentW, contentH };
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

/** 构建整册 HTML（打印用）。0.6.0 起导出给打印/预览/自测脚本用。 */
export async function buildAlbumHtml(params: ExportPdfParams): Promise<string> {
  const { project, photos, onProgress } = params;
  // 0.6.3：相框已经把机型/参数烧进图片时不再重复印；字体与纸色统一从 bookStyle 取
  const settings = normalizeExportSettings(params.settings);
  const bodyFont = bodyFontOption(settings.bodyFont);
  const tint = paperTintOption(settings.paper);
  const edge =
    settings.imageQuality === 'ultra' ? 2000 : settings.imageQuality === 'high' ? 1500 : 1000;
  const layout = resolveLayout(settings);

  const encoded = new Map<string, { url: string; w: number; h: number } | null>();
  // 总览页单独用 400px 缩略图：直接复用大图会让整份 PDF 里每张照片被嵌两遍
  const thumbs = new Map<string, string | null>();
  let done = 0;
  for (const photo of photos) {
    let dataUrl: string | null = null;
    let dims: { w: number; h: number } | null = null;
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
        // 0.6.4：新版式按原始宽高比算图框，所以这里把像素尺寸一起带上
        dims = { w: out.width, h: out.height };
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
    encoded.set(photo.id, dataUrl ? { url: dataUrl, w: dims?.w ?? 3, h: dims?.h ?? 2 } : null);
    thumbs.set(photo.id, thumbUrl);
    done += 1;
    onProgress?.(done, photos.length);
  }

  const items = (list: Photo[]): Candidate[] =>
    list.map((photo) => ({ photo, dataUrl: encoded.get(photo.id)?.url ?? null }));

  // 0.5.7：PDF 与 Word 共用同一套「板块」顺序（src/lib/export/blocks.ts）。
  // 用户把「点评」拖到图上面，PDF 里也得在图上面。
  const blocks = resolveBlocks(settings);

  /**
   * 0.6.0：这一册是不是「积木版式」。判据与 Word 侧（document.ts）一致：
   * 只要 settings.grid 里真的摆了积木、且没有被 useGrid:false 关掉，就按画布绝对定位来画。
   */
  /**
   * 0.6.4：默认走新版式（按摄影书排的照片页）。
   * 只有「用户在排版台按过保存」（applyLayout 会写 useGrid:true）才走积木绝对定位。
   * 0.6.0–0.6.3 的判据是「有 grid 就走积木」，于是老项目里测试留下的 grid
   * 把每一页都顶成了绝对定位，新版式根本轮不到 —— 用户看到的就是那个散乱的版面。
   */
  const hasGridItems = Boolean(settings.grid && Array.isArray(settings.grid.items) && settings.grid.items.length > 0);
  const useGrid = hasGridItems && settings.useCanvas === true;

  // 0.6.4：整本书共用的排版环境（字号层级/纸色/字体/版心），所有照片页都从这里取
  const baseStyle = pageStyle(settings.pageStyle);
  const style =
    settings.photoRadius != null && Number.isFinite(settings.photoRadius)
      ? { ...baseStyle, photo: { ...baseStyle.photo, radiusMm: settings.photoRadius } }
      : baseStyle;
  const env: PageEnv = {
    style,
    tint,
    contentW: layout.contentW,
    contentH: layout.contentH,
    serifCss: bodyFont.css,
    sansCss: HEAD_FONT_CSS,
  };
  /** 书籍内连续页码：只数正文页（封面不编号） */
  let folioSeq = 0;

  const photoSection = (
    { photo, dataUrl }: Candidate,
    index: number,
    noBreak = false,
    headingReserveCm = GRID_HEADING_RESERVE_CM,
    chapter?: { no: number; title: string; note?: string },
  ): string => {
    // 积木版：几何、字号、截断全由 planLayoutPage 决定，这里只负责把格子画出来。
    if (useGrid) {
      return buildGridPhotoPage({
        photo,
        index,
        dataUrl,
        settings,
        contentCm: layout.contentW / 10,
        contentHeightCm: layout.contentH / 10,
        reservedCm: noBreak ? headingReserveCm : 0,
        breakBefore: !noBreak,
      });
    }

    // 0.6.4 新版式：一页一张、左边线统一、页码在页脚，装不下的整块让位（绝不切字）。
    const a = photo.status === 'success' ? photo.analysis : undefined;
    const dims = encoded.get(photo.id);
    folioSeq += 1;

    const paramLine = a?.params
      ? [
          tidyParam(a.params.shutter, 'shutter'),
          tidyParam(a.params.aperture, 'aperture'),
          tidyParam(a.params.iso, 'iso'),
          tidyParam(a.params.focalLength, 'focal'),
        ]
          .filter((v) => v)
          // 分隔点用不换行空格黏在前一项上：否则窄图注会把「·」甩到下一行行首
          .join('\u00a0·　')
      : '';
    const exifLine = photo.exif
      ? [formatCamera(photo.exif), formatExifLine(photo.exif)].filter(Boolean).join('\u00a0·　')
      : '';
    const capStyle = settings.captionStyle ?? 'title';
    // 图注里那一行参数：按用户的图注口径给，没参数就退回 EXIF（相框已烧参数时这里已为空）
    const specLine =
      capStyle === 'title' ? undefined : paramLine || exifLine || undefined;

    const technique =
      blocks.includes('technique') && a
        ? TECH_LABELS.filter(({ key }) => a.technique[key] && a.technique[key].trim()).map(
            ({ key, label }) => ({ label, text: (a.technique[key] ?? '').trim() }),
          )
        : [];

    const score = blocks.includes('score') && a?.score
      ? {
          overall: a.score.overall,
          parts: [
            ['构图', a.score.breakdown.composition],
            ['光线', a.score.breakdown.lighting],
            ['调色', a.score.breakdown.color],
            ['主体', a.score.breakdown.subject],
            ['时机', a.score.breakdown.timing],
            ['技术', a.score.breakdown.technique],
          ] as [string, number][],
        }
      : undefined;

    return renderFigurePage({
      env,
      pageNo: folioSeq,
      index,
      chapter,
      url: dataUrl,
      imgW: dims?.w ?? 3,
      imgH: dims?.h ?? 2,
      title: (a?.title || photo.fileName || '').trim(),
      story: blocks.includes('story') ? a?.story : undefined,
      specLine,
      technique,
      score,
      tags: blocks.includes('tags') ? a?.tags : undefined,
      mood: blocks.includes('mood') ? a?.mood : undefined,
    });
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
    const chapterInfo = {
      no: chapterIndex + 1,
      title: (chapter.title || '未命名章节').trim(),
      note: chapter.note?.trim() || undefined,
    };
    if (useGrid) {
      bodyParts.push(
        `<section class="page ${single ? 'chapter-inline' : 'chapter-break'}">
         <p class="chapter-no">第 ${pad2(chapterIndex + 1)} 章</p>
         <h3 class="chapter-name">${escapeHtml(chapterInfo.title)}</h3>
         ${chapterInfo.note ? `<p class="chapter-note">${escapeHtml(chapterInfo.note)}</p>` : ''}
         <div class="rule short"></div>
       </section>`,
      );
    } else if (!single) {
      // 0.6.4：章扉单独一页（左对齐、上半页留白、不编页码），照片页再从新的一页开始
      bodyParts.push(renderChapterPage(env, chapterInfo));
    }
    chapter.photos.forEach((photo, photoIndex) => {
      order += 1;
      // 单张章节：章头已排在同一页顶端，照片别再另起一页。
      // 积木版还得把章头占的高度让出来；章注可能换行，按实测文字高度累加
      // （让得不够，整页会被推到下一页，前一面只印着章头 —— 白页）。
      const shareHeading = single && photoIndex === 0;
      const headingReserveCm = inlineHeadingHeightCm(chapterInfo.title, chapterInfo.note, layout.contentW);
      bodyParts.push(
        photoSection(
          items([photo])[0],
          order,
          shareHeading,
          headingReserveCm,
          shareHeading ? chapterInfo : undefined,
        ),
      );
    });
  });
  rest.forEach((photo) => {
    order += 1;
    bodyParts.push(photoSection(items([photo])[0], order));
  });

  // 0.6.3：卷首语与后记。翻开封面的第一段文字决定了读者还看不看下去，
  // 所以只放一个标签、一行标题、一段话，其余全留白。
  const prosePage = (label: string, title: string, body: string): string => {
    const paras = body
      .replace(/\r\n/g, '\n')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `<p>${escapeHtml(line)}</p>`)
      .join('');
    return `<section class="page prose">
      <p class="p-label">${escapeHtml(label)}</p>
      <h2>${escapeHtml(title)}</h2>
      <div class="p-rule"></div>
      ${paras}
    </section>`;
  };

  if (settings.preface && settings.preface.trim()) {
    bodyParts.unshift(prosePage('写在前面', settings.prefaceTitle?.trim() || '写在前面', settings.preface));
  }
  if (settings.afterword && settings.afterword.trim()) {
    bodyParts.push(prosePage('后记', '后记', settings.afterword));
  }

  // 总览页：3 或 4 列缩略图墙，一页之内按张数自动分列
  const ovCols = items(photos).length > 12 ? 4 : 3;
  // 缩略图下面的标题按真实字宽先量再缩（列宽 = (版心 - 列间距) / 列数）
  const ovCellW = (layout.contentW - (ovCols - 1) * 4) / ovCols;
  const ovTitleW = Math.max(10, ovCellW - 3.2);
  const overview = settings.includeOverview
    ? `<section class="page break ov">
         <div class="ov-head">
           <span class="ov-kicker">CONTENTS</span>
           <h2 class="ov-title">总览</h2>
           <span class="ov-count">${items(photos).length} 张</span>
         </div>
         <div class="ov-grid cols-${ovCols}">
           ${items(photos)
             .map(
               ({ photo }, index) => {
                 const small = thumbs.get(photo.id) ?? null;
                 const ovTitle = fitOneLine(photo.analysis?.title || photo.fileName, ovTitleW, bodyFont.css, 8.5);
                 return `
             <figure class="ov-cell">
               ${small ? `<img src="${small}" alt="">` : '<div class="ov-ph"></div>'}
               <figcaption>${settings.showIndex === false ? '' : `<b>${pad2(index + 1)}</b>`}${escapeHtml(ovTitle)}</figcaption>
             </figure>`;
               },
             )
             .join('')}
         </div>
       </section>`
    : '';

  // 0.8.1：印张补页 —— 末尾补 1–3 页空白，把页数凑成 4 的倍数。
  // PDF 没有技术附录（附录只在 Word 里印），所以 hasAppendix 传 false；
  // 页数按预览那套规则估，PDF 里小章节会和图压在同页，估计值最多差一页，不影响装订。
  const padCount = settings.padSignature
    ? padForBook(params.chapters ?? [], {
        flatPhotoCount: photos.length,
        hasCover: settings.includeCover === true,
        hasOverview: settings.includeOverview !== false,
        hasAppendix: false,
      })
    : 0;
  const padPages = Array.from(
    { length: padCount },
    () => '<section class="page blank" style="break-before:page;min-height:1mm"></section>',
  ).join('\n');

  // 0.6.4：封面改成「一张照片 + 下方标题块」的画册排法。
  // 原来只有三行居中文字，白纸上孤零零一行字，打开就像草稿。
  const coverPhoto = photos.find((p) => p.id === project.coverPhotoId) ?? photos[0];
  const coverImg = coverPhoto ? encoded.get(coverPhoto.id) : null;
  const cover = `
    <section class="page cover">
      ${
        coverImg
          ? `<div class="cover-photo"><img src="${coverImg.url}" alt="${escapeHtml(project.name)}"></div>`
          : ''
      }
      <div class="cover-block">
        <p class="cover-kicker">PHOTO&nbsp;STORY</p>
        <h1>${escapeHtml(project.name)}</h1>
        <div class="rule short left"></div>
        <p class="sub">照片故事</p>
        ${settings.showDate === false ? '' : `<p class="meta">${formatDate(new Date())}　·　共 ${photos.length} 张</p>`}
      </div>
    </section>`;

  const figMaxH = Math.round(layout.contentH * 0.46);
  const coverMinH = Math.round(layout.contentH - 12);
  // 封面照片高度必须跟着版心走：写死 148mm 在 A5 上（版心 178mm）会和下面的标题块
  // 一起超过一页，封面被拆成「照片一页 + 标题一页」（A5 + 装订线的用例实测 3 页）。
  // 留 96mm 给标题块（27pt 书名 + 副题 + 日期 + 页边距，实测约 60mm，余量给长书名折行）。
  const coverPhotoH = Math.max(60, Math.min(148, Math.round(layout.contentH - 96)));
  // 0.8.3：整张纸的尺寸。以前只把纸色刷在「版心」里，四周页边距是打印机的白纸，
  // 于是选了米白/夜色也只看到中间一块色 —— 用户说「我选米白色背景但背景还是白色」。
  // 现在 @page 的边距交给每页自己的 padding，页面盒子铺满整张纸，纸色才能铺满。
  const paperW = Math.round((layout.contentW + layout.marginMm * 2 + layout.gutterMm) * 10) / 10;
  const paperH = Math.round((layout.contentH + layout.marginMm * 2) * 10) / 10;
  const mSide = `${layout.marginMm}mm`;
  const mLeft = `${layout.marginMm + layout.gutterMm}mm`;

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${escapeHtml(project.name)}</title>
<style>
  /* 0.6.3：纸色与墨色集中成变量，正文/图注/分隔线全部跟着走。
     以前颜色是散落在十几条规则里的字面值，改一处忘一处，几种灰混在一起看着就脏。 */
  :root {
    --paper: ${tint.bg};
    --ink: ${tint.ink};
    --ink-soft: ${tint.inkSoft};
    --line: ${tint.line};
    /* 0.8.3：纸张几何也做成变量，页面盒子与版心共用同一套数字，不会两处写错 */
    --paper-w: ${paperW}mm;
    --paper-h: ${paperH}mm;
    --m-top: ${mSide};
    --m-right: ${mSide};
    --m-bottom: ${mSide};
    --m-left: ${mLeft};
  }
  /* 0.8.3：@page 零边距、整页由 .page/.pg 自己撑满并加内边距。
     这样纸色（含夜色）可以铺到纸边，装订线也仍然只加在左侧。 */
  @page { size: ${layout.paper.toUpperCase()} ${layout.landscape ? 'landscape' : 'portrait'};
    margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; background: var(--paper); }
  body { color: var(--ink); background: var(--paper);
    font-family: ${bodyFont.css};
    font-size: 11pt; line-height: 1.7; -webkit-print-color-adjust: exact; }
  /* 每一页 = 一张纸：铺满整张纸、内缩页边距、纸色打底 */
  .page { width: var(--paper-w); height: var(--paper-h);
    padding: var(--m-top) var(--m-right) var(--m-bottom) var(--m-left);
    background: var(--paper); break-inside: auto; orphans: 2; widows: 2; }
  /* 0.5.7：一张照片和它的全部文字必须落在同一页，不许被拆成两页 */
  .page.figure-page { break-inside: avoid; }
  /* 总览与卷首语可能超过一页（照片多、文字长），这两类允许自然长高，
     其余页面固定一页高，纸色才能铺满、翻页位置也稳定。 */
  .page.ov, .page.prose { height: auto; min-height: var(--paper-h); }
  .page.break { break-before: page; }
  .page.blank { break-before: page; }
  .cover { display:flex; flex-direction:column; justify-content:flex-start;
    text-align:left; }
  .cover-photo { width:100%; height:${coverPhotoH}mm; overflow:hidden; margin:0 0 14mm; }
  .cover-photo img { width:100%; height:100%; object-fit:cover; display:block; }
  .cover-block { display:block; }
  .cover-kicker { margin:0 0 6mm; font-size:7.5pt; letter-spacing:.32em; color:var(--ink-soft);
    font-variant-numeric: tabular-nums; }
  .cover h1 { font-size: 27pt; margin: 0; letter-spacing:.02em; line-height:1.25; font-weight:600; }
  .sub { color:#6b6b6b; font-size:12pt; margin:10px 0 0; }
  .meta { color:#8a8a8a; font-size:10.5pt; margin-top:22px; }
  .rule { width:40mm; height:1px; background:#d8d4cc; margin:12px auto 18px; }
  .rule.short { width:34mm; margin:14px auto; }
  .rule.left { margin:9mm 0 6mm; }
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
  /* flow-root：章头最后那条 .rule 的 14px 下外边距不许塌出容器，
     否则 DOM 里量到的高度比 inlineHeadingHeightCm 算出来的少 7mm 左右，
     网格页就会多留一块白、或者反过来被顶到下一页。 */
  .chapter-inline { break-before: page; padding-top: 2mm; margin-bottom: 6mm; display: flow-root; }
  .chapter-no { margin:0; font-size:10pt; letter-spacing:.32em; color:#8a8a8a; }
  .chapter-name { margin:10px 0 0; font-size:26pt; font-weight:600; letter-spacing:.04em; }
  .chapter-inline .chapter-name { font-size:17pt; }
  .chapter-note { margin:10px 0 0; font-size:11pt; color:#6b6b6b; }

  /* 0.6.4：总览页改成「左对齐一行标头 + 左对齐图注」，跟正文页同一条左边线 */
  .ov-head { display:flex; align-items:baseline; gap:4mm; margin:0 0 6mm;
    padding-bottom:3mm; border-bottom:0.3pt solid var(--line); }
  .ov-kicker { font-size:7.5pt; letter-spacing:.32em; color:var(--ink-soft); font-variant-numeric:tabular-nums; }
  .ov-title { margin: 0; font-size:16pt; text-align:left; letter-spacing:.02em; }
  .ov-count { margin-left:auto; font-size:8pt; color:var(--ink-soft); }
  .ov-grid { display:grid; gap: 5mm 4mm; margin-top: 0; align-items:start; }
  .ov-grid.cols-3 { grid-template-columns: repeat(3, 1fr); }
  .ov-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .ov-cell { margin:0; break-inside: avoid; }
  .ov-cell img, .ov-ph { width:100%; aspect-ratio: 3 / 2; object-fit: cover; background:#f2efe9; display:block; }
  .ov-cell figcaption { margin-top:1.8mm; font-size:8.5pt; color:var(--ink-soft); text-align:left;
    overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .ov-cell figcaption b { font-weight:400; color:var(--ink); margin-right:2mm; }

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

  /* 0.6.0 积木排版：一页 = 一张 12 列 × 24 行的画布，每个积木绝对定位在格子上。
     0.8.3：外层 .gpage-sheet 是一张纸（纸色铺满 + 页边距），内层 .gpage 保持版心坐标，
     所以坐标不用跟着页边距改一行；break 由外层 .page 负责。 */
  .gpage-sheet { overflow: hidden; }
  .gpage { position: relative; overflow: hidden; break-inside: avoid; }
  .gpage:last-child { break-after: auto; }
  .gitem { position:absolute; overflow:hidden; }
  .gitem-text { padding:0.4mm 0.6mm; }
  .gitem figure { margin:0; height:100%; display:flex; align-items:center; justify-content:center; }
  .gitem figure img { max-width:100%; max-height:100%; object-fit:contain; }
  /* 0.8.3：圆角在积木路径也生效（以前只有竖排版照片页有），封面/总览不跟它走 */
  .gpage figure img, .gpage .gph { border-radius: var(--photo-radius, 0); }
  .gph { width:100%; height:100%; background: var(--line); }
  /* 积木里的字号以格子规划出的 fontPt 为基准（内联在 .gitem 上），子元素一律按 em 缩放。
     下面每个块的行高都必须和 pdf-grid.ts 里的测量口径一一对应（1.25/1.45/1.65…），
     否则「量出来 5 行、画出来 6 行」，最后一行又会被 overflow:hidden 切掉。 */
  .gitem .idx { margin:0; text-align:left; font-size:1em; line-height:1.3; font-variant-numeric:tabular-nums; }
  .gitem h2 { margin:0; text-align:left; font-size:1.45em; line-height:1.25; letter-spacing:.02em;
    overflow-wrap:anywhere; }
  .gitem .rule { display:none; }
  /* 图注：小一号 + 灰字 + 行首破折线，和正文分层次（不要和正文糊在一起） */
  .gitem .cap { margin:0; text-align:left; font-size:1em; line-height:1.45; color:var(--ink-soft);
    overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .gitem .story { margin:0; font-size:1em; line-height:1.65; text-indent:2em; text-align:justify;
    text-justify:inter-ideograph; word-break:normal; overflow-wrap:anywhere;
    font-variant-numeric:tabular-nums; }
  /* 拍摄手法：整行由代码按真实行高排好，这里不再用 max-height 兜底（那就是「切字」元凶） */
  .gitem .techs { margin:0; }
  .gitem .tech { font-size:1em; line-height:1.5; margin-bottom:0.5mm; gap:1.5mm; }
  .gitem .tech span { flex:0 0 2.6em; }
  .gitem .exif, .gitem .category, .gitem .mood, .gitem .alt, .gitem .tags {
    margin:0; text-align:left; font-size:1em; line-height:1.5;
    overflow-wrap:anywhere; font-variant-numeric:tabular-nums; }
  .gitem .tags { line-height:1.6; }
  .gitem .chips { margin:0; justify-content:flex-start; align-content:flex-start; gap:1.2mm; }
  /* 胶囊宽度参与折行计算，所以一律不换行（宽度按单行实测） */
  .gitem .chip { font-size:1em; padding:0.3mm 1.2mm; line-height:1.35; white-space:nowrap; }
  .gitem .module { margin:0; padding:1.2mm 1.6mm; }
  .gitem .score { gap:2.5mm; }
  .gitem .score.compact { display:block; }
  .gitem .score-num { font-size:2.2em; }
  .gitem .score-num small { font-size:0.45em; }
  .gitem .score-grid { gap:0.4mm 3mm; }
  .gitem .bar { font-size:0.85em; line-height:1.3; }
  .gscore-line { margin:0.4mm 0 0; font-size:0.9em; line-height:1.45; color:#6b6b6b;
    font-variant-numeric:tabular-nums; }
  .gitem .advice { margin:0; gap:1.2mm; align-content:start;
    grid-template-columns:repeat(auto-fit, minmax(4.2cm, 1fr)); }
  .gitem .advice .card { padding:1mm 1.4mm; }
  .gitem .card-title { font-size:0.85em; margin:0 0 0.5mm; line-height:1.35; }
  .gitem .card-line { font-size:1em; line-height:1.5; margin:0; overflow-wrap:anywhere; }

  /* 0.6.3 排版统一：标题一律无衬线，正文用用户选的字体；
     次要信息统一 --ink-soft，分隔线统一 --line。 */
  h1, h2, h3, .chapter-name, .ov-title, .cover h1, .score-num, .ghead .gtitle {
    font-family: ${HEAD_FONT_CSS}; font-weight: 600; letter-spacing: .01em;
  }
  .sub, .meta, .idx, .cap, .exif, .alt, .chapter-no, .chapter-note, .tags, .category, .mood,
  .gscore-line, .tech span, .ov-cell figcaption, .gcap { color: var(--ink-soft); }
  .rule, .ov-title + .rule { background: var(--line); }
  .ov-ph { background: var(--line); }
  .story, .gitem .story { font-family: ${bodyFont.css}; }
  .idx, .cap, .exif, .score-num, .chapter-no, .gcap, .gscore-num { font-variant-numeric: tabular-nums; }

  /* 卷首语 / 后记：只有字的一页 */
  .prose { break-before: page; }  .prose .p-label { margin: 0; font-size: 9.5pt; letter-spacing: .28em; color: var(--ink-soft); }
  .prose h2 { margin: 8mm 0 4mm; font-size: 20pt; text-align: left; }
  .prose .p-rule { width: 26mm; height: 1px; background: var(--line); margin: 0 0 6mm; }
  .prose p { margin: 0 0 4mm; text-indent: 2em; text-align: justify; font-size: 11pt; line-height: 1.9; }
  ${designCss(env)}
</style></head><body>
${settings.includeCover ? cover : ''}
${overview}
${bodyParts.join('\n')}
${padPages}
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
