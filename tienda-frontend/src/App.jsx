/**
 * App.jsx — Punto de entrada de rutas del frontend.
 * Implementa el ruteo multi-marca:
 * - Looser Fit: rutas en /
 * - Looser Sport: rutas en /sport
 * Ambas marcas usan los mismos componentes pero con su BrandProvider propio.
 */

import { useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { BrandProvider, useBrand } from './context/BrandContext'
import Navbar from './components/Navbar/Navbar'
import Footer from './components/Footer/Footer'
import Home from './pages/Home/Home'
import Tienda from './pages/Tienda/Tienda'
import Producto from './pages/Producto/Producto'
import AdminLayout from './pages/Admin/AdminLayout'
import AdminDashboard from './pages/Admin/AdminDashboard'
import AdminProductos from './pages/Admin/AdminProductos'
import AdminNuevoProducto from './pages/Admin/AdminNuevoProducto'
import AdminPedidos from './pages/Admin/AdminPedidos'
import AdminPedido from './pages/Admin/AdminPedido'
import AdminHome from './pages/Admin/AdminHome'
import AdminNewsletter from './pages/Admin/AdminNewsletter'
import Carrito from './pages/Carrito/Carrito'
import AuthModal from './components/AuthModal/AuthModal'
import Checkout from './pages/Checkout/Checkout'
import PedidoExito from './pages/PedidoExito/PedidoExito'
import MisPedidos from './pages/MisPedidos/MisPedidos'
import TrackingPedido from './pages/Tracking/TrackingPedido'
import NotFound from './pages/NotFound/NotFound'
import PendingReceiptAlert from './components/PendingReceiptAlert/PendingReceiptAlert'
import { getHomeContent } from './services/api'

// ─── Pantalla de Coming Soon ───────────────────────────────────────────────

function ComingSoonScreen({ launchDate, message, subtitle, onAuthClick }) {
  const [, setTick] = useState(0)
  const currentTimeRef = useRef(0)

  useEffect(() => {
    currentTimeRef.current = Date.now()
    const interval = setInterval(() => {
      currentTimeRef.current = Date.now()
      setTick((t) => t + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // eslint-disable-next-line react-hooks/purity
  const currentTime = currentTimeRef.current || Date.now()
  const remaining = Math.max(new Date(launchDate).getTime() - currentTime, 0)
  const days = Math.floor(remaining / 86400000)
  const hours = Math.floor((remaining % 86400000) / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)

  const formatted = `${days > 0 ? `${days}d ` : ''}${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`

  return (
    <div className="coming-soon-overlay">
      <div className="coming-soon-grid">
        <div>
          <h1 style={{ fontSize: 'clamp(2.5rem, 4vw, 4.5rem)', margin: '0 0 1rem', lineHeight: 1.05 }}>{message || ''}</h1>
          {subtitle && <p style={{ fontSize: '1rem', color: '#d3d3d3', marginBottom: '1.8rem' }}>{subtitle}</p>}
          <p style={{ fontSize: 'clamp(2rem, 3vw, 3rem)', fontWeight: 700, marginBottom: '1rem', color: '#ffffff' }}>{formatted}</p>
        </div>

        <div className="coming-soon-box">
          <div>
            <h2 style={{ fontSize: '1.1rem', margin: '0 0 0.75rem' }}>Aviso por email</h2>
            <p style={{ margin: 0, color: '#ddd', lineHeight: 1.7 }}>
              Iniciá sesión o registrate para recibir un aviso automático por Gmail cuando la web vuelva.
            </p>
          </div>
          <button
            type="button"
            onClick={onAuthClick}
            className="coming-soon-button"
          >
            Recibir aviso por Gmail
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Gate público (maneja coming soon por marca) ───────────────────────────

function PublicGate({ children, homeLoading, comingSoon, onAuthClick }) {
  if (homeLoading) return <div style={{ height: '100vh', background: '#0a0a0a' }} />;
  const active = Boolean(comingSoon?.enabled && comingSoon?.launchDate && new Date(comingSoon.launchDate) > new Date())
  
  if (active) {
    return (
      <>
        <Navbar />
        <main style={{ pointerEvents: 'none' }}>
          <Home />
        </main>
        <ComingSoonScreen
          launchDate={comingSoon.launchDate}
          message={comingSoon.message}
          subtitle={comingSoon.subtitle}
          onAuthClick={onAuthClick}
        />
      </>
    )
  }
  
  return children
}

// ─── Rutas de una marca (componente reutilizable) ──────────────────────────
// pathPrefix: '' para Fit, '/sport' para Sport

function BrandRoutes({ pathPrefix }) {
  const { brand, loading: brandLoading } = useBrand()
  const [homeContent, setHomeContent] = useState(null)
  const [homeLoading, setHomeLoading] = useState(true)
  const [authOpen, setAuthOpen] = useState(false)
  const location = useLocation()

  // Cargar el HomeContent de esta marca usando el brand slug del contexto
  useEffect(() => {
    if (brandLoading) return
    const slug = brand?.slug || 'fit'
    getHomeContent(slug)
      .then(data => setHomeContent(data))
      .catch(() => setHomeContent(null))
      .finally(() => setHomeLoading(false))
  }, [brand?.slug, brandLoading])

  const comingSoon = homeContent?.comingSoon
  const isLaunchActive = Boolean(comingSoon?.enabled && comingSoon?.launchDate && new Date(comingSoon.launchDate) > new Date())

  // Recargar si el lanzamiento terminó
  useEffect(() => {
    if (!isLaunchActive) return
    const interval = setInterval(() => {
      const launchDate = new Date(comingSoon?.launchDate).getTime()
      if (launchDate <= Date.now()) {
        const slug = brand?.slug || 'fit'
        getHomeContent(slug)
          .then(data => setHomeContent(data))
          .catch(() => setHomeContent(null))
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [isLaunchActive, comingSoon?.launchDate, brand?.slug])

  // Bloquear scroll en coming soon
  useEffect(() => {
    const isAdminRoute = location.pathname.startsWith('/admin')
    if (isLaunchActive && !isAdminRoute) {
      document.body.style.overflow = 'hidden'
      document.documentElement.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
      document.documentElement.style.overflow = ''
    }
  }, [isLaunchActive, location.pathname])

  // Abrir auth si viene en el state de navegación
  useEffect(() => {
    if (location.state?.openAuth) {
      setTimeout(() => setAuthOpen(true), 0)
      window.history.replaceState({}, document.title)
    }
  }, [location.state?.openAuth])

  const publicGateProps = { homeLoading, comingSoon, onAuthClick: () => setAuthOpen(true) }
  const p = pathPrefix // shorthand

  return (
    <>
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
      <PendingReceiptAlert />
      <Routes>
        {/* Rutas públicas de esta marca */}
        <Route path={`${p}/`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><Home /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/tienda`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><Tienda /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/producto/:id`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><Producto /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/carrito`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><Carrito /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/checkout`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><Checkout /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/pedido-exito`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><PedidoExito /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/mis-pedidos`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><MisPedidos /></main>
            <Footer />
          </PublicGate>
        }/>
        <Route path={`${p}/seguimiento/:token`} element={
          <PublicGate {...publicGateProps}>
            <Navbar />
            <main><TrackingPedido /></main>
            <Footer />
          </PublicGate>
        }/>
      </Routes>
    </>
  )
}

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    // Override CSS smooth scrolling for instant jump on route change
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    
    // Restore smooth scrolling for anchor links after jump
    const timer = setTimeout(() => {
      document.documentElement.style.scrollBehavior = '';
    }, 50);

    return () => clearTimeout(timer);
  }, [pathname, search]);
  return null;
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
      {/* ── Rutas de Looser Fit (marca principal, pathPrefix vacío) ── */}
      <Route path="/*" element={
        <BrandProvider brandSlug="fit">
          <BrandRoutes pathPrefix="" />
        </BrandProvider>
      }/>

      {/* ── Rutas de Looser Sport ── */}
      <Route path="/sport/*" element={
        <BrandProvider brandSlug="sport">
          <BrandRoutes pathPrefix="" />
        </BrandProvider>
      }/>

      {/* ── Panel de administración (sin marca pública, sin Navbar/Footer) ── */}
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<AdminDashboard />} />
        <Route path="productos" element={<AdminProductos />} />
        <Route path="productos/nuevo" element={<AdminNuevoProducto />} />
        <Route path="productos/editar/:id" element={<AdminNuevoProducto />} />
        <Route path="home" element={<AdminHome />} />
        <Route path="pedidos" element={<AdminPedidos />} />
        <Route path="pedidos/:id" element={<AdminPedido />} />
        <Route path="newsletter" element={<AdminNewsletter />} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  )
}

export default App