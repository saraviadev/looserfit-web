// ============================================
// API.JS — Todas las llamadas al backend
// ============================================

const hostname = window.location.hostname
const isLocal = hostname === 'localhost' || 
                hostname === '127.0.0.1' || 
                hostname.startsWith('192.168.') || 
                hostname.startsWith('10.') || 
                hostname.startsWith('172.')

export const BASE_URL = import.meta.env.VITE_API_URL 
  ? import.meta.env.VITE_API_URL.replace(/\/$/, '') 
  : (isLocal ? `http://${hostname}:3000/api` : 'https://looserfit-api.onrender.com/api')

// Helper para obtener el token guardado
export const getAuthHeaders = () => {
  const token = localStorage.getItem('looserfit_token')
  if (!token || token === 'null' || token === 'undefined') return {}
  return { 'Authorization': `Bearer ${token}` }
}

// Multi-marca: helper para obtener el slug de la marca activa desde la URL
// /sport/* → 'sport'  |  /* → 'fit'
export const getBrandSlug = () => {
  const path = window.location.pathname
  return path.startsWith('/sport') ? 'sport' : 'fit'
}

// Multi-marca: resolver una marca por slug
export async function resolveBrand(slug) {
  const res = await fetch(`${BASE_URL}/brands/resolve?slug=${slug}`)
  if (!res.ok) throw new Error(`Marca '${slug}' no encontrada`)
  return res.json()
}

// --- Traer todos los productos ---
export async function getProductos(filtros = {}, brandSlug) {
  const params = new URLSearchParams()

  // Multi-marca: siempre enviar el brand
  params.append('brand', brandSlug || getBrandSlug())

  if (filtros.categoria)      params.append('categoria', filtros.categoria)
  if (filtros.corte)          params.append('corte', filtros.corte)
  if (filtros.q)              params.append('q', filtros.q)
  if (filtros.soloPublicados) params.append('soloPublicados', 'true')
  if (filtros.esNuevoDrop)    params.append('esNuevoDrop', 'true')

  const query = params.toString()
  const url   = query
    ? `${BASE_URL}/products/search?${query}`
    : `${BASE_URL}/products/all`

  const res = await fetch(url)
  if (!res.ok) throw new Error('Error al obtener productos')
  return res.json()
}

// --- Traer un producto por ID ---
export async function getProductoById(id, brandSlug) {
  const slug = brandSlug || getBrandSlug()
  const res = await fetch(`${BASE_URL}/products/${id}?brand=${slug}`)
  if (!res.ok) throw new Error('Producto no encontrado')
  return res.json()
}



export async function getPedidos() {
  const res = await fetch(`${BASE_URL}/orders/all`, {
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('looserfit_token')
      localStorage.removeItem('looserfit_user')
      window.location.reload() // Recargar para que AuthContext detecte el cierre de sesión
    }
    throw new Error('Error al obtener pedidos')
  }
  return res.json()
}

// --- Crear preferencia de pago (Mercado Pago) ---
export async function crearPreferenciaPago(orderId) {
  const res = await fetch(`${BASE_URL}/payments/create-preference`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderId })
  })
  if (!res.ok) {
    let mensaje = 'Error al generar el link de pago'
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch {
      // dejamos mensaje genérico
    }
    throw new Error(mensaje)
  }
  return res.json()
}

export async function getPedidoById(id) {
  const res = await fetch(`${BASE_URL}/orders/${id}`, {
    headers: {
      ...getAuthHeaders()
    }
  })
  if (!res.ok) throw new Error('Pedido no encontrado')
  return res.json()
}

export async function actualizarEstadoPedido(id, estado) {
  const res = await fetch(`${BASE_URL}/orders/${id}/estado`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ estado }),
  })
  if (!res.ok) throw new Error('No se pudo actualizar estado')
  return res.json()
}

export async function subirComprobante(orderId, formData) {
  const res = await fetch(`${BASE_URL}/orders/upload-comprobante/${orderId}`, {
    method: 'POST',
    body: formData, // No seteamos headers de JSON, el navegador lo hace solo para FormData
  })
  if (!res.ok) {
    throw new Error('No se pudo subir el comprobante')
  }
  return res.json()
}

export async function getMisPedidos() {
  const res = await fetch(`${BASE_URL}/orders/mine`, {
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('looserfit_token')
      localStorage.removeItem('looserfit_user')
      window.location.reload()
    }
    throw new Error('Error al obtener tus pedidos')
  }
  return res.json()
}

export async function actualizarTrackingPedido(id, trackingNumber) {
  const res = await fetch(`${BASE_URL}/orders/${id}/tracking`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ trackingNumber }),
  })
  if (!res.ok) throw new Error('No se pudo actualizar seguimiento')
  return res.json()
}

export async function eliminarProducto(id) {
  const res = await fetch(`${BASE_URL}/products/${id}`, { 
    method: 'DELETE',
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) throw new Error('No se pudo eliminar')
  return res.json()
}

export async function togglePublicadoProducto(id) {
  const res = await fetch(`${BASE_URL}/products/${id}/toggle`, { 
    method: 'PATCH',
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) throw new Error('No se pudo actualizar visibilidad')
  return res.json()
}

export async function toggleDropProducto(id) {
  const res = await fetch(`${BASE_URL}/products/${id}/toggle-drop`, { 
    method: 'PATCH',
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) throw new Error('No se pudo actualizar estado drop')
  return res.json()
}

export async function bulkToggleDropProductos(productIds, estado) {
  const res = await fetch(`${BASE_URL}/products/bulk/toggle-drop`, {
    method: 'PATCH',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders() 
    },
    body: JSON.stringify({ productIds, estado })
  })
  if (!res.ok) throw new Error('No se pudo actualizar el estado drop masivamente')
  return res.json()
}

export async function eliminarPedido(id) {
  const res = await fetch(`${BASE_URL}/orders/${id}`, {
    method: 'DELETE',
    headers: { ...getAuthHeaders() }
  })
  if (!res.ok) throw new Error('No se pudo eliminar el pedido')
  return res.json()
}

export async function eliminarPedidosBulk(ids) {
  const res = await fetch(`${BASE_URL}/orders/delete-bulk`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ ids })
  })
  if (!res.ok) throw new Error('No se pudieron eliminar los pedidos')
  return res.json()
}

export async function getHomeContent(brandSlug) {
  // Multi-marca: pasar el brand slug para cargar el home de la marca correcta
  const slug = brandSlug || getBrandSlug()
  const res = await fetch(`${BASE_URL}/home?brand=${slug}&_t=${Date.now()}`)
  if (!res.ok) throw new Error('No se pudo cargar contenido home')
  return res.json()
}

export async function getOrderByToken(token) {
  const res = await fetch(`${BASE_URL}/orders/track/${token}`)
  if (!res.ok) throw new Error('Seguimiento no encontrado')
  return res.json()
}

export async function updateHeroImages(formData) {
  const res = await fetch(`${BASE_URL}/home/hero`, {
    method: 'PUT',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (!res.ok) {
    let mensaje = `Error ${res.status}: No se pudo actualizar el hero`
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch { 
      if (res.status === 413) mensaje = "La imagen es demasiado grande para el servidor (Error 413)."
    }
    throw new Error(mensaje)
  }
  return res.json()
}

export async function updateFamilyImages(formData) {
  const res = await fetch(`${BASE_URL}/home/family`, {
    method: 'PUT',
    headers: { ...getAuthHeaders() },
    body: formData,
  })
  if (!res.ok) {
    let mensaje = 'No se pudo actualizar las fotos family'
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch { /* ignorar */ }
    throw new Error(mensaje)
  }
  return res.json()
}

export async function updateHomeSettings(settings) {
  const res = await fetch(`${BASE_URL}/home/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(settings)
  })
  if (!res.ok) {
    let mensaje = 'Error al guardar la configuración de lanzamiento'
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch {
      // mantengo el mensaje por defecto
    }
    throw new Error(mensaje)
  }
  return res.json()
}

export async function updateFeaturedProducts(productIds) {
  const res = await fetch(`${BASE_URL}/home/featured`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ productIds })
  })
  if (!res.ok) {
    let mensaje = 'No se pudo actualizar los productos destacados'
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch { /* ignorar */ }
    throw new Error(mensaje)
  }
  return res.json()
}

// --- AUTH ---
export async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Error al iniciar sesión')
  }
  return res.json()
}

export async function register(userData) {
  const res = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(userData)
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Error al registrarse')
  }
  return res.json()
}

export async function registerFromOrder(data) {
  const res = await fetch(`${BASE_URL}/auth/register-from-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  if (!res.ok) {
    const d = await res.json()
    throw new Error(d.error || 'No se pudo crear la cuenta')
  }
  return res.json()
}

// --- ADMIN NEWSLETTER ---
export async function sendNewsletter(asunto, contenido) {
  const res = await fetch(`${BASE_URL}/admin/newsletter`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify({ asunto, contenido })
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Error al enviar noticia')
  }
  return res.json()
}

// --- CATEGORIAS ---
export async function getCategories(brandSlug) {
  // Multi-marca: filtrar categorías por marca
  const slug = brandSlug || getBrandSlug()
  const res = await fetch(`${BASE_URL}/categories?brand=${slug}`)
  if (!res.ok) throw new Error('Error al obtener categorías')
  return res.json()
}

// --- PEDIDOS de orden: siempre incluir brand en la creación ---
export async function crearPedidoConBrand(pedidoData, brandSlug) {
  const slug = brandSlug || getBrandSlug()
  const res = await fetch(`${BASE_URL}/orders/create?brand=${slug}`, {
    method:  'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...getAuthHeaders()
    },
    body: JSON.stringify(pedidoData)
  })
  if (!res.ok) {
    let mensaje = 'Error al crear el pedido'
    try {
      const data = await res.json()
      mensaje = data.mensaje || data.error || mensaje
    } catch {
      // dejamos mensaje por defecto
    }
    throw new Error(mensaje)
  }
  return res.json()
}