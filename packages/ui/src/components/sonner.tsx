"use client"

import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// VillageOS is light-only (Meadow v0.2), so the theme is fixed rather than read
// from next-themes. Tokens are raw HSL channels (e.g. `0 0% 100%`), so they must
// be wrapped in hsl() here to produce valid colors for sonner's CSS variables.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      // Renders a real dismiss control. Without this, the only X on an error
      // toast is the decorative OctagonX type icon, which isn't clickable.
      closeButton
      // Colors typed toasts (error/success/…). Sonner only applies its
      // error/success palette under `richColors` — without it, error toasts
      // render as plain toasts with just the icon.
      richColors
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleAlertIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "hsl(var(--popover))",
          "--normal-text": "hsl(var(--popover-foreground))",
          "--normal-border": "hsl(var(--border))",
          // Error toasts use the destructive token (#EF4444 via --cat-deadline)
          // as a solid fill with white text. Applied because `richColors` is on.
          "--error-bg": "hsl(var(--destructive))",
          "--error-text": "hsl(var(--destructive-foreground))",
          "--error-border": "hsl(var(--destructive))",
          "--border-radius": "var(--radius-md)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
