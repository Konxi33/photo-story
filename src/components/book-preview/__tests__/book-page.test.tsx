// @vitest-environment node
// 0.8.0：翻页预览里「一张纸」的渲染，重点是呼吸页——以前预览里根本没有它
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { BookPage, type PageNode } from '@/components/book-preview/book-page';
import type { Photo } from '@/types/domain';

const photo = (title: string): Photo =>
  ({
    id: 'p1',
    projectId: 'proj',
    fileName: 'p1.jpg',
    analysis: { title, story: '车灯还亮着，路边还积着水。' },
  }) as unknown as Photo;

const render = (node: PageNode | undefined, number = 1): string =>
  renderToStaticMarkup(<BookPage node={node} number={number} />);

describe('BookPage', () => {
  it('呼吸页只放题记，不写章号', () => {
    const html = render({ kind: 'breath', note: '在两组照片之间留一页白。' }, 5);
    expect(html).toContain('在两组照片之间留一页白。');
    expect(html).not.toContain('章');
    // 页码从第 2 页开始显示（封面不印页码）
    expect(html).toContain('第 4 页');
  });

  it('补白页只有一行小字，页面上没有别的内容', () => {
    const html = render({ kind: 'blank' }, 13);
    expect(html).toContain('补白页');
    expect(html).toContain('第 12 页');
    // 不能把标题、图注这些板块漏画到补白页上
    expect(html).not.toContain('图 1');
    expect(html).not.toContain('<h2');
  });

  it('章扉有章号与题记', () => {    const html = render({ kind: 'chapter', index: 2, title: '雨停之前', note: '出门那天下着雨' }, 3);
    expect(html).toContain('第 02 章');
    expect(html).toContain('雨停之前');
    expect(html).toContain('出门那天下着雨');
  });

  it('图版页用「编号 · 标题」做图注', () => {
    const html = render({ kind: 'photo', index: 3, photo: photo('车灯还亮着') }, 6);
    expect(html).toContain('图 03');
    expect(html).toContain('车灯还亮着');
    expect(html).toContain('图 03 · 车灯还亮着');
  });

  it('没有分析结果时退回文件名', () => {
    const bare = { id: 'p2', projectId: 'proj', fileName: 'DSC01234.jpg' } as unknown as Photo;
    expect(render({ kind: 'photo', index: 1, photo: bare }, 2)).toContain('DSC01234.jpg');
  });

  it('技术附录按顺序列出标题与参数', () => {
    const html = render(
      {
        kind: 'appendix',
        rows: [
          { index: 1, title: '车灯还亮着', param: '35mm · f/2 · 1/60s' },
          { index: 2, title: '隔着两条车道', param: '—' },
        ],
      },
      9,
    );
    expect(html).toContain('技术附录');
    expect(html).toContain('车灯还亮着');
    expect(html).toContain('隔着两条车道');
    expect(html).toContain('35mm · f/2 · 1/60s');
  });

  it('跨页里空着的那半边画一张虚线纸，不印页码', () => {
    const html = render(undefined, 8);
    expect(html).toContain('border-dashed');
    expect(html).not.toContain('第 7 页');
  });

  it('封面印书名、副题与月份', () => {
    const html = render({ kind: 'cover', title: '把照片，写成一句话', subtitle: '照片故事 · 摄影集', date: '2025 年 7 月' }, 1);
    expect(html).toContain('把照片，写成一句话');
    expect(html).toContain('2025 年 7 月');
    // 封面不印页码
    expect(html).not.toContain('第 0 页');
  });
});
