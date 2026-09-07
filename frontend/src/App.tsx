import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  Navigate,
  RouterProvider,
  createBrowserRouter,
} from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { LoginPage } from './pages/LoginPage'
import { OverviewPage } from './pages/OverviewPage'
import { ServersPage } from './pages/ServersPage'
import { TofinosPage } from './pages/TofinosPage'
import { TofinoPortsPage } from './pages/TofinoPortsPage'
import { TopologyPage } from './pages/TopologyPage'
import { TestbedLayout } from './pages/TestbedLayout'
import { CalendarPage } from './pages/CalendarPage'
import { ManagementLayout } from './pages/ManagementLayout'
import { ManagementPage } from './pages/ManagementPage'
import { ManagementSwitchPortsPage } from './pages/ManagementSwitchPortsPage'
import { ManagementTopologyPage } from './pages/ManagementTopologyPage'
import { VlansPage } from './pages/VlansPage'
import { AdminLayout } from './pages/admin/AdminLayout'
import { AdminDevicesPage } from './pages/admin/AdminDevicesPage'
import { AdminTofinosPage } from './pages/admin/AdminTofinosPage'
import { AdminCalDavPage } from './pages/admin/AdminCalDavPage'
import { AdminSettingsPage } from './pages/admin/AdminSettingsPage'
import { ThemeProvider } from './lib/theme'
import { ToastProvider } from './lib/toast'
import { BrandingProvider } from './lib/branding'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: (failureCount, error) => {
        if (error instanceof Error && error.name === 'ApiError') {
          return false
        }
        return failureCount < 1
      },
    },
  },
})

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { index: true, element: <OverviewPage /> },
          { path: '/testbed', element: <Navigate to="/servers" replace /> },
          {
            element: <TestbedLayout />,
            children: [
              { path: '/servers', element: <ServersPage /> },
              { path: '/tofinos', element: <TofinosPage /> },
              { path: '/tofinos/:tofinoId', element: <TofinoPortsPage /> },
              { path: '/topology', element: <TopologyPage /> },
            ],
          },
          { path: '/calendar', element: <CalendarPage /> },
          {
            path: '/management',
            element: <AdminRoute />,
            children: [
              {
                element: <ManagementLayout />,
                children: [
                  { index: true, element: <ManagementPage /> },
                  { path: 'topology', element: <ManagementTopologyPage /> },
                  { path: 'vlans', element: <VlansPage /> },
                  {
                    path: 'switches/:switchId',
                    element: <ManagementSwitchPortsPage />,
                  },
                ],
              },
            ],
          },
          {
            path: '/admin',
            element: <AdminRoute />,
            children: [
              {
                element: <AdminLayout />,
                children: [
                  { index: true, element: <Navigate to="/admin/devices" replace /> },
                  { path: 'devices', element: <AdminDevicesPage /> },
                  { path: 'tofinos', element: <AdminTofinosPage /> },
                  { path: 'caldav', element: <AdminCalDavPage /> },
                  { path: 'settings', element: <AdminSettingsPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
])

function App() {
  return (
    <BrandingProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <RouterProvider router={router} />
          </ToastProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </BrandingProvider>
  )
}

export default App
