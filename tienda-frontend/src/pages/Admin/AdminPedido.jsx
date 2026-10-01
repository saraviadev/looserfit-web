import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getPedidoById, actualizarEstadoPedido, actualizarTrackingPedido } from '../../services/api'
import './Admin.css'

const ESTADOS = ['Pendiente', 'Pagado', 'Empaquetado', 'Enviado', 'Entregado', 'Cancelado']

export default function AdminPedido() {
  const { toast } = useToast();
  const { id } = useParams()
  const [pedido, setPedido] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getPedidoById(id)
      .then(data => { setPedido(data); setLoading(false) })
      .catch(() => { setError('No se pudo cargar el pedido'); setLoading(false) })
  }, [id])

  const handleEstado = async (estado) => {
    setSaving(true)
    try {
      const actualizado = await actualizarEstadoPedido(id, estado)
      setPedido(actualizado.pedido)
      setSaving(false)
    } catch {
      setError('No se pudo actualizar el estado')
      setSaving(false)
    }
  }

  const handleTracking = async (e) => {
    e.preventDefault()
    const num = e.target.tracking.value
    setSaving(true)
    try {
      const actualizado = await actualizarTrackingPedido(id, num)
      setPedido(actualizado.pedido)
      setSaving(false)
      toast.success('Seguimiento postal actualizado correctamente')
    } catch {
      toast.error('Error al actualizar seguimiento postal')
      setSaving(false)
    }
  }

  if (loading) return <p className="admin-loading">Cargando pedido...</p>
  if (error) return <p className="admin-form__error">{error}</p>
  if (!pedido) return null

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <Link to="/admin/pedidos" className="admin-back-btn">← Volver</Link>
          <h2 className="admin-page-title">Detalle Pedido</h2>
        </div>
      </div>

      <div className="admin-card">
        <p><strong>Orden:</strong> {pedido.orderNumber || '—'}</p>
        <p><strong>ID:</strong> {pedido._id}</p>
        <p><strong>Cliente:</strong> {pedido.datosEnvio?.nombreCompleto}</p>
        <p><strong>Email:</strong> {pedido.datosEnvio?.email}</p>
        <p><strong>Teléfono:</strong> {pedido.datosEnvio?.telefono}</p>
        <p><strong>Tipo de envío:</strong> {pedido.tipoEnvio === 'sucursal' ? 'Retirar en sucursal' : 'Envío a domicilio'}</p>
        <p><strong>Total:</strong> ${Number(pedido.total).toLocaleString('es-AR')}</p>
        <p><strong>Estado:</strong> {pedido.estado}</p>
        <div className="table-actions" style={{ marginTop: '1rem' }}>
          {ESTADOS.map(e => (
            <button 
              key={e} 
              type="button" 
              className={`admin-btn-secondary ${pedido.estado === e ? 'active' : ''}`} 
              onClick={() => handleEstado(e)}
              disabled={saving}
            >
              {saving && pedido.estado !== e ? '...' : e}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-card" style={{ marginTop: '1rem' }}>
        <h3 className="admin-card__title">Datos de envío</h3>
        <p><strong>Provincia:</strong> {pedido.datosEnvio?.provincia}</p>
        <p><strong>Localidad:</strong> {pedido.datosEnvio?.localidad}</p>
        {pedido.tipoEnvio === 'sucursal' ? (
          <>
            <p><strong>Dirección / Sucursal:</strong> {pedido.datosEnvio?.direccionSucursal}</p>
          </>
        ) : (
          <>
            <p><strong>Calle y número:</strong> {pedido.datosEnvio?.calleNumero}</p>
            <p><strong>Piso / Depto:</strong> {pedido.datosEnvio?.pisoDepto || '—'}</p>
            <p><strong>Código postal:</strong> {pedido.datosEnvio?.codigoPostal}</p>
          </>
        )}
      </div>

      <div className="admin-card" style={{ marginTop: '1rem' }}>
        <h3 className="admin-card__title">Seguimiento Correo Argentino</h3>
        <form onSubmit={handleTracking} style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <input 
            name="tracking" 
            placeholder="N° de seguimiento" 
            defaultValue={pedido.trackingNumber} 
            className="admin-input" 
            style={{ flex: 1, padding: '0.5rem', borderRadius: '4px', border: '1px solid #444', background: '#222', color: '#fff' }}
          />
          <button type="submit" className="admin-btn-secondary" disabled={saving}>
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </form>
      </div>

      <div className="admin-card" style={{ marginTop: '1rem' }}>
        <h3 className="admin-card__title">Productos</h3>
        {pedido.productos?.map((p, i) => (
          <div key={`${p.productoId}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.8rem 0', borderBottom: '1px solid #f0ede8' }}>
            {p.imagen && (
              <img src={p.imagen} alt={p.nombre} style={{ width: '55px', height: '55px', objectFit: 'cover', borderRadius: '6px', border: '1px solid #e0e0e0', flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block', fontSize: '0.95rem' }}>{p.nombre}</strong>
              {p.talle && <span style={{ fontSize: '0.8rem', color: '#888' }}>Talle: {p.talle}</span>}
            </div>
            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>x{p.cantidad}</span>
              {p.precioOferta ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#888', textDecoration: 'line-through' }}>${Number(p.precio).toLocaleString('es-AR')}</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 600, color: '#d32f2f' }}>${Number(p.precioOferta).toLocaleString('es-AR')}</span>
                </div>
              ) : (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', fontWeight: 600 }}>${Number(p.precio).toLocaleString('es-AR')}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {pedido.comprobante && (
        <div className="admin-card" style={{ marginTop: '1rem' }}>
          <h3 className="admin-card__title">Comprobante de Pago</h3>
          <div style={{ textAlign: 'center' }}>
            <a href={pedido.comprobante} target="_blank" rel="noreferrer">
              <img 
                src={pedido.comprobante} 
                alt="Comprobante" 
                style={{ maxWidth: '100%', borderRadius: '8px', cursor: 'pointer' }} 
              />
            </a>
            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              Haz clic en la imagen para verla en tamaño completo.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
