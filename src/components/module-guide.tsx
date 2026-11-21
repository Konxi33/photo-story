// src/components/module-guide.tsx
// 0.5.5：模块页首的「这是干什么用的」引导卡。
// 起因：用户说「你创造的这些大功能，例如编排，连我自己都看不懂是干什么用的」。
// 行为：第一次进某个模块自动展开；点「知道了」收起并记住；之后页首只留一行
//      「编排是干什么的？」的入口，随时能翻回来。不做遮罩弹窗，避免打断操作。

'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { ArrowRight, HelpCircle, Lightbulb, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { getModule } from '@/config/modules';
import { cn } from '@/lib/utils';

const KEY_PREFIX = 'ps:guide:';

interface ModuleGuideProps {
  moduleId: string;
  /** 已有内容时（例如编排里已经有章节）不再自动展开，避免老用户每次都被教一遍 */
  autoOpen?: boolean;
  className?: string;
  /** 「现在试一下」按钮，传了就显示 */
  onTry?: () => void;
}

export function ModuleGuide({ moduleId, autoOpen = true, className, onTry }: ModuleGuideProps) {
  const doc = getModule(moduleId);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  // 0.6.2：这一卡默认只留一行提要 + 三步，细说按需展开——用户反馈「信息一上来太多」
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    if (!doc) return;
    let seen = false;
    try {
      seen = localStorage.getItem(KEY_PREFIX + moduleId) === '1';
    } catch {
      seen = false;
    }
    setOpen(!seen && autoOpen);
    setReady(true);
  }, [moduleId, autoOpen, doc]);

  if (!doc) return null;

  const dismiss = (): void => {
    setOpen(false);
    try {
      localStorage.setItem(KEY_PREFIX + moduleId, '1');
    } catch {
      /* 隐私模式下写不进去，也不影响本次收起 */
    }
  };

  if (!ready) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('ps-chip group h-7 text-[11.5px]', className)}
      >
        <HelpCircle className="h-3.5 w-3.5 text-copper/80" />
        {doc.name}是干什么的？
      </button>
    );
  }

  return (
    <section
      aria-label={`${doc.name}使用说明`}
      className={cn('ps-enter ps-card relative overflow-hidden px-4 py-4 sm:px-5', className)}
      style={{ '--ps-delay': '80ms' } as CSSProperties}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-copper via-copper/40 to-transparent"
      />
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-copper/12 text-copper">
          <Lightbulb className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h2 className="text-[13.5px] font-semibold text-ink">
              {doc.name} · {doc.tagline}
            </h2>
            <span className="ps-cap">第一次用可以先看这三行</span>
          </div>
          <p className="mt-1.5 flex items-baseline gap-1.5 text-[12.5px] leading-relaxed text-ink-mid">
            <span className="min-w-0">{doc.detail.split('。')[0]}。</span>
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              className="shrink-0 text-[11.5px] text-ink-faint underline decoration-[color:var(--hairline)] underline-offset-2 transition-colors hover:text-copper"
            >
              {showDetail ? '收起' : '细说'}
            </button>
          </p>
          {showDetail && (
            <p className="ps-fade-in mt-1 text-[12px] leading-relaxed text-ink-faint">{doc.detail}</p>
          )}
          <ol className="mt-3 grid gap-1.5">
            {doc.steps.map((step, index) => (
              <li key={step} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-ink-mid">
                <span className="mt-[1px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-copper/10 text-[10px] font-semibold tabular-nums text-copper">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-start gap-1.5 rounded-[10px] bg-surface-2/50 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-faint">
            <span className="shrink-0 font-medium text-ink-mid">小提示</span>
            <span>{doc.tip}</span>
          </p>
          <div className="mt-3 flex items-center gap-2">
            {onTry && (
              <Button size="sm" className="ps-sheen h-7 rounded-full px-3 text-[12px]" onClick={dismiss}>
                {doc.action ?? '知道了'}
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-full px-2.5 text-[12px] text-ink-faint hover:text-ink"
              onClick={dismiss}
            >
              知道了
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="收起说明"
          className="rounded-full p-1 text-ink-faint transition-colors duration-200 hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
