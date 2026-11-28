// src/lib/ai/__tests__/title-doctor.test.ts
// 0.8.2 补丁：标题「句子感」判定、句式撞车换法、字数范围收口。
// 这一层是确定性的，所以能钉住——提示词的效果没法单测，但「交付给用户的这一行字」可以。
import { describe, expect, it } from 'vitest';

import { TITLE_RANGES, clampTitleRange } from '@/config/styles';
import { countTitleShapes, looksBland, looksLikeClause, refineTitle, shapeOf } from '@/lib/ai/title-doctor';
import { normalizePhotoAnalysis } from '@/lib/ai/schema';
import type { PhotoAnalysis } from '@/types/domain';

const analysis = (patch: Partial<PhotoAnalysis>): PhotoAnalysis => ({
  title: '盐',
  story: '桌上放着一袋盐，袋口没系。',
  mood: '安静',
  alt: '一袋开封的盐',
  tags: ['静物'],
  whyGood: [],
  improve: [],
  imitate: [],
  params: {
    focalLength: '35mm',
    aperture: 'f/2.8',
    shutter: '1/125s',
    iso: 'ISO 200',
    colorGrade: '偏冷',
  },
  technique: {
    composition: '居中',
    lighting: '侧目',
    color: '低饱和',
    lens: '35mm',
    post: '轻微压暗',
  },
  ...patch,
});

describe('句式判定', () => {
  it('认出赛事命名的几种句式', () => {
    expect(shapeOf('无题 No.04')).toBe('numbered');
    expect(shapeOf('青石桥，清晨五点')).toBe('place');
    expect(shapeOf('椅子与雨')).toBe('parallel');
    expect(shapeOf('盐')).toBe('single');
  });

  it('判出「散文半句」这类句子感标题', () => {
    expect(looksLikeClause('刚拧干的抹布')).toBe(true);
    expect(looksLikeClause('压着它的还是那块')).toBe(true);
    expect(looksLikeClause('它停在第三级台阶上')).toBe(true);
    expect(looksLikeClause('雨把牌子洗得发白')).toBe(true);
    expect(looksLikeClause('北岸，雨把牌子洗得发白')).toBe(true);
  });

  it('不误伤本来就成立的短标题与专名', () => {
    expect(looksLikeClause('盐')).toBe(false);
    expect(looksLikeClause('老张的船')).toBe(false);
    expect(looksLikeClause('无题 No.04')).toBe(false);
    expect(looksLikeClause('青石桥，清晨五点')).toBe(false);
  });

  it('统计一批标题的句式', () => {
    const counts = countTitleShapes(['盐', '灯', '无题 No.01', '椅子与雨']);
    expect(counts.single).toBe(2);
    expect(counts.numbered).toBe(1);
    expect(counts.parallel).toBe(1);
  });

  it('认出空的套话标题', () => {
    expect(looksBland('时光的痕迹')).toBe(true);
    expect(looksBland('光影之间')).toBe(true);
    expect(looksBland('岁月的温柔')).toBe(true);
    expect(looksBland('城市的呼吸')).toBe(true);
  });

  it('不把好标题当套话（这条最要紧，误判会把对的改坏）', () => {
    expect(looksBland('盐')).toBe(false);
    expect(looksBland('老张的船')).toBe(false);
    expect(looksBland('青石桥，清晨五点')).toBe(false);
    expect(looksBland('香豌豆—友谊')).toBe(false);
  });
});

describe('把句子换成命名法标题', () => {
  it('「单词」写法从正文里取出那件东西', () => {
    const out = refineTitle('刚拧干的抹布', {
      story: '桌上放着一袋盐，袋口没系。',
      style: 'concise',
      range: { min: 1, max: 8 },
    });
    expect(out.title).toBe('盐');
    expect(out.note).toContain('句子');
  });

  it('「地名与时刻」写法拼成「地点，时刻」', () => {
    const out = refineTitle('雨把牌子洗得发白', {
      story: '青石桥的桥头，清晨五点半，雾还没散。',
      style: 'plain',
      range: { min: 2, max: 10 },
    });
    expect(out.title).toBe('桥头，清晨');
  });

  it('凑不出构件时退到编号，编号永远成立', () => {
    const out = refineTitle('它在那里停了很久', {
      story: '一段没有可用名词的描述。',
      style: 'literary',
      range: { min: 2, max: 12 },
      index: 7,
    });
    expect(out.title).toBe('无题 No.07');
  });

  it('同一种句式用满三次就换一种', () => {
    const out = refineTitle('码头，凌晨', {
      story: '码头上立着一根铁皮杆，雨落在上面。',
      style: 'plain',
      range: { min: 2, max: 10 },
      existingTitles: ['北岸，十一月', '七楼，雨后', '青石桥，清晨五点'],
    });
    expect(out.title).not.toBe('码头，凌晨');
    expect(out.note).toContain('句式');
  });

  it('超长的标题按范围截短', () => {
    const out = refineTitle('道路中隐藏的秘密在很远的地方', {
      story: '一条路。',
      style: 'literary',
      range: { min: 2, max: 6 },
    });
    expect(out.title.length).toBeLessThanOrEqual(6);
  });

  it('正常的短标题原样放行，不要动它', () => {
    const out = refineTitle('盐', {
      story: '……',
      style: 'concise',
      range: { min: 1, max: 8 },
    });
    expect(out.title).toBe('盐');
    expect(out.note).toBeNull();
  });
});

describe('标题字数范围', () => {
  it('预设都是从短到长、min ≤ max', () => {
    for (const preset of TITLE_RANGES) {
      expect(preset.min).toBeGreaterThanOrEqual(1);
      expect(preset.max).toBeGreaterThanOrEqual(preset.min);
      expect(preset.max).toBeLessThanOrEqual(24);
    }
  });

  it('越界输入被收回合法区间', () => {
    expect(clampTitleRange({ min: 0, max: 30 })).toEqual({ min: 1, max: 24 });
    expect(clampTitleRange({ min: 8, max: 3 })).toEqual({ min: 8, max: 8 });
    expect(clampTitleRange(undefined)).toEqual({ min: 2, max: 8 });
    expect(clampTitleRange({ min: 2.6, max: 9.2 })).toEqual({ min: 3, max: 9 });
  });

  it('收尾流程遵守范围上限（真跑一次 normalizePhotoAnalysis）', () => {
    const result = normalizePhotoAnalysis(
      analysis({
        title: '这是一条非常安静的清晨街道照片',
        story: '青石桥的桥头，清晨五点半，雾还没散。',
      }),
      { titleRange: { min: 2, max: 6 }, titleStyle: 'plain' },
    );
    expect(result.data.title.length).toBeLessThanOrEqual(6);
  });
});
