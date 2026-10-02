import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { getMisPedidos, getPedidos, getOrderByToken } from '../../services/api'
import './PendingReceiptAlert.css'

export default function PendingReceiptAlert() {
  const { user } = useAuth()
  const [pendingCount, setPendingCount] = useState(0)
  const [targetUrl, setTargetUrl] = useState('')
  const [dismissed, setDismissed] = useState(() => typeof window !== 'undefined' && sessionStorage.getItem('dismissed_receipt_alert') === 'true')
  const location = useLocation()
  const isAdmin = user?.isAdmin === true

  useEffect(() => {
    const checkPending = async () => {
      try {
        if (isAdmin) {
          const orders = await getPedidos()
          const missing = (orders || []).filter(o => 
            o.estado === 'Pendiente' && 
            (o.paymentProvider === 'transferencia' || o.metodoPago === 'transferencia') && 
            !o.comprobante
          )
          setPendingCount(missing.length)
          setTargetUrl('/admin/pedidos')
          return
        }

        if (user) {
          const orders = await getMisPedidos()
          const missing = (orders || []).filter(o => 
            o.estado === 'Pendiente' && 
            (o.paymentProvider === 'transferencia' || o.metodoPago === 'transferencia') && 
            !o.comprobante
          )
          setPendingCount(missing.length)
          setTargetUrl('/mis-pedidos')
          return
        }

        // Invitado sin cuenta
        const guestToken = localStorage.getItem('looserfit_guest_token')
        if (!guestToken) {
          setPendingCount(0)
          return
        }

        const guestOrder = await getOrderByToken(guestToken).catch(() => null)

        if (!guestOrder) {
          setPendingCount(0)
          return
        }

        // Si la orden ya está pagada o despachada, NO alertar y limpiar
        if (
          guestOrder.estado === 'Pagado' || 
          guestOrder.estado === 'Empaquetado' || 
          guestOrder.estado === 'Enviado' || 
          guestOrder.estado === 'Entregado' ||
          guestOrder.estado === 'Cancelado'
        ) {
          setPendingCount(0)
          return
        }

        // Solo alertar si el pedido es de transferencia y no tiene comprobante
        const esTransferencia = guestOrder.paymentProvider === 'transferencia' || guestOrder.metodoPago === 'transferencia'
        const tieneComprobante = guestOrder.hasComprobante || Boolean(guestOrder.comprobante)

        if (guestOrder.estado === 'Pendiente' && esTransferencia && !tieneComprobante) {
          setPendingCount(1)
          const targetOrderId = guestOrder._id || ''
          setTargetUrl(`/pedido-exito?orderId=${targetOrderId}&token=${guestToken}`)
        } else {
          setPendingCount(0)
        }
      } catch (err) {
        console.error('Error checking pending orders:', err)
      }
    }

    checkPending()
    const interval = setInterval(checkPending, 30000)
    return () => clearInterval(interval)
  }, [user, location.pathname, isAdmin])

  useEffect(() => {
    if (pendingCount > 0 && !dismissed) {
      document.body.classList.add('has-pending-alert')
    } else {
      document.body.classList.remove('has-pending-alert')
    }
  }, [pendingCount, dismissed])

  const handleDismiss = () => {
    setDismissed(true)
    sessionStorage.setItem('dismissed_receipt_alert', 'true')
  }

  if (pendingCount === 0 || dismissed) return null

  return (
    <div className="pending-alert-clean">
      <div className="container pending-alert-content">
        <div className="pending-alert-message">
          <span className="pending-dot"></span>
          <span>
            {isAdmin 
              ? `Hay ${pendingCount} ${pendingCount === 1 ? 'pedido por transferencia sin comprobante' : 'pedidos por transferencia sin comprobante'}.` 
              : 'Tenés un pedido pendiente de pago por transferencia.'}
          </span>
        </div>
        <div className="pending-alert-actions">
          <Link to={targetUrl} className="btn-alert-action">
            {isAdmin ? "Ver pedidos →" : "Subir comprobante →"}
          </Link>
          <button 
            type="button" 
            onClick={handleDismiss} 
            className="btn-dismiss-alert"
            title="Cerrar notificación"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  )
}
