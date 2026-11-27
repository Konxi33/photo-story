// src/lib/ai/__tests__/schema-title-dedupe.test.ts
// 0.8.0：同批标题去重真正接上了没有。
//
// 0.7.5 就写好了 polish.ts 里的 isNearDuplicate 与「换一个不重复的标题」逻辑，
// 但 parsePhotoAnalysis → normalizePhotoAnalysis → polishAnalysis 一路都没把 usedTitles 传进来，
// 那段逻辑等于空转。这里用真实响应形状的 JSON 走一遍 parse，钉住「传了就生效」。

import { describe, expect, it } from 'vitest';
import { normalizePhotoAnalysis, parsePhotoAnalysis } from '@/lib/ai/schema';
import type { PhotoAnalysis } from '@/types/domain';

function json(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    title: '空椅',
    story:
      '椅子腿压在砖缝上，左脚那块砖有点翘。桌上两只碗，一只已经空了。风把塑料布掀起来一角，压着它的还是那块石头，没换过位置。',
    technique: {
      composition: '左下角留白压住画面',
      lighting: '窗光只照亮半张桌',
      color: '低饱和，青灰为主',
      lens: '等效 35mm，略低机位',
      post: '压高光，保留砖面纹理',
    },
    params: {
      focalLength: '35mm',
      aperture: 'f/2.8',
      shutter: '1/125s',
      iso: 'ISO 200',
      colorGrade: '低饱和偏冷',
    },
    whyGood: ['两条椅腿形成斜线', '碗沿反光点出光源方向'],
    improve: ['机位再低 20cm'],
    imitate: ['等风停再按快门'],
    score: {
      overall: 80,
      breakdown: {
        composition: 82,
        lighting: 79,
        color: 80,
        subject: 78,
        timing: 81,
        technique: 80,
      },
    },
    scoreAdvice: ['让凳子腿别贴着画框'],
    tags: ['空椅', '砖缝', '窗光'],
    mood: '安静·清冷',
    alt: '两张塑料椅摆在砖地上，桌上两只碗',
    ...overrides,
  });
}

describe('同批标题去重', () => {
  it('没有传入已用标题时，标题原样保留', () => {
    const outcome = parsePhotoAnalysis(json());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.title).toBe('空椅');
  });

  it('传入已用标题后，完全重复的标题会被换掉', () => {
    const outcome = parsePhotoAnalysis(json(), { usedTitles: ['空椅'] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.title).not.toBe('空椅');
    expect(outcome.data.title.length).toBeGreaterThanOrEqual(2);
    expect(outcome.warnings.some((w) => w.includes('同批重名'))).toBe(true);
  });

  it('近义改写（一把空椅）也算重名', () => {
    const outcome = parsePhotoAnalysis(json({ title: '一把空椅' }), { usedTitles: ['空椅'] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.data.title).not.toContain('空椅');
  });

  it('normalizePhotoAnalysis 直传 usedTitles 同样生效', () => {
    const analysis: PhotoAnalysis = {
      title: '空椅',
      story: '椅子腿压在砖缝上，左脚那块砖有点翘。风把塑料布掀起来一角，压着它的还是那块石头。',
      technique: {
        composition: '左下角留白',
        lighting: '窗光半张桌',
        color: '青灰',
        lens: '35mm',
        post: '压高光',
      },
      tags: ['空椅'],
      mood: '安静',
      alt: '两张塑料椅摆在砖地上',
      whyGood: [],
      improve: [],
      imitate: [],
    };
    const result = normalizePhotoAnalysis(analysis, { usedTitles: ['空椅', '一把空椅'] });
    expect(result.data.title).not.toBe('空椅');
  });
});
