
function IconUndo() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  )
}

import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { AdminBrandProvider, useAdminBrand } from '../../context/AdminBrandContext'
import { ALL_BRANDS } from '../../config/brandConfig'
import { getBrandConfig } from '../../config/siteConfig'
import './AdminLayout.css'

export default function AdminLayout() {
  const { user, login, logout, loading } = useAuth()
  const [usuario, setUsuario] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Cerrar el drawer cada vez que cambia de página
  useEffect(() => {
    setTimeout(() => setMenuOpen(false), 0)
    document.body.style.overflow = ''
  }, [location])

  // Bloquear scroll del body cuando el menú mobile está abierto
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  useEffect(() => {
    document.title = `Panel Admin — Looser`
    return () => { document.title = 'Looser Fit' }
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    try {
      const userData = await login(usuario, contrasena)
      if (!userData.isAdmin) {
        logout()
        setError('No tenés permisos de administrador.')
      } else {
        setError('')
      }
    } catch (err) {
      setError(err.message)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/admin')
  }

  const openMenu = () => setMenuOpen(true)
  const closeMenu = () => setMenuOpen(false)

  if (loading) {
    return (
      <div className="admin-loading">
        <p>Cargando...</p>
      </div>
    )
  }

  // ── LOGIN ──
  if (!user || !user.isAdmin) {
    return (
      <div className="admin-login">
        <div className="admin-login__box">
          <div className="admin-login__logo">
            <img src="/logo3.0.png" alt="Looser" />
          </div>
          <h2 className="admin-login__title">Panel Admin</h2>
          <p className="admin-login__sub">Ingresá a tu panel de control</p>

          <form onSubmit={handleLogin} className="admin-login__form">
            <div className="admin-field">
              <label>Usuario</label>
              <input
                type="text"
                value={usuario}
                onChange={e => setUsuario(e.target.value)}
                placeholder="looser.fit"
                autoComplete="username"
              />
            </div>
            <div className="admin-field">
              <label>Contraseña</label>
              <input
                type="password"
                value={contrasena}
                onChange={e => setContrasena(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>
            {error && <p className="admin-login__error">{error}</p>}
            <button type="submit" className="admin-login__btn">
              Entrar al Panel
            </button>
          </form>
        </div>
      </div>
    )
  }

  // ── PANEL ──
  return (
    <AdminBrandProvider>
      <AdminPanelContent
        menuOpen={menuOpen}
        openMenu={openMenu}
        closeMenu={closeMenu}
        handleLogout={handleLogout}
      />
    </AdminBrandProvider>
  )
}

// Componente interno que consume el AdminBrandContext
function AdminPanelContent({ menuOpen, openMenu, closeMenu, handleLogout }) {
  const { activeBrand, switchBrand } = useAdminBrand()
  const brandConfig = getBrandConfig(activeBrand)

  return (
    <div className={`admin-wrapper ${menuOpen ? 'admin-wrapper--menu-open' : ''}`}>

      {/* Overlay para cerrar en mobile — solo se renderiza si está abierto */}
      <div
        className="admin-sidebar-overlay"
        onClick={closeMenu}
        aria-hidden="true"
      />

      {/* ── SIDEBAR ── */}
      <aside className="admin-sidebar">
        <div className="admin-sidebar__top">
          <img src={brandConfig.assets.logo} alt={brandConfig.name} className="admin-sidebar__logo" />
          <span className="admin-sidebar__tag">Admin</span>
          <button className="admin-sidebar__close" onClick={closeMenu}>✕</button>
        </div>

        {/* ── Selector de marca ── */}
        <div className="admin-brand-selector">
          {ALL_BRANDS.map(b => (
            <button
              key={b.slug}
              type="button"
              className={`admin-brand-btn ${activeBrand === b.slug ? 'admin-brand-btn--active' : ''}`}
              onClick={() => switchBrand(b.slug)}
            >
              {b.name}
            </button>
          ))}
        </div>

        <nav className="admin-nav">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconGrid /> Panel
          </NavLink>

          <NavLink
            to="/admin/productos"
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconBox /> Productos
          </NavLink>

          <NavLink
            to="/admin/home"
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconHome /> Home
          </NavLink>

          <NavLink
            to="/admin/pedidos"
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconOrders /> Pedidos
          </NavLink>

          <NavLink
            to="/admin/arrepentimientos"
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconUndo /> Arrepentimiento
          </NavLink>

          <NavLink
            to="/admin/newsletter"
            className={({ isActive }) =>
              `admin-nav__link ${isActive ? 'admin-nav__link--active' : ''}`
            }
          >
            <IconMail /> Noticias
          </NavLink>
        </nav>

        <div className="admin-sidebar__bottom">
          <Link to="/" className="admin-sidebar__back">
            ← Volver a la tienda
          </Link>
          <button className="admin-sidebar__logout" onClick={handleLogout}>
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* ── CONTENIDO ── */}
      <div className="admin-content">

        {/* Topbar */}
        <div className="admin-topbar">
          <button
            className="admin-menu-toggle"
            onClick={openMenu}
            aria-label="Abrir menú"
          >
            <IconMenu />
          </button>

          <span className="admin-topbar__title">
            {brandConfig.name} <span style={{ opacity: 0.45, fontSize: '0.8em' }}>Admin 👑</span>
          </span>

          <div className="admin-topbar__avatar">
            <img src={brandConfig.assets.adminAvatar} alt={brandConfig.name} />
          </div>
        </div>

        {/* Cuerpo */}
        <div className="admin-body">
          <Outlet />
        </div>
      </div>

    </div>
  )
}

/* ── ÍCONOS ── */
function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  )
}

function IconBox() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    </svg>
  )
}

function IconOrders() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 3h6" />
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M8 10h8M8 14h8" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  )
}

function IconMail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  )
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}