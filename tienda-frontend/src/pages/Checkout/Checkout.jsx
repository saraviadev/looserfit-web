import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { crearPedidoConBrand, crearPreferenciaPago } from '../../services/api'
import './Checkout.css'

const PROVINCIAS = [
  'Buenos Aires', 'Capital Federal', 'Catamarca', 'Chaco', 'Chubut', 
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 
  'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'
]

export default function Checkout() {

  const { user } = useAuth()
  const { items, subtotal, clearCart } = useCart()
  const [tipoEnvio, setTipoEnvio] = useState('sucursal')
  const shippingCost = tipoEnvio === 'domicilio' ? 9500 : 6500
  const totalWithShipping = subtotal + shippingCost
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    nombreCompleto: '',
    provincia: '',
    localidad: '',
    direccionSucursal: '',
    email: '',
    telefono: '',
    calleNumero: '',
    pisoDepto: '',
    codigoPostal: '',
  })



  const productosPedido = useMemo(() => items.map(i => ({
    productoId: i._id,
    nombre: i.nombre,
    cantidad: i.cantidad,
    precio: i.precio,
    talle: i.talle || '',
    imagen: i.imagen || '',
  })), [items])
  
  useEffect(() => {
    if (user && !form.nombreCompleto) {
      setTimeout(() => {
        setForm(prev => ({
          ...prev,
          nombreCompleto: user.nombre || '',
          email: user.email || ''
        }))
      }, 0)
    }
  }, [user, form.nombreCompleto])

  // Calculate shipping cost synchronously (derived state)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'provincia') {
        next.localidad = ''
        next.direccionSucursal = ''
      }
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!items.length) return setError('No hay productos en el carrito.')

    const localidad = form.localidad.trim()
    const direccionSucursal = form.direccionSucursal.trim()
    const calleNumero = form.calleNumero.trim()

    const localidadValida = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{3,}$/
    if (!localidadValida.test(localidad)) {
      return setError('Localidad inválida: ingresa una localidad real.')
    }

    if (tipoEnvio === 'sucursal') {
      if (!direccionSucursal || direccionSucursal.trim().length < 3) {
        return setError('Dirección de sucursal inválida: ingresa una dirección válida.')
      }
    }

    if (tipoEnvio === 'domicilio' && !calleNumero) {
      return setError('Calle y número son obligatorios para envío a domicilio.')
    }

    const pedidoData = {
      productos: productosPedido,
      total: totalWithShipping,
      tipoEnvio,
      datosEnvio: form,
      usuario: user?._id
    }

    try {
      setLoading(true)
      const resp = await crearPedidoConBrand(pedidoData)
      
      // Creamos la preferencia de Mercado Pago
      const preference = await crearPreferenciaPago(resp.pedido._id)
      
      // Limpiamos carrito antes de irnos
      clearCart()

      // Si es invitado (o incluso si es user para redundancia), guardamos el token de seguimiento localmente 
      // para habilitar la barra de notificaciones sin login
      localStorage.setItem('looserfit_guest_token', resp.pedido.trackingToken)

      // Redirigimos al init_point de Mercado Pago
      window.location.href = preference.init_point
    } catch (err) {
      console.error('Error en checkout:', err);
      const msg = err.response?.data?.mensaje || err.message || 'No se pudo generar el pedido. Revisa los datos.';
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="checkout-page">
      <div className="container">
        <div className="checkout-header">
          <Link to="/carrito" className="checkout-back">← Volver al carrito</Link>
          <h1>Checkout</h1>
        </div>

        <form className="checkout-form" onSubmit={handleSubmit}>
          <div className="checkout-layout">
            <section className="checkout-card">
              <h2>Datos de envío</h2>
              <div className="checkout-grid">
                <input name="nombreCompleto" placeholder="Nombre completo" value={form.nombreCompleto} onChange={handleChange} required />
                <input name="email" type="email" placeholder="Email" value={form.email} onChange={handleChange} required />
                <input name="telefono" placeholder="Teléfono" value={form.telefono} onChange={handleChange} required />
              </div>

              <div className="checkout-radio">
                <label><input type="radio" checked={tipoEnvio === 'sucursal'} onChange={() => setTipoEnvio('sucursal')} /> Retirar en sucursal</label>
                <label><input type="radio" checked={tipoEnvio === 'domicilio'} onChange={() => setTipoEnvio('domicilio')} /> Envío a domicilio</label>
              </div>

              <p style={{ margin: '0.6rem 0', color: '#333', fontSize: '0.9rem', lineHeight: '1.35' }}>
                Costo de envío: <strong>$6.500</strong> (sucursal) / <strong>$9.500</strong> (domicilio).
              </p>
              <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666' }}>
                Si no conocés la sucursal exacta, podés elegir una en el sitio oficial de Correo Argentino:
                {' '}<a href="https://www.correoargentino.com.ar/sucursal" target="_blank" rel="noreferrer">Buscar sucursales</a>.
              </p>

              {tipoEnvio === 'sucursal' ? (
                <div className="checkout-grid">
                  {/* Selector de provincia */}
                  <select
                    name="provincia"
                    value={form.provincia}
                    onChange={handleChange}
                    required
                    className="checkout-select"
                  >
                    <option value="">Seleccioná una provincia</option>
                    {PROVINCIAS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>

                  <input
                    name="localidad"
                    placeholder="Localidad / Ciudad"
                    value={form.localidad}
                    onChange={handleChange}
                    required
                  />

                  <input
                    name="direccionSucursal"
                    placeholder="Dirección o nombre de Sucursal Correo Argentino"
                    value={form.direccionSucursal}
                    onChange={handleChange}
                    required
                  />
                </div>
              ) : (
                <div className="checkout-grid">
                  <select
                    name="provincia"
                    value={form.provincia}
                    onChange={handleChange}
                    required
                    className="checkout-select"
                  >
                    <option value="">Seleccioná provincia</option>
                    {PROVINCIAS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input name="localidad" placeholder="Localidad / Ciudad" value={form.localidad} onChange={handleChange} required />
                  <input name="calleNumero" placeholder="Calle y número" value={form.calleNumero} onChange={handleChange} required />
                  <input name="pisoDepto" placeholder="Piso/Depto (opcional)" value={form.pisoDepto} onChange={handleChange} />
                  <input name="codigoPostal" placeholder="Código postal" value={form.codigoPostal} onChange={handleChange} required />
                </div>
              )}

            </section>

            <aside className="checkout-card">
              <h2>Resumen</h2>
              {items.map(i => (
                <div key={`${i._id}-${i.talle}`} className="checkout-item">
                  <span>{i.nombre} x{i.cantidad}</span>
                  <span>${(i.precio * i.cantidad).toLocaleString('es-AR')}</span>
                </div>
              ))}
              <div className="checkout-total">
                <span>Subtotal</span>
                <span>${subtotal.toLocaleString('es-AR')}</span>
              </div>
              <div className="checkout-total">
                <span>Envío</span>
                <span>${shippingCost.toLocaleString('es-AR')}</span>
              </div>
              <div className="checkout-total" style={{ marginTop: '0.2rem', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '0.4rem' }}>
                <strong>Total</strong>
                <strong>${totalWithShipping.toLocaleString('es-AR')}</strong>
              </div>
              {error && <p className="checkout-error">{error}</p>}
              <button className="btn btn-filled checkout-btn" disabled={loading}>
                {loading ? 'Confirmando...' : 'Confirmar pedido'}
              </button>
            </aside>
          </div>
        </form>
      </div>
    </div>
  )
}


