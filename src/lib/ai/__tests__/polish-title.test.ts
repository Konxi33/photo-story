// src/lib/ai/__tests__/polish-title.test.ts
// 0.8.0：标题收尾的两条修复。
//
// 1) 「空椅」这种两字标题本来就成立，不该被「从正文捞物名」的兜底换成半截从句
//    （实测会把「压着它的还是那块石头」截成「压着它的还是那块」交出去）。
// 2) 从正文捞标题时必须过成句体检：代词、连接词、「的/了/着/是」收尾一律不要。

import { describe, expect, it } from 'vitest';
import { deriveSceneTitle, isPropLabelTitle, polishTitle } from '@/lib/ai/polish';

const STORY =
  '椅子腿压在砖缝上，左脚那块砖有点翘。桌上两只碗，一只已经空了。风把塑料布掀起来一角，压着它的还是那块石头。';

describe('polishTitle', () => {
  it('两字标题本来就成立时保持原样', () => {
    const result = polishTitle('空椅', { story: STORY });
    expect(result.title).toBe('空椅');
  });

  it('剔词后剩残渣时仍会补位，但不会捞到半截从句', () => {
    const result = polishTitle('时光里的温柔', { story: STORY });
    expect(result.title.length).toBeGreaterThanOrEqual(2);
    expect(result.title).not.toContain('的的');
    expect(result.title).not.toMatch(/[的了着是]$/);
  });

  it('道具标签仍然会被换掉', () => {
    const result = polishTitle('蓝牌的车', { story: '停在没人的路边，车灯还亮着。' });
    expect(isPropLabelTitle('蓝牌的车')).toBe(true);
    expect(isPropLabelTitle(result.title)).toBe(false);
  });
});

describe('deriveSceneTitle', () => {
  it('不会交出「压着它的还是那块」这类从句', () => {
    const title = deriveSceneTitle(STORY);
    expect(title).not.toBe('压着它的还是那块');
    if (title) {
      expect(title).not.toMatch(/它|还是|就是/);
      expect(title).not.toMatch(/[的了着是]$/);
    }
  });

  it('避开同批已用标题', () => {
    const first = deriveSceneTitle(STORY);
    expect(first).not.toBeNull();
    const second = deriveSceneTitle(STORY, [first as string]);
    expect(second).not.toBe(first);
  });
});
