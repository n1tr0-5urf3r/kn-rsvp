import { Navigate, Outlet } from 'react-router-dom'
import { useMe } from '../api/queries'

/** Renders children only for admins; everyone else bounces to the overview. */
export function AdminRoute() {
  const { data, isLoading } = useMe()

  if (isLoading) {
    return null
  }

  if (!data?.user?.is_admin) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}
