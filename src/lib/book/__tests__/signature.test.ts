// 0.8.1：印张补页的规则必须和预览页序列一致，否则「预览 12 页、导出补错 3 页」。
import { describe, expect, it } from 'vitest';

import {
  CHAPTER_OPENER_MIN,
  SIGNATURE_MULTIPLE,
  countSignaturePages,
  padForBook,
  padToMultiple,
} from '@/lib/book/signature';

describe('countSignaturePages', () => {
  it('最小的一本：封面 + 总览 + 一张图 + 附录 = 4 页', () => {
    expect(
      countSignaturePages({
        chapters: [{ title: '未命名章节', note: '', photoCount: 1 }],
      }),
    ).toBe(4);
  });

  it('章节到 4 张才多一页章扉', () => {
    const base = (photoCount: number): number =>
      countSignaturePages({ chapters: [{ title: '第一章', note: '', photoCount }], hasCover: false });
    // 只有总览 + 图版 + 附录
    expect(base(CHAPTER_OPENER_MIN - 1)).toBe(1 + CHAPTER_OPENER_MIN - 1 + 1);
    expect(base(CHAPTER_OPENER_MIN)).toBe(1 + CHAPTER_OPENER_MIN + 1 + 1);
  });

  it('空章节只有在「没标题、有题记」时算一页呼吸页', () => {
    expect(countSignaturePages({ chapters: [{ title: '', note: '一句话', photoCount: 0 }], hasCover: false, hasOverview: false })).toBe(2);
    expect(countSignaturePages({ chapters: [{ title: '有标题', note: '一句话', photoCount: 0 }], hasCover: false, hasOverview: false })).toBe(1);
    expect(countSignaturePages({ chapters: [{ title: '', note: '', photoCount: 0 }], hasCover: false, hasOverview: false })).toBe(1);
  });

  it('可以关掉封面 / 总览 / 附录', () => {
    expect(
      countSignaturePages({
        chapters: [{ title: '第一章', note: '', photoCount: 2 }],
        hasCover: false,
        hasOverview: false,
        hasAppendix: false,
      }),
    ).toBe(2);
  });

  it('不分章时按平铺张数算，不加章扉', () => {
    expect(countSignaturePages({ chapters: [], flatPhotoCount: 5, hasCover: false })).toBe(1 + 5 + 1);
  });

  it('没有照片就是 0 页，不凭空补', () => {
    expect(countSignaturePages({ chapters: [], flatPhotoCount: 0, hasCover: false, hasOverview: false, hasAppendix: false })).toBe(0);
  });
});

describe('padToMultiple', () => {
  it('正好是倍数就补 0 页', () => {
    expect(padToMultiple(12)).toBe(0);
    expect(padToMultiple(4)).toBe(0);
  });

  it('差多少补多少，最多补到少一页', () => {
    expect(padToMultiple(13)).toBe(3);
    expect(padToMultiple(14)).toBe(2);
    expect(padToMultiple(15)).toBe(1);
    expect(padToMultiple(1)).toBe(3);
  });

  it('0 页不补（空项目不该出现 4 页空白）', () => {
    expect(padToMultiple(0)).toBe(0);
  });

  it('可以换粒度', () => {
    expect(padToMultiple(9, 8)).toBe(7);
    expect(SIGNATURE_MULTIPLE).toBe(4);
  });
});

describe('padForBook', () => {
  it('按章节里的照片数算，补到 4 的倍数', () => {
    // 封面 1 + 总览 1 + (章扉 1 + 图 4) + 附录 1 = 8 → 正好，补 0
    expect(
      padForBook([
        { title: '第一章', note: '', photoIds: ['a', 'b', 'c', 'd'] },
      ]),
    ).toBe(0);
    // 9 页 → 补 3
    expect(
      padForBook([
        { title: '第一章', note: '', photoIds: ['a', 'b', 'c', 'd'] },
        { title: '第二章', note: '', photoIds: ['e'] },
      ]),
    ).toBe(3);
  });

  it('没有章节时用平铺张数', () => {
    // 封面 1 + 总览 1 + 平铺 3 + 附录 1 = 6 → 补 2
    expect(padForBook([], { flatPhotoCount: 3 })).toBe(2);
  });
});
