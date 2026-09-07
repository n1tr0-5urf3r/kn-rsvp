import { cn } from '../lib/cn'
import { useBranding } from '../lib/branding'

export function LogoMark({
  className,
  label = true,
}: {
  className?: string
  label?: boolean
}) {
  const branding = useBranding()
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="grid size-12 place-items-center rounded-3xl bg-white shadow-soft ring-2 ring-white/80 dark:bg-berry-900 dark:ring-white/10">
        {branding.logo_url ? (
          <img
            src={branding.logo_url}
            alt=""
            className="size-9 object-contain"
          />
        ) : (
          <svg
            viewBox="0 0 64 64"
            className="size-9"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="2" y="2" width="60" height="60" rx="16" fill="#c2284a" />
            <g
              stroke="#f7f3ea"
              strokeWidth="4"
              strokeLinecap="round"
              fill="none"
            >
              <circle cx="20" cy="20" r="5" fill="#f7f3ea" stroke="none" />
              <circle cx="44" cy="20" r="5" fill="#f7f3ea" stroke="none" />
              <circle cx="32" cy="38" r="5" fill="#f7f3ea" stroke="none" />
              <path d="M20 20 L32 38 L44 20" />
            </g>
            <text
              x="32"
              y="57"
              textAnchor="middle"
              fontFamily="Manrope, sans-serif"
              fontSize="13"
              fontWeight="800"
              fill="#f7f3ea"
            >
              rsvp
            </text>
          </svg>
        )}
      </span>
      {label ? (
        <span className="font-display text-lg font-black leading-none tracking-tight">
          {branding.app_name}
          <span className="block text-primary dark:text-blush">
            {branding.app_subtitle}
          </span>
        </span>
      ) : null}
    </div>
  )
}
