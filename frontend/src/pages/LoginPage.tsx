import { useSearchParams } from 'react-router-dom'
import { LogIn } from 'lucide-react'
import { api } from '../api/client'
import { Button } from '../components/Button'
import { Card } from '../components/Card'
import { LogoMark } from '../components/LogoMark'
import { useBranding } from '../lib/branding'

export function LoginPage() {
  const branding = useBranding()
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')

  return (
    <div className="grid min-h-svh place-items-center p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <LogoMark className="justify-center" />
        <h1 className="mt-6 font-display text-2xl font-black">
          {branding.app_name} · {branding.app_subtitle}
        </h1>
        <p className="mt-2 text-sm font-bold text-berry-700 dark:text-rose-100">
          {branding.app_tagline}
        </p>
        {error === 'forbidden' ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary dark:bg-blush/15 dark:text-blush"
          >
            Your account is not allowed to use this site. Ask an admin to add
            you to the right group in Authentik.
          </p>
        ) : error ? (
          <p
            role="alert"
            className="mt-4 rounded-2xl bg-primary/10 px-4 py-3 text-sm font-bold text-primary dark:bg-blush/15 dark:text-blush"
          >
            Sign-in failed. Please try again.
          </p>
        ) : null}
        <Button
          className="mt-6 w-full"
          onClick={() => {
            window.location.href = api.loginUrl
          }}
        >
          <LogIn className="size-4" aria-hidden="true" />
          Sign in with Authentik
        </Button>
      </Card>
    </div>
  )
}
