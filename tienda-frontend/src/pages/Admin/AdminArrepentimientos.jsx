import { useState, useEffect, useCallback } from 'react'
import { getSolicitudesArrepentimiento, actualizarEstadoArrepentimiento } from '../../services/api'
import { useToast } from '../../context/ToastContext'
import './Admin.css'

export default function AdminArrepentimientos() {
  const [solicitudes, setSolicitudes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('todos')
  const [updatingId, setUpdatingId] = useState(null)
  const { showToast, confirmModal } = useToast()

  const cargarSolicitudes = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getSolicitudesArrepentimiento()
      setSolicitudes(data)
    } catch (err) {
      showToast(err.message || 'Error al cargar solicitudes de arrepentimiento', 'error')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  useEffect(() => {
    cargarSolicitudes()
  }, [cargarSolicitudes])

  const handleCambiarEstado = async (id, nuevoEstado) => {
    const confirmed = await confirmModal({
      title: 'Actualizar Estado de Revocación',
      message: `¿Confirmás el cambio de estado a "${nuevoEstado}"?`,
      confirmText: 'Actualizar',
      cancelText: 'Cancelar'
    })

    if (!confirmed) return

    try {
      setUpdatingId(id)
      await actualizarEstadoArrepentimiento(id, nuevoEstado, 'Actualizado desde panel admin')
      showToast(`Solicitud actualizada a "${nuevoEstado}"`, 'success')
      await cargarSolicitudes()
    } catch (err) {
      showToast(err.message || 'Error al actualizar estado', 'error')
    } finally {
      setUpdatingId(null)
    }
  }

  const filtradas = solicitudes.filter(s => {
    if (statusFilter === 'todos') return true
    return s.status === statusFilter
  })

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div>
          <h1>Botón de Arrepentimiento (Disp. 954/2025)</h1>
          <p className="admin-subtitle">
            Gestión y trazabilidad de solicitudes de revocación de compra conforme a Ley N° 24.240
          </p>
        </div>
        <button
          type="button"
          className="admin-btn admin-btn--secondary"
          onClick={cargarSolicitudes}
          disabled={loading}
        >
          {loading ? 'Cargando...' : '↺ Actualizar'}
        </button>
      </div>

      {/* Filtros */}
      <div className="admin-filters" style={{ margin: '1.2rem 0', display: 'flex', gap: '0.6rem' }}>
        {['todos', 'Recibido', 'EnRevision', 'Procesado', 'Rechazado'].map(st => (
          <button
            key={st}
            type="button"
            className={`admin-filter-btn ${statusFilter === st ? 'admin-filter-btn--active' : ''}`}
            onClick={() => setStatusFilter(st)}
          >
            {st === 'todos' ? 'Todas' : st}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#aaa' }}>Cargando solicitudes...</p>
      ) : filtradas.length === 0 ? (
        <div className="admin-empty-card" style={{ padding: '2rem', textAlign: 'center', background: '#141414', borderRadius: '8px' }}>
          <p style={{ color: '#888' }}>No hay solicitudes de arrepentimiento registradas en esta categoría.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Código Trámite</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Email</th>
                <th>N° Pedido</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(s => (
                <tr key={s._id}>
                  <td>
                    <strong style={{ color: '#00e5ff', fontFamily: 'monospace' }}>
                      {s.requestNumber}
                    </strong>
                  </td>
                  <td>
                    {new Date(s.createdAt).toLocaleDateString('es-AR', {
                      day: '2-digit', month: '2-digit', year: 'numeric'
                    })}
                  </td>
                  <td>{s.customerName}</td>
                  <td>{s.customerEmail}</td>
                  <td>
                    <strong>{s.orderNumber || (s.orderId?.orderNumber) || 'N/A'}</strong>
                  </td>
                  <td>
                    <span title={s.message || ''} style={{ cursor: s.message ? 'help' : 'default' }}>
                      {s.reason}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge--${s.status.toLowerCase()}`}>
                      {s.status}
                    </span>
                  </td>
                  <td>
                    <select
                      value={s.status}
                      disabled={updatingId === s._id}
                      onChange={e => handleCambiarEstado(s._id, e.target.value)}
                      style={{
                        background: '#222',
                        color: '#fff',
                        border: '1px solid #444',
                        padding: '4px 8px',
                        borderRadius: '4px'
                      }}
                    >
                      <option value="Recibido">Recibido</option>
                      <option value="EnRevision">En Revisión</option>
                      <option value="Procesado">Procesado</option>
                      <option value="Rechazado">Rechazado</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
