"use client"

import * as React from "react"
import { CalendarIcon } from "lucide-react"

import { Button } from "@repo/ui/components/button"
import { Calendar } from "@repo/ui/components/calendar"
import { Input } from "@repo/ui/components/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover"
import { cn } from "@repo/ui/lib/utils"

// The shadcn "Input" date picker (ui.shadcn.com/docs/components/date-picker):
// a text field you can type into, with a calendar popover behind a trailing
// icon. The canonical value is an ISO date string ("YYYY-MM-DD"); the field
// shows a friendly "1 June 2026" rendering.

// Parse/format the wire value in *local* time — building from y/m/d parts
// rather than `new Date("2026-06-01")` (which is UTC) keeps the calendar and
// the input from drifting by a day in non-UTC zones.
function parseISODate(value: string): Date | undefined {
  if (!value) return undefined
  const [y, m, d] = value.split("-").map(Number)
  if (!y || !m || !d) return undefined
  const date = new Date(y, m - 1, d)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toISODate(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function formatDisplay(date: Date | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
}

export type DatePickerProps = {
  id?: string
  /** Canonical value as "YYYY-MM-DD", or "" for empty. */
  value: string
  /** Emits a "YYYY-MM-DD" string, or "" when cleared. */
  onChange: (value: string) => void
  disabled?: boolean
  required?: boolean
  placeholder?: string
  className?: string
  /** Merged onto the <Input> (e.g. a warning border). */
  inputClassName?: string
  /** Earliest selectable date as "YYYY-MM-DD"; earlier days are disabled in
   *  the calendar and rejected when typed. */
  minDate?: string
}

export function DatePicker({
  id,
  value,
  onChange,
  disabled,
  required,
  placeholder = "Pick a date",
  className,
  inputClassName,
  minDate,
}: DatePickerProps) {
  const date = parseISODate(value)
  const min = parseISODate(minDate ?? "")
  const [open, setOpen] = React.useState(false)
  const [month, setMonth] = React.useState<Date | undefined>(date)
  // The visible text is buffered locally so typing isn't fought by the parent;
  // it re-syncs whenever the canonical value changes from outside.
  const [text, setText] = React.useState(() => formatDisplay(date))
  React.useEffect(() => {
    setText(formatDisplay(parseISODate(value)))
  }, [value])
  // When the minimum moves forward (the parent bumped it, e.g. a later start
  // date), a stale month would open the calendar on a fully disabled view —
  // advance it to the minimum's month.
  React.useEffect(() => {
    const minDay = parseISODate(minDate ?? "")
    if (!minDay) return
    const minMonth = new Date(minDay.getFullYear(), minDay.getMonth(), 1)
    setMonth((m) => (m && m < minMonth ? minDay : m))
  }, [minDate])

  return (
    <div className={cn("relative flex", className)}>
      <Input
        id={id}
        value={text}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        className={cn("bg-surface pr-10", inputClassName)}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          if (next.trim() === "") {
            onChange("")
            return
          }
          // new Date("YYYY-MM-DD") means UTC midnight — the previous day in
          // negative-offset zones — so ISO-shaped input is built from local
          // parts instead. Friendly text ("1 June 2026") already parses local.
          const typed = next.trim()
          const parsed = /^\d{4}-\d{1,2}-\d{1,2}$/.test(typed)
            ? parseISODate(typed)
            : new Date(typed)
          if (parsed && !Number.isNaN(parsed.getTime()) && !(min && parsed < min)) {
            onChange(toISODate(parsed))
            setMonth(parsed)
          }
        }}
        onBlur={() => {
          // Snap the buffer back to the canonical rendering so half-typed or
          // unparseable text doesn't linger.
          setText(formatDisplay(parseISODate(value)))
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setOpen(true)
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label="Open calendar"
            className="absolute top-1/2 right-1 -translate-y-1/2 text-ink-mute hover:text-ink"
          >
            <CalendarIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-auto overflow-hidden p-0"
          align="start"
          sideOffset={8}
        >
          <Calendar
            mode="single"
            selected={date}
            month={month}
            onMonthChange={setMonth}
            captionLayout="dropdown"
            weekStartsOn={1}
            disabled={min ? { before: min } : undefined}
            onSelect={(selected) => {
              onChange(toISODate(selected))
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
