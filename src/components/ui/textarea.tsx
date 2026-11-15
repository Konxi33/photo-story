import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-line/80 bg-surface-2/60 px-3 py-2 text-[13.5px] leading-relaxed text-ink shadow-[inset_0_1px_2px_rgba(24,22,18,0.04)] transition-[border-color,background-color,box-shadow] duration-[var(--dur-2)] outline-none",
        "placeholder:text-ink-faint",
        "hover:border-ink/18 hover:bg-surface",
        "focus-visible:border-ink/40 focus-visible:bg-surface focus-visible:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-ink)_9%,transparent)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive/70",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
