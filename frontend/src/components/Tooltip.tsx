import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

/**
 * Lightweight CSS-only hover/focus tooltip. The trigger is wrapped in a
 * focusable span so keyboard users get the tooltip too.
 */
export function Tooltip({
  content,
  children,
  className,
  triggerClassName,
  triggerTabIndex = 0,
  align = 'center',
  placement = 'top',
}: {
  content: ReactNode
  children: ReactNode
  className?: string
  triggerClassName?: string
  triggerTabIndex?: number
  align?: 'start' | 'center' | 'end'
  placement?: 'top' | 'bottom'
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      <span
        tabIndex={triggerTabIndex}
        className={cn('inline-flex min-w-0 outline-none', triggerClassName)}
      >
        {children}
      </span>
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-40 w-max max-w-72 rounded-2xl border-2 border-berry-100 bg-white px-4 py-3 text-left text-xs font-bold text-berry-950 opacity-0 shadow-soft transition-opacity group-focus-within/tooltip:opacity-100 group-hover/tooltip:opacity-100 dark:border-white/10 dark:bg-berry-950 dark:text-berry-50',
          placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          align === 'start'
            ? 'left-0'
            : align === 'end'
              ? 'right-0'
              : 'left-1/2 -translate-x-1/2',
        )}
      >
        {content}
      </span>
    </span>
  )
}
