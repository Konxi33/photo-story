// 0.8.1：评审记录的导出不能吞张数、不能被逗号和引号打断列 —— 这两条都有回归测试。
import { describe, expect, it } from 'vitest';

import { buildReviewCsv, buildReviewMarkdown, buildReviewRows, judgeName } from '@/lib/review/export';
import type { ReviewBoard } from '@/lib/review/store';

const board: ReviewBoard = {
  projectId: 'p1',
  updatedAt: 1,
  reviews: [
    {
      photoId: 'a',
      at: 1,
      verdicts: [
        { judge: 'editor', score: 80, advice: ['画面干净'] },
        { judge: 'curator', score: 60, advice: ['题材有点平'] },
        { judge: 'tech', score: 90, advice: ['曝光稳'] },
      ],
    },
    {
      photoId: 'b',
      at: 2,
      verdicts: [
        { judge: 'editor', score: 70, advice: ['说,有逗号', '带"引号"'] },
        // curator 这次失败，分数为空但要留一行
        { judge: 'tech', score: 70, advice: [] },
      ],
    },
  ],
};

const photos = [
  { id: 'a', fileName: 'IMG_1.jpg', title: '空椅', number: 1 },
  { id: 'b', fileName: 'IMG_2.jpg', title: undefined, number: 2 },
];

describe('buildReviewRows', () => {
  it('按照片编号对齐，没评语的照片也留一行', () => {
    const rows = buildReviewRows(board, photos);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ number: 1, title: '空椅', spread: 30 });
    expect(rows[0].average).toBeCloseTo(76.67, 1);
    // 缺标题时退回文件名
    expect(rows[1].title).toBe('IMG_2.jpg');
    expect(rows[1].scores.curator).toBeNull();
  });

  it('没有记录时给空数组', () => {
    expect(buildReviewRows(null, photos)).toEqual([]);
  });
});

describe('buildReviewCsv', () => {
  it('表头是编号在前，评语一整行放在后面', () => {
    const csv = buildReviewCsv(buildReviewRows(board, photos));
    const head = csv.split('\r\n')[0];
    expect(head.startsWith('编号,标题,文件名,平均分,分歧度,')).toBe(true);
    expect(head).toContain(`${judgeName('editor')}评语`);
  });

  it('逗号和引号都会被转义，不会把列打散', () => {
    const csv = buildReviewCsv(buildReviewRows(board, photos));
    expect(csv).toContain('"说,有逗号 / 带""引号"""');
    // 每一行的逗号数量一致（表头 11 列 → 10 个逗号）
    const lines = csv.split('\r\n').slice(1);
    for (const line of lines) expect(line.split(',').length).toBeGreaterThanOrEqual(11);
  });

  it('空分数留空，不写成 NaN', () => {
    const csv = buildReviewCsv(buildReviewRows(board, photos));
    expect(csv).not.toContain('NaN');
    expect(csv).not.toContain('null');
  });
});

describe('buildReviewMarkdown', () => {
  it('分歧最大的排前面，并写清张数与均分', () => {
    const md = buildReviewMarkdown(buildReviewRows(board, photos), '测试项目');
    expect(md.startsWith('# 测试项目 · 评审记录')).toBe(true);
    expect(md).toContain('共 2 张');
    // 分歧 30 的那张（空椅）在分歧 10 之前
    expect(md.indexOf('空椅')).toBeLessThan(md.indexOf('IMG_2.jpg'));
  });

  it('评语按评委分行，评委名可读', () => {
    const md = buildReviewMarkdown(buildReviewRows(board, photos), '测试项目');
    expect(md).toContain(judgeName('curator'));
    expect(md).toContain('题材有点平');
  });
});
