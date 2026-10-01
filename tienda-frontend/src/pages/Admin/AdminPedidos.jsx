import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getPedidos, eliminarPedido, eliminarPedidosBulk, restaurarPedido, restaurarPedidosBulk } from '../../services/api'
import { useAdminBrand } from '../../context/AdminBrandContext'
import { useToast } from '../../context/ToastContext'
import './Admin.css'

// Confirmación reforzada según estado del pedido
const getDeleteMessage = (pedido) => {
  const base = `¿Mover pedido ${pedido.orderNumber} a la papelera?`
  const restore = '\n\nPodés restaurarlo en cualquier momento desde la pestaña Papelera.'
  
  if (['Pagado', 'Empaquetado'].includes(pedido.estado)) {
    return `⚠️ ATENCIÓN: Este pedido está ${pedido.estado.toUpperCase()}.\n${base}${restore}`
  }
  if (pedido.estado === 'Enviado' || pedido.trackingNumber) {
    return `🚨 Este pedido ya fue ENVIADO${pedido.trackingNumber ? ` (tracking: ${pedido.trackingNumber})` : ''}.\n${base}${restore}`
  }
  return `${base}${restore}`
}

export default function AdminPedidos() {
  const { toast, confirmModal } = useToast();
  const [pedidos, setPedidos] = useState([])
  const [deletedPedidos, setDeletedPedidos] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedIds, setSelectedIds] = useState([])
  const [activeTab, setActiveTab] = useState('activos') // 'activos' | 'papelera'
  // Multi-marca: filtrar pedidos por la marca activa
  const { activeBrand } = useAdminBrand()

  const fetchPedidos = () => {
    setLoading(true)
    Promise.all([
      getPedidos(false),
      getPedidos(true)
    ])
      .then(([activos, eliminados]) => {
        console.log('API RESPONSE (pedidos):', activos);
        if (!Array.isArray(activos)) {
          console.warn('La API no devolvió un array:', activos);
        }
        setPedidos(activos)
        setDeletedPedidos(eliminados)
        setLoading(false)
      })
      .catch((err) => {
        console.error('Error fetching pedidos:', err);
        setLoading(false)
        toast.error('Error al cargar pedidos: ' + err.message)
      })
  }

  useEffect(() => {
    setTimeout(() => fetchPedidos(), 0)
  }, [])

  // Filtrar por marca y búsqueda
  const filterByBrandAndSearch = (list) => {
    const term = search.trim().toLowerCase()

    // Multi-marca: filtrar por la marca activa del selector
    const porMarca = list.filter(p => {
      const brandSlug = p.brand?.slug || 'fit'
      return brandSlug === activeBrand
    })

    if (!term) return porMarca

    return porMarca.filter(p => {
      const orderNumber = p.orderNumber?.toLowerCase() || ''
      const id = p._id?.toLowerCase() || ''
      const cliente = p.datosEnvio?.nombreCompleto?.toLowerCase() || ''
      return orderNumber.includes(term) || id.includes(term) || cliente.includes(term)
    })
  }

  const filteredPedidos = useMemo(() => filterByBrandAndSearch(pedidos), [pedidos, search, activeBrand])
  const filteredDeleted = useMemo(() => filterByBrandAndSearch(deletedPedidos), [deletedPedidos, search, activeBrand])

  // Cuadro inferior: solo pagados de la lista activa
  const pedidosPagados = useMemo(() => {
    return filteredPedidos.filter(p => p.estado === 'Pagado')
  }, [filteredPedidos])

  // Lista activa según tab
  const currentList = activeTab === 'activos' ? filteredPedidos : filteredDeleted

  const toggleSelect = (id) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    )
  }

  const toggleSelectAll = () => {
    if (selectedIds.length === currentList.length) {
      setSelectedIds([])
    } else {
      setSelectedIds(currentList.map(p => p._id))
    }
  }

  const handleDelete = async (pedido) => {
    const confirmed = await confirmModal({ title: '¿Mover a papelera?', message: getDeleteMessage(pedido), isDanger: true });
    if (!confirmed) return;
    try {
      await eliminarPedido(pedido._id)
      // Mover de activos a eliminados en el state local
      setPedidos(prev => prev.filter(p => p._id !== pedido._id))
      setDeletedPedidos(prev => [{ ...pedido, deleted: true, deletedAt: new Date().toISOString() }, ...prev])
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return
    const confirmed = await confirmModal({ title: '¿Eliminar pedidos seleccionados?', message: `¿Mover ${selectedIds.length} pedidos a la papelera?\nPodés restaurarlos desde la pestaña Papelera.`, isDanger: true });
    if (!confirmed) return;
    try {
      await eliminarPedidosBulk(selectedIds)
      const movedPedidos = pedidos.filter(p => selectedIds.includes(p._id))
      setPedidos(prev => prev.filter(p => !selectedIds.includes(p._id)))
      setDeletedPedidos(prev => [...movedPedidos.map(p => ({ ...p, deleted: true, deletedAt: new Date().toISOString() })), ...prev])
      setSelectedIds([])
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleRestore = async (id) => {
    try {
      const res = await restaurarPedido(id)
      // Mover de eliminados a activos en el state local
      setDeletedPedidos(prev => prev.filter(p => p._id !== id))
      if (res.pedido) {
        setPedidos(prev => [res.pedido, ...prev])
      } else {
        fetchPedidos()
      }
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleBulkRestore = async () => {
    if (selectedIds.length === 0) return
    const confirmed = await confirmModal({ title: '¿Restaurar pedidos?', message: `¿Restaurar ${selectedIds.length} pedidos seleccionados?` });
    if (!confirmed) return;
    try {
      await restaurarPedidosBulk(selectedIds)
      const restoredPedidos = deletedPedidos.filter(p => selectedIds.includes(p._id))
      setDeletedPedidos(prev => prev.filter(p => !selectedIds.includes(p._id)))
      setPedidos(prev => [...restoredPedidos.map(p => ({ ...p, deleted: false, deletedAt: null })), ...prev])
      setSelectedIds([])
    } catch (err) {
      toast.error(err.message)
    }
  }

  // Limpiar selección al cambiar de tab
  const switchTab = (tab) => {
    setActiveTab(tab)
    setSelectedIds([])
  }

  return (
    <div>
      <div className="admin-page-header">
        <div>
          <h2 className="admin-page-title">Pedidos</h2>
          <p className="admin-page-sub">
            Gestioná pedidos, estados y despachos.
          </p>
        </div>
        {selectedIds.length > 0 && activeTab === 'activos' && (
          <button className="admin-btn-primary" style={{ background: '#b91c1c' }} onClick={handleBulkDelete}>
            Mover a papelera ({selectedIds.length})
          </button>
        )}
        {selectedIds.length > 0 && activeTab === 'papelera' && (
          <button className="admin-btn-restore" onClick={handleBulkRestore}>
            Restaurar seleccionados ({selectedIds.length})
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`admin-tab ${activeTab === 'activos' ? 'admin-tab--active' : ''}`}
          onClick={() => switchTab('activos')}
        >
          Activos
          <span className="admin-tab__count">{filteredPedidos.length}</span>
        </button>
        <button
          className={`admin-tab ${activeTab === 'papelera' ? 'admin-tab--active' : ''}`}
          onClick={() => switchTab('papelera')}
        >
          🗑️ Papelera
          <span className="admin-tab__count">{filteredDeleted.length}</span>
        </button>
      </div>

      {/* Buscador */}
      <div className="admin-page-header" style={{ marginBottom: '1rem', gap: '0.5rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
        <label htmlFor="search-pedidos" style={{ fontWeight: 600 }}>Buscar:</label>
        <input
          id="search-pedidos"
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Número de orden, ID o cliente"
          style={{ padding: '0.4rem 0.6rem', borderRadius: '6px', border: '1px solid #ccc', minWidth: '240px' }}
        />
      </div>

      {/* Cuadro 1: Tabla principal (activos o papelera según tab) */}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <input 
                  type="checkbox" 
                  checked={selectedIds.length > 0 && selectedIds.length === currentList.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Orden</th>
              <th>ID</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Estado</th>
              <th>Fecha</th>
              {activeTab === 'papelera' && <th>Eliminado</th>}
              <th>Accion</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={activeTab === 'papelera' ? 9 : 8}>Cargando...</td></tr>
            ) : currentList.length === 0 ? (
              <tr><td colSpan={activeTab === 'papelera' ? 9 : 8}>
                {activeTab === 'papelera' 
                  ? 'La papelera está vacía.'
                  : 'No se encontraron pedidos para la búsqueda.'
                }
              </td></tr>
            ) : currentList.map(p => (
              <tr key={p._id}>
                <td>
                  <input 
                    type="checkbox" 
                    checked={selectedIds.includes(p._id)}
                    onChange={() => toggleSelect(p._id)}
                  />
                </td>
                <td className="table-id">{p.orderNumber || '-'}</td>
                <td className="table-id">{p._id}</td>
                <td>{p.datosEnvio?.nombreCompleto || p.usuario?.nombre || '-'}</td>
                <td className="table-mono">${Number(p.total || 0).toLocaleString('es-AR')}</td>
                <td>
                  <span className={`order-status order-status--${(p.estado || '').toLowerCase()}`}>
                    {p.estado || '-'}
                  </span>
                </td>
                <td>{p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-AR') : '-'}</td>
                {activeTab === 'papelera' && (
                  <td style={{ fontSize: '0.8rem', color: '#888' }}>
                    {p.deletedAt ? new Date(p.deletedAt).toLocaleDateString('es-AR') : '-'}
                  </td>
                )}
                <td style={{ display: 'flex', gap: '8px' }}>
                  <Link className="table-link" to={`/admin/pedidos/${p._id}`}>Ver</Link>
                  {activeTab === 'activos' ? (
                    <button className="table-link-danger" onClick={() => handleDelete(p)}>Borrar</button>
                  ) : (
                    <button className="admin-btn-restore" onClick={() => handleRestore(p._id)}>Restaurar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Cuadro 2: Pedidos Pagados (Listos para despachar) ── */}
      {activeTab === 'activos' && (
        <>
          <div className="admin-page-header" style={{ marginTop: '4rem', borderTop: '1px solid #eee', paddingTop: '2rem' }}>
            <div>
              <h2 className="admin-page-title" id="pagados">📦 Pedidos Pagados — Listos para despachar</h2>
              <p className="admin-page-sub">
                Pedidos con pago confirmado pendientes de empaquetado / envío por Correo Argentino.
              </p>
            </div>
          </div>

          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Cliente</th>
                  <th>Teléfono</th>
                  <th>Productos</th>
                  <th>Tipo Envío</th>
                  <th>Total</th>
                  <th>Fecha</th>
                  <th>Accion</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? <tr><td colSpan={8}>Cargando...</td></tr>
                  : pedidosPagados.length === 0
                    ? <tr><td colSpan={8} className="admin-empty">No hay pedidos pagados pendientes de despacho. ¡Todo al día! 🎉</td></tr>
                    : pedidosPagados.map(p => (
                        <tr key={p._id}>
                          <td className="table-id">{p.orderNumber || '-'}</td>
                          <td>{p.datosEnvio?.nombreCompleto || '-'}</td>
                          <td className="table-mono">{p.datosEnvio?.telefono || '-'}</td>
                          <td>
                            {p.productos?.map((prod, i) => (
                              <div key={`${prod.productoId}-${i}`} style={{ fontSize: '0.8rem', lineHeight: '1.4' }}>
                                <strong>{prod.nombre}</strong>
                                {prod.talle && <span style={{ color: '#888' }}> ({prod.talle})</span>}
                                <span style={{ color: '#555' }}> x{prod.cantidad}</span>
                              </div>
                            ))}
                          </td>
                          <td style={{ fontSize: '0.8rem', textTransform: 'capitalize' }}>
                            {p.tipoEnvio === 'sucursal' ? '📮 Sucursal' : '🏠 Domicilio'}
                          </td>
                          <td className="table-mono">${Number(p.total || 0).toLocaleString('es-AR')}</td>
                          <td>{p.createdAt ? new Date(p.createdAt).toLocaleDateString('es-AR') : '-'}</td>
                          <td>
                            <Link className="table-link" to={`/admin/pedidos/${p._id}`}>Gestionar</Link>
                          </td>
                        </tr>
                      ))
                }
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
