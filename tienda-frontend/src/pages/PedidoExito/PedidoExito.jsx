import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { getPedidoById, getOrderByToken, subirComprobante, registerFromOrder } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import './PedidoExito.css'

export default function PedidoExito() {
  const { toast } = useToast()
  const location = useLocation()
  const { state } = location
  const [pedido, setPedido] = useState(state?.pedido || null)
  const [pedidoNotFound, setPedidoNotFound] = useState(false)

  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorUpload, setErrorUpload] = useState('')
  const [comprobanteUrl, setComprobanteUrl] = useState(state?.pedido?.comprobante || '')
  const [isDragging, setIsDragging] = useState(false)
  const [copiedField, setCopiedField] = useState(null)
  const { user } = useAuth()

  // Registration for guests
  const [password, setPassword] = useState('')
  const [regLoading, setRegLoading] = useState(false)
  const [regSuccess, setRegSuccess] = useState(false)
  const [regError, setRegError] = useState('')

  useEffect(() => {
    if (pedido) return

    const params = new URLSearchParams(location.search)
    const orderId = params.get('external_reference') || params.get('orderId') || params.get('id')
    const token = params.get('token')

    if (!orderId && token) {
      getOrderByToken(token)
        .then(data => {
          setPedido(data)
          setComprobanteUrl(data.comprobante || '')
        })
        .catch(() => setPedidoNotFound(true))
      return
    }

    if (!orderId) {
      if (params.get('preview') === 'dev') {
        // Mock demo order for visual preview
        setPedido({
          _id: 'sample_dev_id',
          orderNumber: '#028',
          estado: 'Pendiente',
          total: 37500,
          trackingToken: 'dev_preview_token_123',
          datosEnvio: {
            nombreCompleto: 'Juan Pérez',
            email: 'juan@ejemplo.com'
          }
        })
      }
      return
    }

    getPedidoById(orderId)
      .then(data => {
        setPedido(data)
        setComprobanteUrl(data.comprobante || '')
      })
      .catch(() => setPedidoNotFound(true))
  }, [location.search, pedido])

  const copyToClipboard = (text, field) => {
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    toast.success(`${field} copiado: ${text}`)
    setTimeout(() => setCopiedField(null), 2000)
  }

  const handleUpload = async () => {
    if (!file) return toast.warning('Selecciona un archivo primero')
    if (!pedido) return setErrorUpload('No se pudo identificar el pedido.')

    // Simulation for preview mode
    if (pedido._id === 'sample_dev_id' || pedido._id === '68df1e40b793673f4dfbd121') {
      setUploading(true)
      setTimeout(() => {
        const dummyUrl = URL.createObjectURL(file)
        setComprobanteUrl(dummyUrl)
        setSuccess(true)
        setFile(null)
        setUploading(false)
        toast.success('Comprobante recibido correctamente')
      }, 500)
      return
    }

    setUploading(true)
    setErrorUpload('')
    
    const formData = new FormData()
    formData.append('comprobante', file)

    try {
      const guestToken = localStorage.getItem('looserfit_guest_token') || pedido.trackingToken
      const res = await subirComprobante(pedido._id, formData, guestToken)
      setComprobanteUrl(res.pedido?.comprobante || res.comprobante)
      if (res.pedido) setPedido(res.pedido)
      setSuccess(true)
      setFile(null)
      toast.success('Comprobante recibido correctamente')
    } catch (err) {
      const msg = err.message || 'Error al procesar el archivo. Verificá que sea un PDF o imagen válido.'
      setErrorUpload(msg)
      toast.error(msg)
    } finally {
      setUploading(false)
    }
  }

  const onDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const onDragLeave = () => setIsDragging(false)
  const onDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0])
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    if (!password || password.length < 6) return setRegError('La contraseña debe tener al menos 6 caracteres')
    
    setRegLoading(true)
    setRegError('')
    try {
      const guestToken = localStorage.getItem('looserfit_guest_token') || pedido?.trackingToken
      const data = await registerFromOrder({
        email: pedido.datosEnvio.email,
        nombre: pedido.datosEnvio.nombreCompleto,
        password,
        orderId: pedido._id,
        guestToken
      })
      localStorage.setItem('looserfit_token', data.token)
      localStorage.setItem('looserfit_user', JSON.stringify(data.user))
      localStorage.removeItem('looserfit_guest_token')
      setRegSuccess(true)
      toast.success('¡Cuenta creada con éxito!')
      setTimeout(() => window.location.reload(), 1200)
    } catch (err) {
      setRegError(err.message || 'Error al crear cuenta')
    } finally {
      setRegLoading(false)
    }
  }

  const isPdf = comprobanteUrl && comprobanteUrl.toLowerCase().includes('.pdf')
  const esPagado = pedido?.estado === 'Pagado'
  const esPendiente = pedido?.estado === 'Pendiente'

  return (
    <div className="order-success-wrapper">
      <div className="order-success-container">
        
        {/* Encabezado Principal Minimalista */}
        <div className="order-header-clean">
          <div className="order-check-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="order-title">
            {esPagado ? '¡Pago Acreditado!' : '¡Gracias por tu compra!'}
          </h1>
          <p className="order-subtitle">
            {pedido?.orderNumber 
              ? `Tu pedido ${pedido.orderNumber} fue generado exitosamente.` 
              : 'Tu pedido ha sido recibido y se encuentra en proceso.'}
          </p>
        </div>

        {/* Tarjeta de Resumen Compacta */}
        {pedido && (
          <div className="order-summary-card">
            <div className="summary-item">
              <span className="summary-label">Nº de Orden</span>
              <span className="summary-value highlight">{pedido.orderNumber || '-'}</span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Estado</span>
              <span className={`status-pill status-${(pedido.estado || 'Pendiente').toLowerCase()}`}>
                {pedido.estado === 'Pendiente' ? 'Pendiente de pago' : pedido.estado}
              </span>
            </div>
            <div className="summary-item">
              <span className="summary-label">Total</span>
              <span className="summary-value price">${Number(pedido.total || 0).toLocaleString('es-AR')}</span>
            </div>
          </div>
        )}

        {/* En caso de estar Pagado vía Mercado Pago */}
        {esPagado && (
          <div className="clean-alert alert-success" style={{ padding: '1.25rem', textAlign: 'left', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <div>
              <strong style={{ display: 'block', fontSize: '0.95rem' }}>Pago acreditado y confirmado</strong>
              <span style={{ fontSize: '0.85rem' }}>Ya estamos preparando tu paquete. No necesitás adjuntar comprobante.</span>
            </div>
          </div>
        )}

        {/* Datos Bancarios Claros y Elegantes (Solo para pedidos pendientes que requieren transferencia) */}
        {esPendiente && (
          <div className="bank-info-card">
            <div className="bank-card-header">
              <span className="bank-badge">TRANSFERENCIA BANCARIA</span>
              <p className="bank-instruction">Realizá la transferencia con el siguiente alias:</p>
            </div>
            
            <div className="bank-details-grid">
              <div className="bank-field">
                <span className="field-name">Alias</span>
                <div className="field-action-row">
                  <span className="field-content">looser.fit</span>
                  <button 
                    type="button" 
                    className="btn-copy-clean" 
                    onClick={() => copyToClipboard('looser.fit', 'Alias')}
                  >
                    {copiedField === 'Alias' ? '✓ Copiado' : 'Copiar'}
                  </button>
                </div>
              </div>

              <div className="bank-field-full">
                <span className="field-name">Titular</span>
                <span className="field-content-subtle">LooserFit Argentina</span>
              </div>
            </div>
          </div>
        )}

        {/* Zona de Carga de Comprobante (Solo para pedidos pendientes o con comprobante ya adjunto) */}
        {(!esPagado || comprobanteUrl) && (
          <div className="receipt-upload-card">
            <div className="card-section-title">
              <h3>Comprobante de Pago</h3>
              <p>Subí tu transferencia en PDF, JPG o PNG para verificar la acreditación.</p>
            </div>

            {pedidoNotFound && (
              <div className="clean-alert alert-error">
                No se encontró la orden especificada. Por favor contactanos si realizaste el pago.
              </div>
            )}

            {pedido ? (
              comprobanteUrl ? (
                <div className="receipt-attached-card">
                  <div className="receipt-status-header">
                    <span className="verified-dot"></span>
                    <div>
                      <h4 className="receipt-status-title">Comprobante adjuntado</h4>
                      <p className="receipt-status-desc">Estamos verificando la acreditación. Te notificaremos por email.</p>
                    </div>
                  </div>

                  <div className="receipt-preview-clean">
                    {isPdf ? (
                      <a 
                        href={comprobanteUrl} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="pdf-preview-box"
                      >
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        <span>Ver Comprobante PDF</span>
                      </a>
                    ) : (
                      <a href={comprobanteUrl} target="_blank" rel="noopener noreferrer">
                        <img src={comprobanteUrl} alt="Comprobante" className="receipt-image-preview" />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div 
                  className={`clean-dropzone ${isDragging ? 'dropzone-active' : ''} ${file ? 'has-file' : ''}`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <input 
                    type="file" 
                    id="receipt-file-input"
                    accept="image/jpeg,image/png,image/webp,application/pdf" 
                    onChange={(e) => setFile(e.target.files[0])} 
                    className="hidden-file-input"
                  />

                  {!file ? (
                    <label htmlFor="receipt-file-input" className="dropzone-label">
                      <div className="dropzone-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="17 8 12 3 7 8" />
                          <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                      </div>
                      <span className="dropzone-text-main">Hacé click o arrastrá tu comprobante aquí</span>
                      <span className="dropzone-text-sub">Formatos admitidos: PDF, JPG, PNG o WebP (hasta 5 MB)</span>
                    </label>
                  ) : (
                    <div className="selected-file-pane">
                      <div className="file-pill">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                          <polyline points="13 2 13 9 20 9" />
                        </svg>
                        <span className="file-name">{file.name}</span>
                        <button type="button" className="btn-remove-file" onClick={() => setFile(null)}>×</button>
                      </div>
                      
                      <button 
                        onClick={handleUpload} 
                        className="btn-submit-receipt"
                        disabled={uploading}
                      >
                        {uploading ? (
                          <>
                            <span className="spinner-sm"></span> Subiendo comprobante...
                          </>
                        ) : (
                          'Confirmar y Subir Comprobante'
                        )}
                      </button>
                    </div>
                  )}

                  {errorUpload && <p className="clean-alert alert-error">{errorUpload}</p>}
                  {success && <p className="clean-alert alert-success">¡Comprobante subido con éxito!</p>}
                </div>
              )
            ) : (
              <div className="clean-skeleton">Cargando información del pedido...</div>
            )}
          </div>
        )}

        {/* Registro Opcional Sutil para Invitados */}
        {!user && pedido && !regSuccess && (
          <div className="guest-register-card">
            <div className="guest-reg-header">
              <h4>Creá tu cuenta para consultar el envío</h4>
              <p>Guardá tu contraseña para acceder a tus pedidos cuando quieras.</p>
            </div>
            <form onSubmit={handleRegister} className="guest-reg-form">
              <input 
                type="password" 
                placeholder="Elegí una contraseña (mínimo 6 caracteres)" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="clean-input"
                required
              />
              <button type="submit" className="btn-outline-clean" disabled={regLoading}>
                {regLoading ? 'Creando...' : 'Crear cuenta'}
              </button>
            </form>
            {regError && <p className="clean-alert alert-error">{regError}</p>}
          </div>
        )}

        {/* Botones de Navegación Finales */}
        <div className="order-final-actions">
          {pedido?.trackingToken && (
            <Link 
              to={`/seguimiento/${pedido.trackingToken}?preview=dev`} 
              className="btn-primary-action"
            >
              Consultar Seguimiento
            </Link>
          )}
          <Link to="/tienda?preview=dev" className="btn-secondary-action">
            Volver a la Tienda
          </Link>
        </div>

      </div>
    </div>
  )
}
