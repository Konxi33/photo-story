// 0.8.1：标题命名法换成赛事口径后的守门测试。
// 这一轮的重点不是「写得更美」，而是「别把赛事命名法改坏」：
// 单词标题要能只有一个字，编号要能带数字和空格，破折号副题不能被当句读删掉。
import { describe, expect, it } from 'vitest';

import { TITLE_EXAMPLES, TITLE_STYLES, getTitleStyle } from '@/config/styles';
import { polishTitle } from '@/lib/ai/polish';

describe('标题命名法目录', () => {
  it('六种命名法都在，且各自有例子', () => {
    expect(TITLE_STYLES.map((s) => s.id).sort()).toEqual(
      ['cinematic', 'concise', 'literary', 'plain', 'poetic', 'symbol'].sort(),
    );
    for (const style of TITLE_STYLES) {
      expect(style.label.length).toBeGreaterThan(0);
      expect(style.hint).toContain('例：');
      expect(style.note.length).toBeGreaterThan(0);
    }
  });

  it('语感参照里含赛事里的短标题与编号写法', () => {
    expect(TITLE_EXAMPLES).toContain('盐');
    expect(TITLE_EXAMPLES).toContain('无题 No.04');
    expect(TITLE_EXAMPLES.some((t) => t.includes('—'))).toBe(true);
  });

  it('未知 id 回落到第一种', () => {
    expect(getTitleStyle(undefined).id).toBe(TITLE_STYLES[0]!.id);
  });
});

describe('polishTitle：别把赛事命名法改坏', () => {
  it('单词命名法下，一个字的标题不被补成描述句', () => {
    const { title } = polishTitle('盐', { story: '桌上放着一袋盐，袋口没系。', titleStyle: 'concise' });
    expect(title).toBe('盐');
  });

  it('无题 / 编号保留数字与空格', () => {
    const { title } = polishTitle('无题 No.04', { titleStyle: 'symbol' });
    expect(title).toBe('无题 No.04');
  });

  it('专名的破折号副题保留', () => {
    const { title } = polishTitle('香豌豆—友谊', { titleStyle: 'cinematic' });
    expect(title).toBe('香豌豆—友谊');
  });

  it('十个字以内的标题不动', () => {
    const { title } = polishTitle('道路中隐藏的秘密', { titleStyle: 'poetic' });
    expect(title).toBe('道路中隐藏的秘密');
  });

  it('超长标题压到 14 字以内', () => {
    const { title } = polishTitle('这是一句非常长的描述画面中所有人都在做的事的标题');
    expect(title.length).toBeLessThanOrEqual(14);
  });

  it('摄影腔形容词仍会被剔掉', () => {
    const { title } = polishTitle('静谧的盐', { titleStyle: 'concise' });
    expect(title).not.toContain('静谧');
  });

  it('默认命名法下，道具标签仍会被换成正文里的局面', () => {
    const { title } = polishTitle('蓝牌的车', { story: '车停在没人的路边，刚熄火，车灯还亮着。' });
    expect(title).not.toBe('蓝牌的车');
    expect(title.length).toBeGreaterThan(1);
  });
});
