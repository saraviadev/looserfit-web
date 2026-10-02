import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getProductoById } from '../../services/api'
import { useCart } from '../../context/CartContext'
import { useToast } from '../../context/ToastContext'
import { optimizeImage } from '../../utils/imageOptimizer'
import { trackViewContent, trackAddToCart } from '../../utils/pixel'
import './Producto.css'

export default function Producto() {
  const { id } = useParams()
  const [producto,    setProducto]    = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [imgActiva,   setImgActiva]   = useState(0)
  const [talleElegido,setTalleElegido]= useState('')
  const [showGuia,    setShowGuia]    = useState(false)
  const [lightbox,    setLightbox]    = useState(false)
  const [lbZoom,      setLbZoom]      = useState(1)
  const { addItem } = useCart()
  const { toast } = useToast()

  useEffect(() => {
    window.scrollTo(0, 0)
    getProductoById(id)
      .then(data => { setProducto(data); setLoading(false); trackViewContent(data) })
      .catch(err  => { setError(err.message); setLoading(false) })
  }, [id])

  // Bloquear scroll cuando el lightbox está abierto
  useEffect(() => {
    if (lightbox) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }
  }, [lightbox])

  const agregarAlCarrito = () => {
    if (!talleElegido) return toast.warning('Elegí un talle primero')
    addItem(producto, talleElegido, 1)
    trackAddToCart({ ...producto, talle: talleElegido })
    toast.success(`✓ ${producto.nombre} (${talleElegido}) agregado al carrito`)
  }

  if (loading) return (
    <div className="producto-page">
      <div className="container">
        <div className="producto-skeleton">
          <div className="skeleton producto-skeleton__img" />
          <div className="producto-skeleton__info">
            <div className="skeleton skeleton--text" />
            <div className="skeleton skeleton--text skeleton--short" />
          </div>
        </div>
      </div>
    </div>
  )

  if (error) return (
    <div className="producto-page">
      <div className="container">
        <p className="producto-error">Producto no encontrado.</p>
        <Link to="/tienda" className="btn">← Volver a la tienda</Link>
      </div>
    </div>
  )

  const precio = producto.precio?.toLocaleString('es-AR')
  const categoriaNombre = typeof producto.categoria === 'object' ? producto.categoria?.name : producto.categoria

  return (
    <div className="producto-page">
      <div className="container">

        {/* Breadcrumb */}
        <div className="breadcrumb">
          <Link to="/">Inicio</Link>
          <span>/</span>
          <Link to="/tienda">Tienda</Link>
          <span>/</span>
          <span>{producto.nombre}</span>
        </div>

        <div className="producto-layout">

          {/* Galería */}
          <div className={`producto-galeria ${producto.precioOferta ? 'producto-galeria--oferta' : ''}`}>
            {producto.precioOferta && producto.precioOferta > 0 && (
              <span className="producto-galeria__badge--oferta">OFERTA</span>
            )}
            <div 
              className="galeria__main"
              onClick={() => setLightbox(true)}
            >
              <img
                src={optimizeImage(producto.imagenes?.[imgActiva] || '/placeholder.jpg', 1000, 85)}
                alt={producto.nombre}
                className="galeria__img-main"
              />
              <div className="galeria__zoom-hint">Hacé click para ampliar</div>
            </div>
            {producto.imagenes?.length > 1 && (
              <div className="galeria__thumbs">
                {producto.imagenes.map((img, i) => (
                  <button
                    key={i}
                    className={`galeria__thumb ${imgActiva === i ? 'galeria__thumb--active' : ''}`}
                    onClick={() => setImgActiva(i)}
                  >
                    <img src={optimizeImage(img, 160, 75)} alt={`Vista ${i + 1}`} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="producto-info" style={{ display: 'flex', flexDirection: 'column' }}>
            <p className="producto-info__cat">{categoriaNombre}</p>
            <h1 className="producto-info__nombre">{producto.nombre}</h1>
            {producto.precioOferta ? (
              <div className="producto-info__precio-wrap">
                <span className="producto-info__precio--tachado">${precio}</span>
                <span className="producto-info__precio--oferta">${producto.precioOferta.toLocaleString('es-AR')}</span>
              </div>
            ) : (
              <p className="producto-info__precio">${precio}</p>
            )}

            <div className="producto-info__divider" />

            {/* Talles */}
            {producto.talles?.length > 0 && (
              <div className="producto-talles">
                <p className="producto-talles__label">
                  Talle
                  {talleElegido && <strong> — {talleElegido}</strong>}
                </p>
                <div className="producto-talles__grid">
                  {producto.talles.map(t => (
                    <button
                      key={t}
                      className={`talle-chip ${talleElegido === t ? 'talle-chip--active' : ''}`}
                      onClick={() => setTalleElegido(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                {producto.guiaTalles && (
                  <button 
                    type="button" 
                    className="guia-trigger"
                    onClick={() => setShowGuia(true)}
                  >
                    📏 Ver guía de talles
                  </button>
                )}
              </div>
            )}

            {/* Descripción */}
            {producto.descripcion && (
              <div className="producto-info__desc" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {producto.descripcion}
              </div>
            )}

            {/* Stock */}
            <p className={`producto-info__stock ${producto.stock === 0 ? 'producto-info__stock--agotado' : ''}`}>
              {producto.stock === 0 ? 'Sin stock' : `${producto.stock} disponibles`}
            </p>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Botón agregar */}
            <button
              className="btn btn-filled producto-info__cta"
              onClick={agregarAlCarrito}
              disabled={producto.stock === 0}
            >
              {producto.stock === 0 ? 'Sin stock' : 'Agregar al carrito'}
            </button>

            <div className="producto-info__divider" />

            {/* Info extra */}
            <div className="producto-extra">
              <div className="producto-extra__item">
                <span>📦</span>
                <span>Envíos a todo el país por Correo Argentino</span>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Lightbox / Full screen photo */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => { setLightbox(false); setLbZoom(1); }}>
          <button className="lightbox-close">✕</button>
          
          {producto.imagenes?.length > 1 && (
            <>
              <button 
                className="lightbox-nav lightbox-nav--prev" 
                onClick={(e) => {
                  e.stopPropagation();
                  setImgActiva(prev => (prev === 0 ? producto.imagenes.length - 1 : prev - 1));
                }}
              >
                ‹
              </button>
              <button 
                className="lightbox-nav lightbox-nav--next" 
                onClick={(e) => {
                  e.stopPropagation();
                  setImgActiva(prev => (prev === producto.imagenes.length - 1 ? 0 : prev + 1));
                }}
              >
                ›
              </button>
            </>
          )}

          <div className="lightbox-content" onClick={e => e.stopPropagation()}>
            <img 
              src={producto.imagenes?.[imgActiva]} 
              alt="Zoom view" 
              className="lightbox-img"
              style={{ transform: `scale(${lbZoom})` }}
              onClick={() => setLbZoom(lbZoom === 1 ? 2 : 1)}
            />
            <p className="lightbox-hint">Tocá la foto para hacer zoom</p>
          </div>
        </div>
      )}

      {/* Modal Guía de Talles */}
      {showGuia && (
        <div className="guia-modal-overlay" onClick={() => setShowGuia(false)}>
          <div className="guia-modal" onClick={e => e.stopPropagation()}>
            <button className="guia-modal__close" onClick={() => setShowGuia(false)}>✕</button>
            <h3 className="guia-modal__title">Guía de Talles</h3>
            <div className="guia-modal__content">
              {producto.guiaTalles?.startsWith('http') ? (
                <img src={producto.guiaTalles} alt="Guía de talles" className="guia-modal__img" />
              ) : (
                <pre className="guia-modal__text">
                  {producto.guiaTalles}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}