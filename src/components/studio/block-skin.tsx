'use client';

// src/components/studio/block-skin.tsx
// 0.7.2：排版台「积木」的视觉身份证。
//
// 用户说「选择积木的时候可以不用文字描述……搞成图片描述或者是积木描述，一眼更直观」。
// 所以每个积木都要有：一个图标、一个 2–4 字的短名、一种颜色调性（版面=铜、文字=墨、解读=暗房蓝）。
// 颜色不写死在这里 —— 由 globals.css 的 .ps-mini-block[data-tone] 决定，
// 深浅两个主题各自取 --copper / --cool，缩略图底色永远是纸白（它代表印出来的纸）。

import {
  Accessibility,
  Aperture,
  AlignLeft,
  Camera,
  Gauge,
  Hash,
  Heading,
  Image as ImageIcon,
  Layers,
  Lightbulb,
  SlidersHorizontal,
  Sparkles,
  Tag,
  Type,
  type LucideIcon,
} from 'lucide-react';

import type { PhotoBlockId } from '@/lib/export/blocks';

/** 积木的调性：版面（铜）/ 文字（墨）/ 解读（暗房蓝） */
export type BlockTone = 'copper' | 'ink' | 'cool';

/** 两三个字的短名 —— 面板上只留这么点字，其余靠缩略图说 */
export const BLOCK_SHORT: Record<PhotoBlockId, string> = {
  index: '序号',
  title: '标题',
  image: '照片',
  caption: '图注',
  story: '正文',
  technique: '手法',
  category: '类别',
  tags: '标签',
  mood: '氛围',
  alt: '无障碍',
  exif: '机身',
  params: '参数',
  score: '评分',
  advice: '建议',
};

export const BLOCK_ICON: Record<PhotoBlockId, LucideIcon> = {
  index: Hash,
  title: Heading,
  image: ImageIcon,
  caption: Type,
  story: AlignLeft,
  technique: Aperture,
  category: Layers,
  tags: Tag,
  mood: Sparkles,
  alt: Accessibility,
  exif: Camera,
  params: SlidersHorizontal,
  score: Gauge,
  advice: Lightbulb,
};

export const BLOCK_TONE: Record<PhotoBlockId, BlockTone> = {
  index: 'copper',
  title: 'copper',
  image: 'copper',
  caption: 'copper',
  story: 'ink',
  technique: 'ink',
  tags: 'ink',
  mood: 'ink',
  alt: 'ink',
  category: 'cool',
  exif: 'cool',
  params: 'cool',
  score: 'cool',
  advice: 'cool',
};
