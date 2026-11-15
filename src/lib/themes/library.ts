// src/lib/themes/library.ts
// 0.5.2 新模块：主题馆的内置主题库。
// 每个主题带「怎么拍」和「怎么写」两层内容——照片故事最终要交的是图 + 字，
// 所以主题不能只给关键词，得给可执行的提示。

import type { Photo } from '@/types/domain';

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  /** 命中这些词（标签 / 氛围 / 标题）就算这个主题 */
  keywords: string[];
  /** 一句话说清这类照片的难点 */
  challenge: string;
  /** 拍摄要点 */
  shootTips: string[];
  /** 写作提示：标题与故事的落点 */
  writeTips: string[];
  /** 卡片封面色调的 tailwind 类，用于没有照片时的占位 */
  accent: string;
}

export const THEMES: Theme[] = [
  {
    id: 'night',
    name: '夜色与烟火',
    tagline: '黑得干净，亮得克制',
    keywords: ['夜', '夜景', '烟花', '烟火', '灯光', '霓虹', '城市', 'night', 'firework', 'lowlight'],
    challenge: '难在暗部不糊、亮部不炸。手机拍夜景最容易犯的错是把整体提亮，结果天空发灰。',
    shootTips: [
      '先锁曝光在主体上，让环境暗下来，比整体提亮更像夜景',
      '烟花要留一点地景或人，纯天空的烟花没有尺度感',
      '手持时靠栏杆或墙，比开夜景模式更能保住细节',
    ],
    writeTips: [
      '别写「璀璨」「震撼」，写一个具体的光点、一次抬头、一声迟到的响',
      '把观众放在人群里，而不是放在观景台上',
    ],
    accent: 'from-[#1b1b25] to-[#3a2b46]',
  },
  {
    id: 'street',
    name: '街头与瞬间',
    tagline: '等一个不该出现的巧合',
    keywords: ['街头', '街拍', '行人', '路人', '市井', 'street', 'candid'],
    challenge: '难在不打扰。摆拍会立刻露馅，所以构图要提前想好，只等主体走进来。',
    shootTips: [
      '先找背景和光，再等人；不要反过来',
      '留一点不完美：半张脸、走掉的人影，比整齐更有现场感',
      '连拍三五张，挑那一张手脚都清楚的',
    ],
    writeTips: [
      '写你当时站在哪儿、在等什么，而不是照片里有什么',
      '结尾别升华，停在一个动作上就够了',
    ],
    accent: 'from-[#22201c] to-[#4a4235]',
  },
  {
    id: 'still',
    name: '静物与日常',
    tagline: '把普通东西拍得不普通',
    keywords: ['静物', '日常', '桌面', '食物', '咖啡', '花', 'still', 'object'],
    challenge: '难在光线。静物几乎全靠光的方向，正午顶光拍什么都不好看。',
    shootTips: [
      '找窗边的侧光，让物体有一半亮一半暗',
      '背景别塞满，留一块空给视线休息',
      '拉近一点，让材质（布纹、水汽、划痕）占主角',
    ],
    writeTips: [
      '写这个东西被谁用过、放在哪儿多久了',
      '避免「生活的美好」这类总结，写一个具体的细节动作',
    ],
    accent: 'from-[#262320] to-[#4d453a]',
  },
  {
    id: 'portrait',
    name: '人像与关系',
    tagline: '眼睛比姿势重要',
    keywords: ['人像', '人物', '肖像', '家人', '朋友', '孩子', 'portrait', 'people'],
    challenge: '难在放松。被拍的人一旦意识到镜头，肩膀就先僵了。',
    shootTips: [
      '先聊两句再举相机，前十分钟的照片基本不能用',
      '让手有事做：拿杯子、拨头发、扶着门框',
      '对焦永远在靠近镜头的那只眼睛上',
    ],
    writeTips: [
      '写他/她当时在做什么、说什么，不写「温柔」「坚定」这种评价',
      '别替被拍的人抒情，把判断留给读者',
    ],
    accent: 'from-[#241f22] to-[#4a3a3f]',
  },
  {
    id: 'landscape',
    name: '风光与远行',
    tagline: '天气是唯一的导演',
    keywords: ['风光', '山', '海', '湖', '日出', '日落', '云', '旅行', 'landscape', 'travel'],
    challenge: '难在尺度。远处的山在照片里常常变成一条灰线，因为没有前景做参照。',
    shootTips: [
      '加前景：一块石头、一丛草、一个人的背影',
      '宁欠勿过，天空的高光留在直方图里',
      '等云，别急着按——光线变化通常只有十分钟',
    ],
    writeTips: [
      '写路程、气温、脚上的泥，比写「壮阔」更能传达壮阔',
      '如果确实没故事，就老实写一张「到了」的照片',
    ],
    accent: 'from-[#1e2426] to-[#3e5152]',
  },
  {
    id: 'architecture',
    name: '建筑与几何',
    tagline: '让线条自己说话',
    keywords: ['建筑', '几何', '楼', '桥', '窗', '楼梯', 'architecture', 'building'],
    challenge: '难在透视。稍微仰一点，垂直线就全歪了，除非你故意要那个歪。',
    shootTips: [
      '找对称或重复，让画面有一个明确的秩序',
      '手机开网格，保证主要垂直线平行于画框',
      '用一小块天空或一个行人打破秩序，画面才不呆',
    ],
    writeTips: [
      '写结构和光，不写「城市的呼吸」这类空话',
      '可以写比例：几层楼、多少级台阶、几点钟的影子',
    ],
    accent: 'from-[#1f2226] to-[#414a52]',
  },
  {
    id: 'rain',
    name: '雨雪与坏天气',
    tagline: '坏天气是最好的滤镜',
    keywords: ['雨', '雪', '雾', '阴天', '水汽', 'rain', 'snow', 'fog'],
    challenge: '难在保住反差。雨雾会压平画面，不主动找对比就会灰成一片。',
    shootTips: [
      '找一点暖光（车灯、店招）压住冷调',
      '积水是免费的镜面，蹲低一点就能拍到倒影',
      '镜头上的水珠别急着擦，虚化的前景很好用',
    ],
    writeTips: [
      '写体感：鞋里的水、伞骨的响、玻璃上的雾',
      '别用「洗礼」「诗意」这类词，写具体的冷和湿',
    ],
    accent: 'from-[#1d2225] to-[#3a4548]',
  },
  {
    id: 'detail',
    name: '细节与质感',
    tagline: '退一步是记录，进一步是发现',
    keywords: ['细节', '微距', '质感', '纹理', '特写', 'detail', 'macro', 'texture'],
    challenge: '难在焦点。微距景深极浅，对偏一毫米就全虚。',
    shootTips: [
      '手动点焦，别信自动',
      '手肘撑住，或者把手机靠在一个固定物上',
      '背景越干净，细节越突出',
    ],
    writeTips: [
      '写这个局部属于什么、为什么会注意到它',
      '一个细节配一句话就够，别硬凑段落',
    ],
    accent: 'from-[#232120] to-[#4a443c]',
  },
];

export interface ThemeMatch {
  theme: Theme;
  photos: Photo[];
  best: Photo | null;
  avgScore: number | null;
}

function haystack(photo: Photo): string {
  const a = photo.analysis;
  if (!a) return '';
  return [a.title, a.mood, a.alt, ...(a.tags ?? [])].filter(Boolean).join(' ').toLowerCase();
}

export function matchThemes(photos: Photo[]): ThemeMatch[] {
  const hay = new Map<string, string>();
  for (const photo of photos) hay.set(photo.id, haystack(photo));

  return THEMES.map((theme) => {
    const words = theme.keywords.map((k) => k.toLowerCase());
    const hits = photos.filter((photo) => {
      const text = hay.get(photo.id) ?? '';
      return text.length > 0 && words.some((word) => text.includes(word));
    });

    const scored = hits.filter((p) => typeof p.analysis?.score?.overall === 'number');
    const sum = scored.reduce((acc, p) => acc + (p.analysis?.score?.overall ?? 0), 0);
    const best = scored
      .slice()
      .sort((a, b) => (b.analysis?.score?.overall ?? 0) - (a.analysis?.score?.overall ?? 0))[0] ??
      hits[0] ??
      null;

    return {
      theme,
      photos: hits,
      best,
      avgScore: scored.length > 0 ? sum / scored.length : null,
    };
  });
}

/** 没有照片命中，或者干脆没有照片时，给出「最值得先补的一类」 */
export function suggestTheme(matches: ThemeMatch[]): Theme | null {
  const empty = matches.filter((m) => m.photos.length === 0);
  if (empty.length === 0) return null;
  const order = ['night', 'street', 'still', 'portrait', 'landscape', 'architecture', 'rain', 'detail'];
  const sorted = empty.slice().sort((a, b) => order.indexOf(a.theme.id) - order.indexOf(b.theme.id));
  return sorted[0]?.theme ?? null;
}
