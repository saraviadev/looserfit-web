/**
 * BrandContext.jsx — Contexto de marca activa para el frontend.
 * Provee a toda la app con los datos de la marca actual:
 * - slug, name, logo, theme, seo, settings
 * Inyecta CSS variables dinámicas en :root según el theme de la marca.
 * Expone el hook useBrand() para consumir el contexto.
 */

/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react'
import { BASE_URL } from '../services/api'
import { DEFAULT_BRAND_SLUG } from '../config/brandConfig'

const BrandContext = createContext(null)

// Valores por defecto mientras carga (evitan errores de undefined)
const DEFAULT_BRAND = {
  slug: DEFAULT_BRAND_SLUG,
  name: 'Looser Fit',
  logo: '/logo3.0.png',
  theme: {
    primaryColor: '#0d0d0d',
    secondaryColor: '#f5f3ef',
    accentColor: '#c8b89a',
    fontFamily: 'Inter',
    borderRadius: '0px',
  },
  seo: {
    title: 'Looser Fit',
    description: 'Tienda oficial de Looser Fit.',
    ogImage: '',
  },
  settings: {
    comingSoon: false,
    maintenanceMode: false,
  },
}

export function BrandProvider({ brandSlug, children }) {
  const [brand, setBrand] = useState(DEFAULT_BRAND)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const slug = brandSlug || DEFAULT_BRAND_SLUG

    const fetchBrand = async () => {
      try {
        const res = await fetch(`${BASE_URL}/brands/resolve?slug=${slug}`)
        if (!res.ok) throw new Error(`Brand '${slug}' not found`)
        const data = await res.json()
        setBrand(data)
      } catch (err) {
        console.warn('[BrandContext] No se pudo resolver la marca, usando valores por defecto:', err.message)
        // Usar defaults con el slug correcto
        setBrand({ ...DEFAULT_BRAND, slug })
      } finally {
        setLoading(false)
      }
    }

    fetchBrand()
  }, [brandSlug])

  // Inyectar CSS variables dinámicas según el theme de la marca
  useEffect(() => {
    if (!brand?.theme) return
    const root = document.documentElement
    root.style.setProperty('--brand-primary', brand.theme.primaryColor || '#0d0d0d')
    root.style.setProperty('--brand-secondary', brand.theme.secondaryColor || '#f5f3ef')
    root.style.setProperty('--brand-accent', brand.theme.accentColor || '#c8b89a')
    root.style.setProperty('--brand-radius', brand.theme.borderRadius || '0px')
  }, [brand?.theme])

  // Actualizar el title y meta description del documento según la marca
  useEffect(() => {
    if (!brand?.seo) return
    document.title = brand?.slug === 'sport' ? 'Looser Sport' : 'Looser Fit'

    const metaDesc = document.querySelector('meta[name="description"]')
    if (metaDesc && brand.seo.description) {
      metaDesc.setAttribute('content', brand.seo.description)
    }
  }, [brand?.seo, brand?.slug])

  return (
    <BrandContext.Provider value={{ brand, loading }}>
      {children}
    </BrandContext.Provider>
  )
}

// Hook para consumir el contexto de marca
export function useBrand() {
  const ctx = useContext(BrandContext)
  if (!ctx) throw new Error('useBrand debe usarse dentro de un BrandProvider')
  return ctx
}
