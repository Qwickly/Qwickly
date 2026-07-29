import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold shadow-[0_1px_2px_hsl(var(--foreground)/0.05)] transition-[background-color,border-color,color,box-shadow,opacity] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-80",
  {
    variants: {
      variant: {
        default:
          "border border-primary/80 bg-primary text-white hover:bg-primary/90 hover:text-white hover:shadow-[0_2px_6px_hsl(var(--primary)/0.18)]",
        destructive:
          "border border-destructive-border bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-border/80 bg-background text-foreground shadow-none hover:border-foreground/20 hover:bg-muted/45 hover:text-foreground hover:shadow-none",
        secondary:
          "border border-border/70 bg-secondary text-secondary-foreground shadow-none hover:border-foreground/20 hover:bg-secondary/80 hover:shadow-none",
        ghost: "border border-transparent bg-transparent shadow-none hover:bg-muted/55 hover:text-foreground hover:shadow-none",
        link: "h-auto rounded-none border-transparent bg-transparent p-0 text-primary shadow-none underline-offset-4 hover:bg-transparent hover:shadow-none hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 px-3 text-xs",
        lg: "min-h-10 px-6",
        icon: "h-9 w-9 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
