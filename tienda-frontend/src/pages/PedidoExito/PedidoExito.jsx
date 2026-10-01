import { useEffect, useState } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { getPedidoById, subirComprobante, registerFromOrder } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import './PedidoExito.css'

export default function PedidoExito() {
  const { toast } = useToast();
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

    if (!orderId) return

    getPedidoById(orderId)
      .then(data => {
        setPedido(data)
        setComprobanteUrl(data.comprobante || '')
      })
      .catch(() => setPedidoNotFound(true))
  }, [location.search, pedido])

  const handleUpload = async () => {
    if (!file) return toast.warning('Selecciona un archivo primero')
    if (!pedido) return setErrorUpload('No se pudo identificar el pedido.')

    setUploading(true)
    setErrorUpload('')
    
    const formData = new FormData()
    formData.append('comprobante', file)

    try {
      const res = await subirComprobante(pedido._id, formData)
      setComprobanteUrl(res.pedido.comprobante)
      setPedido(res.pedido)
      setSuccess(true)
      setFile(null)
    } catch {
      setErrorUpload('Error al subir el comprobante.')
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
      const data = await registerFromOrder({
        email: pedido.datosEnvio.email,
        nombre: pedido.datosEnvio.nombreCompleto,
        password,
        orderId: pedido._id
      })
      // Simular login automático
      localStorage.setItem('looserfit_token', data.token)
      localStorage.setItem('looserfit_user', JSON.stringify(data.user))
      // Limpiar token de invitado ya que ahora tiene cuenta
      localStorage.removeItem('looserfit_guest_token')
      setRegSuccess(true)
      // Recargar para que el Nav vea al usuario
      window.location.reload()
    } catch (err) {
      setRegError(err.message || 'Error al crear cuenta')
    } finally {
      setRegLoading(false)
    }
  }

  const gmailUrl = `mailto:looserfit2004@gmail.com?subject=Comprobante de Pago - Orden ${pedido?.orderNumber || pedido?._id || ''}&body=Hola! Adjunto mi comprobante de pago para la orden ${pedido?.orderNumber || pedido?._id || ''}.`

  return (
    <div className="pedido-exito-page">
      <div className="container">
        <div className="pedido-exito-card">
          <h1>Pedido generado</h1>
          <p>Tu pedido fue creado correctamente.</p>

          {pedido && (
            <div className="pedido-resumen">
              <p><strong>Orden:</strong> {pedido.orderNumber || '-'} </p>
              <p><strong>ID:</strong> {pedido._id}</p>
              <p><strong>Estado:</strong> {pedido.estado}</p>
              <p><strong>Total:</strong> ${Number(pedido.total).toLocaleString('es-AR')}</p>
            </div>
          )}

          {/* Sección de comprobante */}
          <div className="comprobante-section">
            <hr />
            <h3>Subir comprobante de pago</h3>
            {pedidoNotFound && (
              <p className="error-msg">No se pudo encontrar el pedido. Si llegaste desde Mercado Pago, intenta recargar la página o contactanos.</p>
            )}
            {pedido ? (
              comprobanteUrl ? (
                <div className="comprobante-preview">
                  <p className="success-msg">✅ Comprobante ya subido</p>
                  <img src={comprobanteUrl} alt="Comprobante" className="img-comprobante" />
                </div>
              ) : (
                <div 
                  className={`upload-box ${isDragging ? 'upload-box--dragging' : ''}`}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onDrop={onDrop}
                >
                  <p><strong>Arrastrá tu comprobante aquí</strong> o seleccioná un archivo.</p>
                  <p style={{ fontSize: '0.85rem', color: '#666', marginBottom: '0.8rem' }}>
                    Si pagaste con tarjeta de crédito desde Mercado Pago, no es necesario subir comprobante.
                  </p>
                  <input 
                    type="file" 
                    id="file-upload"
                    accept="image/*" 
                    onChange={(e) => setFile(e.target.files[0])} 
                    className="file-input"
                    style={{ display: 'none' }}
                  />
                  <label htmlFor="file-upload" className="btn btn-secondary-outline" style={{ marginBottom: '0.8rem', display: 'inline-block', cursor: 'pointer' }}>
                    {file ? `Archivo: ${file.name}` : 'Seleccionar archivo'}
                  </label>

                  {errorUpload && <p className="error-msg">{errorUpload}</p>}
                  {success && <p className="success-msg">¡Subido con éxito!</p>}
                  
                  <button 
                    onClick={handleUpload} 
                    className="btn btn-filled" 
                    style={{ width: '100%' }}
                    disabled={uploading || !file}
                  >
                    {uploading ? 'Subiendo...' : 'Confirmar y Subir'}
                  </button>
                </div>
              )
            ) : (
              <p>Estamos buscando tu pedido. Si el problema persiste, volvé a cargar la página o contactanos.</p>
            )}
          </div>

          {/* Registro Post-Compra para invitados */}
          {!user && pedido && !regSuccess && (
            <div className="registration-section">
              <hr />
              <h3>¿Querés seguir tu pedido y guardar tus datos?</h3>
              <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1.2rem' }}>
                Creá una cuenta en 1 segundo ingresando una contraseña.
              </p>
              <form onSubmit={handleRegister} className="reg-inline-form">
                <input 
                  type="password" 
                  placeholder="Elegí una contraseña" 
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="reg-input"
                  required
                />
                <button type="submit" className="btn btn-filled" disabled={regLoading}>
                  {regLoading ? 'Creando...' : 'Crear mi cuenta'}
                </button>
              </form>
              {regError && <p className="error-msg" style={{ marginTop: '0.5rem' }}>{regError}</p>}
            </div>
          )}

          {regSuccess && (
            <div className="registration-section success-box">
              <hr />
              <p className="success-msg">✅ ¡Cuenta creada con éxito! Ya podés ver tus pedidos en tu perfil.</p>
            </div>
          )}

          <div className="pedido-exito-actions">
            {!comprobanteUrl ? (
              <p className="mandatory-msg">⚠️ Debes subir el comprobante de pago para finalizar el proceso y que podamos preparar tu pedido.</p>
            ) : (
              <>
                <a href={gmailUrl} className="btn btn-filled" style={{ background: '#ea4335', borderColor: '#ea4335' }}>Mandar por Gmail</a>
                <Link to="/tienda" className="btn">Volver a tienda</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
