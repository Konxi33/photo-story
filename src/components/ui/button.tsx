import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

// 0.5.1：按钮统一成「有厚度」的一套——
// 实心按钮有轻微内高光与投影，hover 抬起 1px，按下回弹 0.97；
// 描边按钮改成半透明底，不再是纯白块压在纸面上。
const buttonVariants = cva(
  "ps-pressable inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium outline-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_1px_2px_rgba(0,0,0,0.14)] hover:bg-primary/92 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_6px_16px_-8px_rgba(0,0,0,0.4)]",
        destructive:
          "bg-destructive text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_1px_2px_rgba(0,0,0,0.16)] hover:bg-destructive/92",
        outline:
          "border border-line/80 bg-surface/70 text-ink shadow-[var(--elev-1)] backdrop-blur-sm hover:border-ink/20 hover:bg-surface",
        secondary:
          "bg-surface-2 text-secondary-foreground hover:bg-surface-2",
        ghost:
          "text-ink-mid hover:bg-ink/6 hover:text-ink",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-lg gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5",
        lg: "h-10 rounded-xl px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
