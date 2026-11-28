// src/lib/export/__tests__/bands.test.ts
// 0.8.4：导出排版内核（行带规划）的单元测试。
// 这些都是纯函数，能在测试里精确复现「页底重复一段」「正文顶出纸外」这类事故。
import { describe, expect, it } from 'vitest';
import { groupBands, planPageBands, blockHasContent } from '@/lib/export/bands';
import type { LayoutItem, PageLayout } from '@/lib/export/layout';
import type { PhotoBlockId } from '@/lib/export/blocks';
import type { ExportSettings, Photo, PhotoAnalysis } from '@/types/domain';

const story = (text: string): PhotoAnalysis => ({
  title: '雨夜面馆',
  story: text,
  technique: { composition: '三分法', lighting: '暖光', color: '偏黄', lens: '35mm', post: '轻调' },
  tags: ['雨夜', '街边'],
  mood: '安静',
  alt: '夜里面馆的灯还亮着',
});

const photo = (analysis: PhotoAnalysis): Photo =>
  ({
    id: 'p1',
    projectId: 'proj',
    order: 0,
    fileName: 'a.jpg',
    mimeType: 'image/jpeg',
    fileSize: 1024,
    width: 4000,
    height: 2667,
    status: 'analyzed',
    selected: true,
    isEdited: false,
    createdAt: 0,
    updatedAt: 0,
    analysis,
  }) as unknown as Photo;

function settings(patch: Partial<ExportSettings> = {}): ExportSettings {
  return {
    includeCover: true,
    includeOverview: false,
    includeStory: true,
    includeTechnique: false,
    includeTags: false,
    includeMood: true,
    includeAlt: false,
    pageBreakPerPhoto: true,
    layout: 'loose',
    imageQuality: 'high',
    overviewColumns: 3,
    includeSkipped: false,
    showHeader: true,
    orientation: 'portrait',
    margins: 'normal',
    bodyColumns: 1,
    lineSpacing: 1.6,
    showIndex: true,
    paperSize: 'a4',
    gutter: 0,
    captionUnderImage: true,
    captionStyle: 'title',
    includeScoreDetail: false,
    frame: 'none',
    watermark: false,
    blocks: ['index', 'title', 'image', 'caption', 'story'],
    ...patch,
  } as ExportSettings;
}

const layoutOf = (items: LayoutItem[]): PageLayout => ({ cols: 12, rows: 24, items });

const item = (id: PhotoBlockId, col: number, row: number, colSpan = 12, rowSpan = 1): LayoutItem => ({
  id,
  col,
  row,
  colSpan,
  rowSpan,
});

const LONG = '雨是从傍晚六点开始下的，起初只是屋檐上零星的几点，后来整条街都被水汽泡得发亮。'.repeat(8);

describe('groupBands', () => {
  it('右栏竖着堆的块落在同一格里', () => {
    const bands = groupBands(
      [item('title', 0, 0), item('image', 0, 1, 6, 8), item('story', 6, 1, 6, 8)],
      24,
    );
    expect(bands.length).toBe(2);
    expect(bands[0][0].ids).toEqual(['title']);
    expect(bands[1].map((r) => r.ids)).toEqual([['image'], ['story']]);
  });

  it('横跨两条带的块只在开始的那条带里出现一次（页底重复整段正文的事故）', () => {
    // image 占 row1–9，story 占 row 4–12：切缝把 row4/row9 切开，
    // 老实现会在两条带里都吐出 story，页面上就印了两遍。
    const bands = groupBands(
      [item('image', 0, 1, 6, 8), item('story', 0, 4, 6, 8)],
      24,
    );
    const flat = bands.flatMap((band) => band.flatMap((range) => range.ids));
    expect(flat.filter((id) => id === 'story')).toHaveLength(1);
  });
});

describe('blockHasContent', () => {
  it('空字符串的块算没有内容', () => {
    const s = settings();
    const p = photo({ ...story(''), mood: '  ', alt: '', tags: [] });
    expect(blockHasContent('story', p, s)).toBe(false);
    expect(blockHasContent('mood', p, s)).toBe(false);
    expect(blockHasContent('title', p, s)).toBe(true);
  });
});

describe('planPageBands', () => {
  const ctx = (patch: Partial<ExportSettings> = {}, text = '雨下到七点，街上的人少了一半。') => ({
    photo: photo(story(text)),
    index: 0,
    settings: settings(patch),
    layout: layoutOf([item('title', 0, 0), item('image', 0, 1, 12, 10), item('story', 0, 11, 12, 4)]),
    contentCm: 17,
    contentHeightCm: 24,
    aspect: 4000 / 2667,
  });

  it('内容少的时候整页垂直居中，不会只有上面一小条', () => {
    const plan = planPageBands(ctx());
    expect(plan.totalCm).toBeLessThan(24);
    expect(plan.topPadCm).toBeGreaterThan(1);
    expect(plan.topPadCm).toBeLessThanOrEqual(20);
  });

  it('序号块永远不排（用户 0.8.4 明确不要张数编号）', () => {
    const plan = planPageBands({
      ...ctx(),
      layout: layoutOf([item('index', 0, 0), item('title', 0, 1), item('image', 0, 2, 12, 10)]),
    });
    const ids = plan.bands.flatMap((band) => band.items.map((i) => i.id));
    expect(ids).not.toContain('index');
  });

  it('标题已经印在图上时，图注不再重复印一遍', () => {
    const plan = planPageBands({
      ...ctx({ captionStyle: 'title' }),
      layout: layoutOf([
        item('title', 0, 0),
        item('image', 0, 1, 12, 10),
        item('caption', 0, 11),
      ]),
    });
    const ids = plan.bands.flatMap((band) => band.items.map((i) => i.id));
    expect(ids).toContain('title');
    expect(ids).not.toContain('caption');
  });

  it('塞了 600 字正文也收在一页之内（压字兜底，不许顶出纸外）', () => {
    const plan = planPageBands(ctx({ includeTechnique: true }, LONG));
    expect(plan.totalCm).toBeLessThanOrEqual(24.01);
  });

  it('图很大但版心装不下时，图被压下来而不是把后面的字挤走', () => {
    const plan = planPageBands({ ...ctx(), aspect: 1 });
    expect(plan.imageHeightCm).toBeGreaterThanOrEqual(6);
    expect(plan.totalCm).toBeLessThanOrEqual(24.01);
  });
});
