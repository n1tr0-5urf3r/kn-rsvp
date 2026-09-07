import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const fieldClasses =
  'w-full rounded-2xl border-2 border-berry-100 bg-white px-4 py-2.5 text-sm font-bold text-berry-950 transition focus:border-primary/40 dark:border-white/10 dark:bg-berry-950 dark:text-berry-50'

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldClasses, className)} {...props} />
}

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, className)} {...props} />
}

export function TextArea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClasses, 'min-h-20', className)} {...props} />
}

export function FieldLabel({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-xs font-black uppercase tracking-wide text-berry-700 dark:text-rose-100">
        {label}
      </span>
      {children}
    </label>
  )
}
