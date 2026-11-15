import * as React from "react"

import { cn } from "@/lib/utils"

// 0.5.1：输入框统一成「纸面内嵌」观感——比卡片略深一点，聚焦时边框转墨色 + 一圈柔和光晕，
// 而不是默认的蓝色 ring，与整体的暖灰纸感一致。
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-9 w-full min-w-0 rounded-lg border border-line/80 bg-surface-2/60 px-3 py-1 text-[13.5px] text-ink shadow-[inset_0_1px_2px_rgba(24,22,18,0.04)] transition-[border-color,background-color,box-shadow] duration-[var(--dur-2)] outline-none",
        "placeholder:text-ink-faint",
        "hover:border-ink/18 hover:bg-surface",
        "focus-visible:border-ink/40 focus-visible:bg-surface focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ink)_9%,transparent)]",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive/70 aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-destructive)_12%,transparent)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
