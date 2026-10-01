import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { useBrand } from '../../context/BrandContext'
import { getMisPedidos } from '../../services/api'
import AuthModal from '../AuthModal/AuthModal'
import { getBrandConfig } from '../../config/siteConfig'
import { ALL_BRANDS } from '../../config/brandConfig'
import BrandLogoSwitcher from '../BrandLogoSwitcher/BrandLogoSwitcher'
import './Navbar.css'

export default function Navbar() {
  const navigate = useNavigate()
  const [scrolled,     setScrolled]     = useState(false)
  const [drawerOpen,   setDrawerOpen]   = useState(false)
  const [searchOpen,   setSearchOpen]   = useState(false)
  const [searchQuery,  setSearchQuery]  = useState('')
  const [authOpen,     setAuthOpen]     = useState(false)
  const { user } = useAuth()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [lastSeenNotif, setLastSeenNotif] = useState(() => {
    try { return localStorage.getItem('looserfit_last_seen_notif') || '1970-01-01' } catch { return '1970-01-01' }
  })

  // Condición real de notificación pendiente / no leída:
  // 1) Algún pedido pendiente de comprobante de pago
  // 2) Algún pedido actualizado posteriormente al último click en la campana
  const hasUnreadNotification = Boolean(
    user && (misPedidos || []).some(p => {
      const needsReceipt = p.estado === 'Pendiente' && !p.comprobante
      const lastUpdate = p.updatedAt ? new Date(p.updatedAt).getTime() : 0
      const seenTime = new Date(lastSeenNotif).getTime()
      const isNewUpdate = lastUpdate > seenTime
      return needsReceipt || isNewUpdate
    })
  )

  const toggleNotifications = () => {
    const nextState = !notificationsOpen
    setNotificationsOpen(nextState)
    if (nextState) {
      const now = new Date().toISOString()
      try { localStorage.setItem('looserfit_last_seen_notif', now) } catch {}
      setLastSeenNotif(now)
    }
  }

  const [misPedidos, setMisPedidos] = useState([])
  const { totalItems } = useCart()
  // Multi-marca: obtener datos de la marca activa
  const { brand } = useBrand()
  const brandConfig = getBrandConfig(brand?.slug)

  // Efecto scroll
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Cargar pedidos si está logueado y abre notificaciones
  useEffect(() => {
    if (user && notificationsOpen) {
      getMisPedidos()
        .then(setMisPedidos)
        .catch(console.error)
    }
  }, [user, notificationsOpen])

  const openDrawer = () => {
    setDrawerOpen(true)
    document.body.style.overflow = 'hidden'
  }

  const closeDrawer = () => {
    setDrawerOpen(false)
    document.body.style.overflow = ''
  }

  return (
    <>
      {/* Overlay */}
      {drawerOpen && (
        <div className="nav-overlay" onClick={closeDrawer} />
      )}

      {/* Navbar principal */}
      <nav className={`navbar ${scrolled ? 'navbar--scrolled' : 'navbar--transparent'}`}>
        <div className="navbar__inner">

          {/* Izquierda */}
          <div className="navbar__left">
            <button
              className={`hamburger ${drawerOpen ? 'hamburger--active' : ''}`}
              onClick={openDrawer}
              aria-label="Menú"
            >
              <span /><span /><span />
            </button>

            {/* Icono usuario/login */}
            <button className={`icon-btn ${user ? 'icon-btn--active' : ''}`} aria-label="Mi cuenta" onClick={() => setAuthOpen(true)}>
              {user ? (
                <div className="user-avatar-small">
                  {user.nombre.charAt(0).toUpperCase()}
                </div>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                    stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              )}
            </button>

            {/* Campana de Notificaciones */}
            {user && (
              <div className="nav-notifications">
                <button 
                  className={`icon-btn ${notificationsOpen ? 'icon-btn--active' : ''}`} 
                  onClick={toggleNotifications}
                >
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                  </svg>
                  {hasUnreadNotification && <span className="notif-badge"></span>}
                </button>

                {notificationsOpen && (
                  <div className="notifications-dropdown">
                    <h3>Mis Pedidos</h3>
                    {(!misPedidos || misPedidos.length === 0) ? (
                      <p className="no-notif">No tienes pedidos recientes.</p>
                    ) : (
                      (misPedidos || []).map(p => (
                        <div key={p._id} className={`notification-item ${p.estado === 'Pendiente' && !p.comprobante ? 'notification-item--alert' : ''}`}>
                          <p><strong>Pedido #</strong>{p.orderNumber || p._id.slice(-6).toUpperCase()}</p>
                          <p>
                            <strong>Estado: </strong>
                            <span className={`status-badge status-${p.estado.toLowerCase()}`}>
                              {p.estado === 'Empaquetado' ? '📦 Listo para despacho' : 
                               p.estado === 'Pagado' ? '✅ Pago aprobado' : p.estado}
                            </span>
                          </p>
                          {p.estado === 'Pendiente' && !p.comprobante && (
                            <div className="notif-alert-box">
                              <p>⚠️ Falta subir el comprobante de pago</p>
                              <Link to={`/pedido-exito?orderId=${p._id}`} className="notif-alert-link" onClick={() => setNotificationsOpen(false)}>
                                Subir ahora →
                              </Link>
                            </div>
                          )}
                          {p.estado === 'Enviado' && p.trackingNumber && (
                            <div className="notif-tracking">
                              <p>Cód Seg: <strong>{p.trackingNumber}</strong></p>
                              <a 
                                href={`https://www.correoargentino.com.ar/seguimiento-de-envios`} 
                                target="_blank" 
                                rel="noreferrer"
                                className="tracking-link-btn"
                              >
                                Rastrear envío
                              </a>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            
            <ul className="navbar__links">
              <li><Link to={brand?.slug === 'sport' ? '/sport/tienda' : '/tienda'} onClick={closeDrawer}>Tienda</Link></li>
            </ul>

          </div>

          {/* Logo centro — usando framer motion */}
          <div className="navbar__logo">
            <BrandLogoSwitcher />
          </div>

          {/* Derecha */}
          <div className="navbar__right">
            <button className="icon-btn" aria-label="Buscar" onClick={() => setSearchOpen(true)}>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                   stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <Link to="/carrito" className="cart-btn" aria-label="Carrito">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2"
                   stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              {totalItems > 0 && (
                <span className="cart-badge">{totalItems}</span>
              )}
            </Link>
          </div>

        </div>
      </nav>

      {/* Drawer mobile */}
      <aside className={`drawer ${drawerOpen ? 'drawer--open' : ''}`}>
        <div className="drawer__header">
          <img src={brandConfig.assets.logo} alt={brandConfig.name} className="drawer__logo" />
          <button className="drawer__close" onClick={closeDrawer}>✕</button>
        </div>
        <ul className="drawer__links">
          <li><Link to="/" onClick={closeDrawer}>Inicio</Link></li>
          <li><Link to="/tienda" onClick={closeDrawer}>Tienda</Link></li>
        </ul>
        <div className="drawer__footer">
          Buenos Aires, Argentina<br />
          {brandConfig.socials?.instagram || '@looserfit'}
        </div>
      </aside>

      {/* Search overlay */}
      {searchOpen && (
        <div className="search-overlay" onClick={() => setSearchOpen(false)}>
          <div className="search-box" onClick={e => e.stopPropagation()}>
            <input
              type="search"
              placeholder="Buscar productos..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  navigate(`/tienda${searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : ''}`)
                  setSearchOpen(false)
                  setSearchQuery('')
                }
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              autoFocus
            />
            <button type="button" className="search-close" onClick={() => setSearchOpen(false)}>✕</button>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
    </>
  )
}