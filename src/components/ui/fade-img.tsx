// src/components/ui/fade-img.tsx
// 0.5.1：图片解码完成后再淡入，避免照片墙在切换/滚动时一片闪白。
// 缓存命中的图可能在挂载前就已解码，所以挂载后补一次 complete 检查。

'use client';

import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

interface FadeImgProps {
  src: string;
  alt: string;
  className?: string;
  /** 未解码时垫在下面的占位（默认骨架微光） */
  placeholderClassName?: string;
}

export function FadeImg({ src, alt, className, placeholderClassName }: FadeImgProps) {
  const ref = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const el = ref.current;
    if (el?.complete && el.naturalWidth > 0) setLoaded(true);
  }, [src]);

  return (
    <>
      {!loaded && (
        <span
          aria-hidden
          className={cn('ps-skeleton absolute inset-0 block', placeholderClassName)}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={ref}
        src={src}
        alt={alt}
        draggable={false}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn(
          'transition-opacity duration-[520ms] ease-[var(--ease-out)]',
          loaded ? 'opacity-100' : 'opacity-0',
          className,
        )}
      />
    </>
  );
}
