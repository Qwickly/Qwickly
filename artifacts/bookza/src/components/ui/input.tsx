import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-11 w-full rounded-xl border border-border/80 bg-background/90 px-3.5 py-2 text-base text-foreground shadow-[0_1px_2px_hsl(var(--foreground)/0.04),inset_0_1px_0_hsl(var(--background)/0.8)] backdrop-blur-sm transition-[border-color,box-shadow,background-color] file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground/75 hover:border-foreground/25 hover:bg-background focus-visible:border-primary/70 focus-visible:bg-background focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:shadow-[0_0_0_3px_hsl(var(--primary)/0.10),0_1px_2px_hsl(var(--foreground)/0.04)] disabled:cursor-not-allowed disabled:bg-muted/45 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:hover:border-zinc-500 dark:focus-visible:bg-zinc-950 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
