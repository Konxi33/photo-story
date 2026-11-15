"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[20px] w-[34px] shrink-0 cursor-pointer items-center rounded-full border border-transparent p-[2px] transition-[background-color,box-shadow] duration-[220ms] ease-[var(--ease-out)]",
        "data-[state=unchecked]:bg-line data-[state=unchecked]:shadow-[inset_0_1px_2px_rgba(24,22,18,0.12)]",
        "data-[state=checked]:bg-primary data-[state=checked]:shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]",
        "focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.28)] ring-0",
          "transition-transform duration-[260ms] ease-[var(--ease-spring)]",
          "data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
