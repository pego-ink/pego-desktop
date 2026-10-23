import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { cn } from "@pego/ui/lib/utils";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@pego/ui/components/button";

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay
        data-slot="alert-dialog-overlay"
        className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-[pego-fade-in_var(--duration-fast)_var(--ease-out)] data-[state=closed]:animate-[pego-fade-out_var(--duration-fast)_var(--ease-out)_forwards]"
      />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-sm -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg outline-none data-[state=open]:animate-[pego-pop-in_var(--duration-base)_var(--ease-out)] data-[state=closed]:animate-[pego-pop-out_var(--duration-fast)_var(--ease-out)_forwards]",
          className,
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert-dialog-header" className={cn("grid gap-1", className)} {...props} />;
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("text-sm font-semibold", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

type ButtonLook = Pick<VariantProps<typeof buttonVariants>, "variant" | "size">;

/** The confirming button; closes the dialog on click. */
function AlertDialogAction({
  className,
  variant,
  size = "sm",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & ButtonLook) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/** The cancelling button; also what Escape triggers. */
function AlertDialogCancel({
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> & ButtonLook) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
};
