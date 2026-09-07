import { rsvpVersion } from '../version'
import { useBranding } from '../lib/branding'

export function AppFooter() {
  const branding = useBranding()
  return (
    <footer className="mt-8 border-t border-berry-100 px-1 py-6 text-center text-xs font-bold leading-relaxed text-berry-700 dark:border-white/10 dark:text-rose-100">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
        <span>{branding.app_name} v{rsvpVersion}</span>
        <span>© 2026 Fabian Ihle</span>
        <a
          href={`${branding.repository_url}/blob/main/LICENSE`}
          target="_blank"
          rel="noreferrer"
          className="transition hover:text-primary dark:hover:text-blush"
        >
          AGPL-3.0
        </a>
        <a
          href={branding.repository_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition hover:text-primary dark:hover:text-blush"
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4 fill-current"
            aria-hidden="true"
          >
            <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.78 1.2 1.78 1.2 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.57-.29-5.27-1.29-5.27-5.72 0-1.27.45-2.3 1.19-3.11-.12-.29-.52-1.47.11-3.07 0 0 .97-.31 3.16 1.19A11 11 0 0 1 12 6.05c.98 0 1.95.13 2.87.39 2.2-1.5 3.16-1.19 3.16-1.19.63 1.6.23 2.78.12 3.07.74.81 1.18 1.84 1.18 3.11 0 4.44-2.71 5.42-5.29 5.71.42.36.79 1.06.79 2.14v3.27c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
          </svg>
          View on GitHub
        </a>
      </p>
    </footer>
  )
}
