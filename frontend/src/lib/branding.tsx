import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, type PublicConfigResponse } from '../api/client'

const defaultBranding: PublicConfigResponse = {
  app_name: 'RSVP',
  app_subtitle: 'Hardware reservations',
  app_tagline: 'Reserve shared lab hardware and understand the testbed at a glance.',
  logo_url: null,
  favicon_url: '/favicon.svg',
  repository_url: 'https://github.com/n1tr0-5urf3r/kn-rsvp',
  topology_switch_order: [],
  topology_uplink_labels: [],
  topology_preferred_uplink: null,
  topology_central_node: null,
}

const BrandingContext = createContext(defaultBranding)

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState(defaultBranding)

  useEffect(() => {
    let active = true
    api.publicConfig()
      .then((config) => {
        if (active) setBranding(config)
      })
      .catch(() => {
        // The generic defaults keep the login and outage screens usable.
      })
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.title = `${branding.app_name} · ${branding.app_subtitle}`
    let favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!favicon) {
      favicon = document.createElement('link')
      favicon.rel = 'icon'
      document.head.append(favicon)
    }
    favicon.href = branding.favicon_url
  }, [branding])

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  )
}

export function useBranding() {
  return useContext(BrandingContext)
}
