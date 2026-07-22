import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex transform-gpu items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold shadow-sm transition-all duration-200 ease-out hover:-translate-y-0.5 hover:scale-[1.015] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:hover:scale-100 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-80",
  {
    variants: {
      variant: {
        default:
          "border border-primary/80 bg-primary text-white hover:bg-primary/90 hover:text-white",
        destructive:
          "border border-destructive-border bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline:
          "border border-foreground/25 bg-card text-foreground shadow-none hover:border-foreground/45 hover:bg-primary/5 hover:text-primary hover:shadow-none",
        secondary:
          "border border-foreground/35 bg-secondary text-secondary-foreground shadow-none hover:border-foreground/55 hover:bg-secondary/80 hover:shadow-none",
        ghost: "border border-transparent bg-transparent shadow-none hover:bg-muted/70 hover:text-foreground hover:shadow-none",
        link: "h-auto rounded-none border-transparent bg-transparent p-0 text-primary shadow-none underline-offset-4 hover:translate-y-0 hover:scale-100 hover:bg-transparent hover:shadow-none hover:underline",
      },
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 px-3 text-xs",
        lg: "min-h-10 px-8",
        icon: "h-9 w-9 rounded-full",
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
