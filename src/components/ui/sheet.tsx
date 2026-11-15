"use client"

import * as React from "react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/45 backdrop-blur-[3px]",
        "data-[state=open]:animate-[ps-fade-in_240ms_var(--ease-out)_both]",
        "data-[state=closed]:animate-[ps-fade-out_180ms_ease-in_both]",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-paper shadow-[var(--elev-3)]",
          side === "right" &&
            "inset-y-0 right-0 h-full w-full border-l border-line/60 sm:max-w-md data-[state=open]:animate-[ps-sheet-in_340ms_var(--ease-spring)_both] data-[state=closed]:animate-[ps-sheet-out_200ms_ease-in_both]",
          side === "left" &&
            "inset-y-0 left-0 h-full w-full border-r border-line/60 sm:max-w-md data-[state=open]:animate-[ps-sheet-in_340ms_var(--ease-spring)_both] data-[state=closed]:animate-[ps-sheet-out_200ms_ease-in_both]",
          side === "top" &&
            "inset-x-0 top-0 h-auto border-b border-line/60 data-[state=open]:animate-[ps-fade-in_240ms_var(--ease-out)_both] data-[state=closed]:animate-[ps-fade-out_180ms_ease-in_both]",
          side === "bottom" &&
            "inset-x-0 bottom-0 h-auto border-t border-line/60 data-[state=open]:animate-[ps-fade-in_240ms_var(--ease-out)_both] data-[state=closed]:animate-[ps-fade-out_180ms_ease-in_both]",
          className
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-4 right-4 rounded-lg p-1 text-ink-faint transition-colors duration-200 hover:bg-ink/6 hover:text-ink focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          aria-label="关闭"
        >
          <XIcon className="size-4" />
          <span className="sr-only">关闭</span>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 px-5 pt-5 pb-1", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 border-t border-line/50 px-5 py-3.5", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("ps-serif text-[17px] font-semibold tracking-tight text-ink", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-[13px] leading-relaxed text-ink-mid", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
