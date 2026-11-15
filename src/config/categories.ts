// src/config/categories.ts
// 照片库的分类规则：用关键词匹配标题 / 标签 / 氛围 / 调色 / 文件名。
// 想加分类，往 GROUPS 里加一条即可，界面会自动出现。

export interface CategoryGroup {
  id: string;
  label: string;
  /** 匹配到任意关键词即归入该类 */
  keywords: string[];
  /** 图标用的 emoji，避免再引一套图标 */
  mark: string;
}

export const CATEGORY_GROUPS: CategoryGroup[] = [
  {
    id: 'night',
    label: '夜景',
    mark: '🌃',
    keywords: ['夜', '夜景', '夜间', '霓虹', '灯光', '星空', '星轨', '城市夜色', '路灯'],
  },
  {
    id: 'dusk',
    label: '黄昏',
    mark: '🌇',
    keywords: ['黄昏', '日落', '夕阳', '暮色', '晚霞', '余晖', '傍晚', '落日'],
  },
  {
    id: 'moon',
    label: '月亮',
    mark: '🌙',
    keywords: ['月亮', '月光', '月牙', '满月', '弦月', '月色', '月球'],
  },
  {
    id: 'people',
    label: '人像',
    mark: '🧑',
    keywords: ['人像', '人物', '肖像', '女孩', '男孩', '背影', '侧脸', '老人', '孩子', '手'],
  },
  {
    id: 'street',
    label: '街拍',
    mark: '🚦',
    keywords: ['街', '街道', '巷', '路口', '行人', '店面', '马路', '市井', '摊'],
  },
  {
    id: 'arch',
    label: '建筑',
    mark: '🏛️',
    keywords: ['建筑', '楼', '墙', '窗', '桥', '楼梯', '屋檐', '门', '混凝土'],
  },
  {
    id: 'nature',
    label: '山水',
    mark: '⛰️',
    keywords: ['山', '水', '湖', '海', '河', '云', '雾', '树', '林', '田'],
  },
  {
    id: 'still',
    label: '静物',
    mark: '🍵',
    keywords: ['静物', '杯', '花', '桌', '椅', '书', '食物', '面', '早餐', '咖啡'],
  },
  {
    id: 'film',
    label: '胶片',
    mark: '🎞️',
    keywords: ['黑白', '胶片', '颗粒', '低饱和', '复古', '过期卷', '银盐'],
  },
  {
    id: 'longexp',
    label: '慢门',
    mark: '🌊',
    keywords: ['慢门', '长曝光', '丝滑', '拖影', '车流', '光绘', '水雾'],
  },
];

/** 判断一张照片属于哪些分类 */
export function matchCategories(haystack: string): string[] {
  const text = haystack.toLowerCase();
  return CATEGORY_GROUPS.filter((group) =>
    group.keywords.some((keyword) => text.includes(keyword.toLowerCase())),
  ).map((group) => group.id);
}
