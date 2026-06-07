import * as React from "react"
import { cn } from "@/src/lib/utils"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-orange-500 text-white hover:bg-orange-600 shadow-sm shadow-orange-900/30": variant === "default",
            "bg-red-500 text-white hover:bg-red-600": variant === "destructive",
            "border border-slate-700/80 bg-transparent hover:bg-slate-800 hover:border-slate-600 text-slate-200": variant === "outline",
            "bg-slate-800 text-slate-200 hover:bg-slate-700": variant === "secondary",
            "hover:bg-slate-800 hover:text-slate-200 text-slate-300": variant === "ghost",
            "text-orange-500 underline-offset-4 hover:underline": variant === "link",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-lg px-3": size === "sm",
            "h-11 rounded-lg px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
