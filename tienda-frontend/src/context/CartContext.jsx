import { optimizeImage } from '../utils/imageOptimizer'
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getProductoById } from '../services/api'
import { CART_STORAGE_KEYS, DEFAULT_BRAND_SLUG } from '../config/brandConfig'

// La STORAGE_KEY legacy se mantiene para compatibilidad durante la transición
const STORAGE_KEY_LEGACY = 'looserfit_cart'
const CartContext = createContext(null)

function readCart(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || '[]')
  } catch {
    return []
  }
}

export function CartProvider({ brandSlug, children }) {
  // Determinar la clave de storage según la marca (carritos separados por marca)
  const slug = brandSlug || DEFAULT_BRAND_SLUG
  const storageKey = CART_STORAGE_KEYS[slug] || CART_STORAGE_KEYS[DEFAULT_BRAND_SLUG]

  const [items, setItems] = useState(() => readCart(storageKey))
  const syncedRef = useRef(false)

  useEffect(() => {
    // Multi-marca: persistir en la clave específica de esta marca
    localStorage.setItem(storageKey, JSON.stringify(items))
    window.dispatchEvent(new Event('cartUpdated'))
  }, [items, storageKey])

  // Sync prices from backend on mount to catch precioOferta changes
  const syncPrices = useCallback(async () => {
    if (items.length === 0) return
    try {
      const updates = await Promise.all(
        items.map(async (item) => {
          try {
            const product = await getProductoById(item._id)
            const precioActual = (product.precioOferta && product.precioOferta > 0)
              ? product.precioOferta
              : product.precio
            return { ...item, precio: precioActual }
          } catch {
            return item // keep existing if product fetch fails
          }
        })
      )
      // Only update if any price actually changed
      const hasChanges = updates.some((u, i) => u.precio !== items[i].precio)
      if (hasChanges) setItems(updates)
    } catch {
      // Fail silently — prices will be recalculated server-side anyway
    }
  }, [items])

  useEffect(() => {
    if (!syncedRef.current && items.length > 0) {
      syncedRef.current = true
      setTimeout(() => syncPrices(), 0)
    }
  }, [syncPrices, items.length])

  const addItem = (producto, talle, cantidad = 1) => {
    setItems(prev => {
      const idx = prev.findIndex(i => i._id === producto._id && i.talle === talle)
      if (idx >= 0) {
        const copy = [...prev]
        copy[idx] = { ...copy[idx], cantidad: copy[idx].cantidad + cantidad }
        return copy
      }
      const tieneOferta = producto.precioOferta && producto.precioOferta > 0
      const precioUnitario = tieneOferta ? producto.precioOferta : producto.precio
      return [...prev, {
        _id: producto._id,
        nombre: producto.nombre,
        precio: precioUnitario,
        imagen: optimizeImage(producto.imagenes?.[0] || '/placeholder.jpg', 200, 75),
        talle,
        cantidad,
      }]
    })
  }

  const updateCantidad = (_id, talle, cantidad, precio) => {
    setItems(prev => prev
      .map(i => (i._id === _id && i.talle === talle
        ? { ...i, cantidad: Math.max(1, cantidad), ...(precio != null && { precio }) }
        : i)))
  }

  const removeItem = (_id, talle) => {
    setItems(prev => prev.filter(i => !(i._id === _id && i.talle === talle)))
  }

  const clearCart = () => setItems([])

  const values = useMemo(() => {
    const totalItems = items.reduce((sum, i) => sum + i.cantidad, 0)
    const subtotal = items.reduce((sum, i) => sum + (Number(i.precio) || 0) * i.cantidad, 0)
    return { items, totalItems, subtotal, addItem, updateCantidad, removeItem, clearCart }
  }, [items])

  return (
    <CartContext.Provider value={values}>
      {children}
    </CartContext.Provider>
  )
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart debe usarse dentro de CartProvider')
  return ctx
}
