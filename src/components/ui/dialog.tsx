"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

/*
 * The dialog body scrolls; the header and footer stay put.
 *
 * Targeted by exclusion rather than by asking every dialog to wrap its fields
 * in a `<DialogBody>`: a caller who forgot the wrapper would get an unreachable
 * submit button, which is the bug this exists to fix.
 *
 * Three classes, each load-bearing. `min-h-0` is the one people miss — a flex
 * child will not shrink below its content without it, so the dialog grows past
 * the viewport again no matter what max-height says. `-mx-4 px-4` widens the
 * scroll area to the dialog's own edges while keeping its content inset, which
 * is what lets a footer *inside* a form still run edge to edge without
 * overflowing its scroll container.
 */
/*
 * Written out in full on purpose. Tailwind scans source text for whole class
 * names, so a selector assembled from a shared prefix at runtime would compile
 * to nothing at all and the dialog would silently go back to overflowing.
 */
const scrollableBody =
  "[&>*:not([data-slot=dialog-header]):not([data-slot=dialog-footer]):not([data-slot=dialog-close])]:min-h-0 [&>*:not([data-slot=dialog-header]):not([data-slot=dialog-footer]):not([data-slot=dialog-close])]:flex-1 [&>*:not([data-slot=dialog-header]):not([data-slot=dialog-footer]):not([data-slot=dialog-close])]:overflow-y-auto [&>*:not([data-slot=dialog-header]):not([data-slot=dialog-footer]):not([data-slot=dialog-close])]:-mx-4 [&>*:not([data-slot=dialog-header]):not([data-slot=dialog-footer]):not([data-slot=dialog-close])]:px-4"

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          /*
           * No bottom padding: the footer owns the dialog's bottom edge, and it
           * has to reach that edge whether it sits here as a direct child or
           * inside a scrolling form.
           */
          "fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-hidden rounded-xl bg-popover p-4 pb-0 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          scrollableBody,
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-2 pr-8", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        /*
         * Sticky so it survives being placed inside a scrolling form, which is
         * where most of these dialogs put it.
         *
         * Solid rather than the old bg-muted/50: content now slides underneath,
         * and a translucent bar would show it passing through. The mix is the
         * colour that tint used to resolve to over the popup.
         */
        "sticky bottom-0 z-10 -mx-4 flex shrink-0 flex-col-reverse gap-2 rounded-b-xl border-t bg-[color-mix(in_oklch,var(--popover),var(--muted)_50%)] px-4 py-3 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
