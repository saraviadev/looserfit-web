import { createContext, useContext, useState, useCallback } from 'react'
import './Toast.css'

const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [confirmDialog, setConfirmDialog] = useState(null)

  const showToast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 5)
    setToasts(prev => [...prev, { id, message, type }])

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = {
    success: (msg, duration) => showToast(msg, 'success', duration),
    error: (msg, duration) => showToast(msg, 'error', duration),
    warning: (msg, duration) => showToast(msg, 'warning', duration),
    info: (msg, duration) => showToast(msg, 'info', duration),
  }

  // Sustituto moderno y no bloqueante para window.confirm
  const confirmModal = useCallback(({ title = '¿Estás seguro?', message, confirmText = 'Confirmar', cancelText = 'Cancelar', isDanger = false, onConfirm }) => {
    return new Promise((resolve) => {
      setConfirmDialog({
        title,
        message,
        confirmText,
        cancelText,
        isDanger,
        handleConfirm: () => {
          setConfirmDialog(null)
          if (onConfirm) onConfirm()
          resolve(true)
        },
        handleCancel: () => {
          setConfirmDialog(null)
          resolve(false)
        }
      })
    })
  }, [])

  return (
    <ToastContext.Provider value={{ toast, confirmModal }}>
      {children}

      {/* Renderizado de Toasts Flotantes */}
      <div className="toast-container" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast--${t.type}`}>
            <span className="toast__content">{t.message}</span>
            <button className="toast__close" onClick={() => removeToast(t.id)} aria-label="Cerrar">✕</button>
          </div>
        ))}
      </div>

      {/* Renderizado de Modal de Confirmación */}
      {confirmDialog && (
        <div className="custom-confirm-overlay" onClick={confirmDialog.handleCancel}>
          <div className="custom-confirm-modal" onClick={e => e.stopPropagation()}>
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="custom-confirm-actions">
              <button 
                type="button" 
                className="custom-confirm-btn custom-confirm-btn--cancel" 
                onClick={confirmDialog.handleCancel}
              >
                {confirmDialog.cancelText}
              </button>
              <button 
                type="button" 
                className={`custom-confirm-btn ${confirmDialog.isDanger ? 'custom-confirm-btn--danger' : 'custom-confirm-btn--confirm'}`} 
                onClick={confirmDialog.handleConfirm}
              >
                {confirmDialog.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fallback defensivo si se usa fuera del Provider
    return {
      toast: {
        success: (msg) => console.log('Toast success:', msg),
        error: (msg) => console.error('Toast error:', msg),
        warning: (msg) => console.warn('Toast warning:', msg),
        info: (msg) => console.log('Toast info:', msg)
      },
      confirmModal: ({ onConfirm }) => {
        if (onConfirm) onConfirm()
        return Promise.resolve(true)
      }
    }
  }
  return ctx
}
