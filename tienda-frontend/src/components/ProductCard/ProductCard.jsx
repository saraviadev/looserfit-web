import { Link } from 'react-router-dom'
import { optimizeImage } from '../../utils/imageOptimizer'
import './ProductCard.css'

export default function ProductCard({ producto, loading = false }) {
  if (loading) {
    return (
      <div className="product-card product-card--skeleton">
        <div className="product-card__img-wrap skeleton" />
        <div className="product-card__info">
          <div className="skeleton skeleton--text" />
          <div className="skeleton skeleton--text skeleton--short" />
        </div>
      </div>
    )
  }

  const imagen = optimizeImage(producto.imagenes?.[0] || '/placeholder.jpg', 600, 80)
  const precio = producto.precio?.toLocaleString('es-AR')
  const precioOferta = producto.precioOferta?.toLocaleString('es-AR')
  const tieneOferta = producto.precioOferta && producto.precioOferta > 0

  return (
    <Link to={`/producto/${producto._id}`} className={`product-card ${tieneOferta ? 'product-card--oferta' : ''}`}>
      <div className="product-card__img-wrap">
        <img
          src={imagen}
          alt={producto.nombre}
          className="product-card__img"
          loading="lazy"
        />
        {producto.esNuevoDrop && !tieneOferta && (
          <span className="product-card__badge">Nuevo</span>
        )}
        {tieneOferta && (
          <span className="product-card__badge product-card__badge--oferta">
            OFERTA
          </span>
        )}
        {producto.stock === 0 && (
          <span className="product-card__badge product-card__badge--agotado">
            Sin stock
          </span>
        )}
        <div className="product-card__hover">
          <span>Ver producto</span>
        </div>
      </div>
      <div className="product-card__info">
        <p className="product-card__categoria">
          {typeof producto.categoria === 'object' ? producto.categoria?.name : producto.categoria}
        </p>
        <h3 className="product-card__nombre">{producto.nombre}</h3>
        {tieneOferta ? (
          <div className="product-card__precio-wrap">
            <span className="product-card__precio product-card__precio--tachado">${precio}</span>
            <span className="product-card__precio product-card__precio--oferta">${precioOferta}</span>
          </div>
        ) : (
          <p className="product-card__precio">${precio}</p>
        )}
      </div>
    </Link>
  )
}