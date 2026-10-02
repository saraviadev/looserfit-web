/**
 * pixel.js — Integración de Meta Pixel (Facebook & Instagram Ads) para LooserFit
 * Soporta el funnel completo: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase
 */

export const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || ''

// Inicializar el script oficial de Meta Pixel dinámicamente si se configuró un Pixel ID
export function initMetaPixel() {
  if (typeof window === 'undefined') return
  if (!META_PIXEL_ID) return

  // Evitar doble inicialización
  if (window.fbq) return

    !(function (f, b, e, v, n, t, s) {
    if (f.fbq) return
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments)
    }
    if (!f._fbq) f._fbq = n
    n.push = n
    n.loaded = !0
    n.version = '2.0'
    n.queue = []
    t = b.createElement(e)
    t.async = !0
    t.src = v
    s = b.getElementsByTagName(e)[0]
    s.parentNode.insertBefore(t, s)
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js')
  
  window.fbq('init', META_PIXEL_ID)
  window.fbq('track', 'PageView')
}

// Ejecutor seguro (a prueba de adblockers o entornos sin pixel)
export function trackPixelEvent(eventName, params = {}) {
  if (typeof window !== 'undefined' && typeof window.fbq === 'function') {
    try {
      window.fbq('track', eventName, params)
    } catch {
      // Ignorar silenciosamente si hay extensiones bloqueadoras
    }
  }
}

export function trackPageView() {
  trackPixelEvent('PageView')
}

export function trackViewContent(producto) {
  if (!producto) return
  trackPixelEvent('ViewContent', {
    content_name: producto.nombre,
    content_category: producto.categoria || 'Streetwear',
    content_ids: [String(producto._id)],
    content_type: 'product',
    value: Number(producto.precioOferta || producto.precio || 0),
    currency: 'ARS'
  })
}

export function trackAddToCart(item) {
  if (!item) return
  trackPixelEvent('AddToCart', {
    content_name: item.nombre,
    content_ids: [String(item._id || item.productoId)],
    content_type: 'product',
    value: Number(item.precio || 0),
    currency: 'ARS'
  })
}

export function trackInitiateCheckout(total, numItems) {
  trackPixelEvent('InitiateCheckout', {
    value: Number(total || 0),
    currency: 'ARS',
    num_items: Number(numItems || 1)
  })
}

export function trackPurchase(pedido) {
  if (!pedido) return
  trackPixelEvent('Purchase', {
    value: Number(pedido.total || 0),
    currency: 'ARS',
    content_type: 'product',
    order_id: String(pedido.orderNumber || pedido._id || '')
  })
}
