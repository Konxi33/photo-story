// src/components/shortcuts-dialog.tsx
'use client';

import { Keyboard } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const GROUPS: { title: string; items: { keys: string[]; desc: string }[] }[] = [
  {
    title: '全局',
    items: [
      { keys: ['Ctrl', 'K'], desc: '打开命令面板（跳页、找照片、执行操作）' },
      { keys: ['?'], desc: '打开这个快捷键清单' },
      { keys: ['Ctrl', ','], desc: '打开设置' },
      { keys: ['Ctrl', 'N'], desc: '回到项目列表' },
      { keys: ['Esc'], desc: '关闭当前弹层 / 清空搜索' },
    ],
  },
  {
    title: '项目内（工作台）',
    items: [
      { keys: ['Ctrl', 'Enter'], desc: '批量生成当前待处理的照片' },
      { keys: ['Ctrl', 'A'], desc: '全选当前可见的照片' },
      { keys: ['双击标题'], desc: '重命名项目' },
    ],
  },
  {
    title: '照片库与评分',
    items: [
      { keys: ['←', '→'], desc: '预览时切换上/下一张（也可用 J / K）' },
      { keys: ['Enter'], desc: '打开当前照片详情' },
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-2 text-ink-mid">
              <Keyboard className="h-3.5 w-3.5" />
            </span>
            快捷键
          </DialogTitle>
          <DialogDescription>照着按就行，不用记。</DialogDescription>
        </DialogHeader>

        <div className="mt-1 space-y-5">
          {GROUPS.map((group, groupIndex) => (
            <section
              key={group.title}
              className="ps-enter"
              style={{ ['--ps-delay' as string]: `${60 + groupIndex * 60}ms` }}
            >
              <h3 className="ps-eyebrow mb-2">{group.title}</h3>
              <ul className="overflow-hidden rounded-xl border border-line/50">
                {group.items.map((item, index) => (
                  <li
                    key={item.desc}
                    className="flex items-center justify-between gap-3 border-b border-line/40 px-3 py-2 text-[12.5px] transition-colors duration-200 last:border-b-0 hover:bg-ink/[0.03]"
                    style={
                      index % 2 === 1
                        ? { backgroundColor: 'color-mix(in srgb, var(--color-ink) 2.2%, transparent)' }
                        : undefined
                    }
                  >
                    <span className="text-ink-mid">{item.desc}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {item.keys.map((key) => (
                        <kbd
                          key={key}
                          className="min-w-[22px] rounded-md border border-line/80 bg-surface px-1.5 py-[2px] text-center font-sans text-[10.5px] font-medium text-ink-mid shadow-[0_1px_0_rgba(0,0,0,0.06)]"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
