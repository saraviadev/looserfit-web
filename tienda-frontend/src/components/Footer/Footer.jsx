import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getBrandConfig } from '../../config/siteConfig'
import { useBrand } from '../../context/BrandContext'
import './Footer.css'

const INFOS = {
  'como-comprar': {
    title: 'Cómo comprar en Looser',
    badge: 'Guía de compra',
    sections: [
      {
        heading: '1. Elegí tus prendas',
        text: 'Navegá por nuestra tienda, seleccioná el modelo y consultá la tabla de medidas en la ficha de cada producto para elegir tu talle ideal.'
      },
      {
        heading: '2. Agregá al carrito',
        text: 'Hacé click en "Agregar al carrito". Podés seguir sumando prendas de la misma marca o avanzar directamente al checkout.'
      },
      {
        heading: '3. Datos de envío',
        text: 'Completá tus datos postales reales. Podés elegir entre retiro en sucursal oficial de Correo Argentino ($7.500) o envío directo a tu domicilio ($11.000).'
      },
      {
        heading: '4. Medio de pago',
        text: 'Aboná de forma segura con dinero en cuenta o tarjetas a través de Mercado Pago, o seleccioná Transferencia Bancaria.'
      },
      {
        heading: '5. Confirmación y seguimiento',
        text: 'Una vez acreditado el pago, tu orden entra en preparación. Recibirás un email con el código de seguimiento de Correo Argentino para rastrear tu paquete en todo momento.'
      }
    ]
  },
  'envios': {
    title: 'Envíos y Logística',
    badge: 'Correo Argentino',
    sections: [
      {
        heading: 'Cobertura nacional',
        text: 'Realizamos envíos a todo el territorio de la República Argentina a través de Correo Argentino.'
      },
      {
        heading: 'Costos vigentes',
        text: '• Retiro en sucursal de Correo Argentino: $7.500\n• Envío directo a domicilio: $11.000\nLos costos son fijos y se abonan junto con el pedido al momento del checkout.'
      },
      {
        heading: 'Plazos de despacho y entrega',
        text: 'Los pedidos se despachan al siguiente día hábil posterior a la acreditación del pago (las compras realizadas durante el fin de semana se despachan lunes o martes). Una vez despachado, el tiempo de entrega habitual de Correo Argentino oscila entre 3 y 6 días hábiles según la localidad de destino.'
      },
      {
        heading: 'Seguimiento en tiempo real',
        text: 'Apenas despachamos tu pedido, te enviamos por correo electrónico el código de seguimiento (tracking ID) para que puedas consultar el estado de tu encomienda en la web oficial de Correo Argentino.'
      }
    ]
  },
  'cambios': {
    title: 'Cambios y Devoluciones',
    badge: 'Política de la tienda',
    text: 'ANTES DE REALIZAR LA COMPRA, CHEQUEA DETALLADAMENTE LAS MEDIDAS, FOTOS Y ESTADO DE LA PRENDA!!! RECORDÁ QUE NO HAY CAMBIOS NI DEVOLUCIONES <3'
  },
  'terminos': {
    title: 'Términos y Condiciones Generales',
    badge: 'Términos de servicio',
    sections: [
      {
        heading: 'Aceptación de las condiciones',
        text: 'El uso de este sitio web y la adquisición de cualquier producto a través de nuestra tienda online implica la aceptación plena de los presentes Términos y Condiciones.'
      },
      {
        heading: 'Precios y facturación',
        text: 'Todos los precios publicados en el sitio están expresados en Pesos Argentinos (ARS) e incluyen los impuestos correspondientes. Nos reservamos el derecho de modificar precios, promociones y disponibilidad sin previo aviso.'
      },
      {
        heading: 'Disponibilidad y stock',
        text: 'La concreción de la compra queda sujeta a la disponibilidad efectiva de stock al momento de la acreditación del pago. En caso de quiebre de stock fortuito, se reintegrará de inmediato el 100% del dinero abonado por el mismo medio de pago.'
      },
      {
        heading: 'Responsabilidad y fuerza mayor',
        text: 'Nos comprometemos al correcto acondicionamiento y despacho del paquete en tiempo y forma. La empresa no será responsable por demoras extraordinarias imputables exclusivamente al operador postal o a contingencias climáticas/fuerza mayor.'
      }
    ]
  },
  'privacidad': {
    title: 'Política de Privacidad y Protección de Datos',
    badge: 'Privacidad',
    sections: [
      {
        heading: 'Confidencialidad y resguardo',
        text: 'Te garantizamos que la información suministrada al operar en nuestra tienda se encuentra bajo estricto resguardo y confidencialidad.'
      },
      {
        heading: 'Finalidad de los datos',
        text: 'Los datos requeridos (nombre, apellido, DNI, dirección, teléfono, email) son utilizados únicamente para procesar tus pedidos, coordinar los envíos postales y remitirte actualizaciones de tu compra.'
      },
      {
        heading: 'No cesión a terceros',
        text: 'Bajo ninguna circunstancia vendemos, alquilamos ni cedemos tus datos personales a empresas de publicidad o bases de datos comerciales de terceros.'
      }
    ]
  }
}

export default function Footer() {
  const [infoOpen, setInfoOpen] = useState(null)
  const { brand } = useBrand()
  const config = getBrandConfig(brand?.slug)
  const basePath = brand?.slug === 'sport' ? '/sport' : ''

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__inner">

          {/* Marca & Logo */}
          <div className="footer__brand">
            <div className="footer__logo-wrap">
              <Link to={basePath || '/'} aria-label="Ir al inicio de la tienda">
                <img
                  src={config.assets.logo}
                  alt={config.name}
                  className="footer__logo"
                  width="72"
                  height="72"
                  loading="lazy"
                />
              </Link>
            </div>
            <p className="footer__location">
              {config.contact?.address || 'Buenos Aires, Argentina'}
            </p>
            <p className="footer__brand-desc">
              {config.tagline || 'Indumentaria urbana y deportiva.'}
            </p>
          </div>

          {/* Navegación Tienda */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Tienda</h4>
            <ul>
              <li><Link to={`${basePath}/tienda`}>Todos los productos</Link></li>
            </ul>
          </div>

          {/* Información */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Información</h4>
            <ul>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('como-comprar')}>Cómo comprar</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('envios')}>Envíos y Logística</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('cambios')}>Cambios y Devoluciones</button></li>
            </ul>
          </div>

          {/* Legales */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Legales</h4>
            <ul>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('terminos')}>Términos y Condiciones</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('privacidad')}>Privacidad</button></li>
            </ul>
          </div>

          {/* Soporte y Redes */}
          <div className="footer__social">
            <h4 className="footer__nav-title">Contacto</h4>
            <p className="footer__soporte">
              Escribinos por Instagram al{' '}
              <a
                href={`https://www.instagram.com/${config.socials.instagram.replace('@', '')}`}
                target="_blank"
                rel="noreferrer"
                className="footer__dm-link"
              >
                DM
              </a>
              {' '}o a nuestro email oficial.
            </p>
            <div className="footer__social-links" style={{ marginTop: '0.8rem' }}>
              <a href={`https://www.instagram.com/${config.socials.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">
                Instagram Oficial ↗
              </a>
            </div>
          </div>

        </div>

        {/* Copyright & Créditos */}
        <div className="footer-content">
          <p>© {new Date().getFullYear()} {config.name} — Todos los derechos reservados · Buenos Aires, Argentina</p>
          <p className="credit">
            Creado por{' '}
            <a href="https://instagram.com/saravia.devv" target="_blank" rel="noreferrer" className="credit__link">
              Theo Saravia <span className="credit__icon">↗</span>
            </a>
          </p>
        </div>
      </div>

      {/* ── MODAL LEGALES / INFO ── */}
      {infoOpen && (
        <div className="footer-modal-overlay" onClick={() => setInfoOpen(null)}>
          <div className="footer-modal" onClick={e => e.stopPropagation()}>
            <div className="footer-modal__header">
              <div>
                <span className="footer-modal__badge">
                  {INFOS[infoOpen]?.badge}
                </span>
                <h3 className="footer-modal__title">
                  {INFOS[infoOpen]?.title}
                </h3>
              </div>
              <button type="button" className="footer-modal__close" onClick={() => setInfoOpen(null)} aria-label="Cerrar modal">✕</button>
            </div>

            <div className="footer-modal__body">
              {INFOS[infoOpen]?.sections ? (
                <div className="legal-doc">
                  {INFOS[infoOpen]?.sections.map((sec, idx) => (
                    <div key={idx} className="legal-doc__section">
                      <h5 className="legal-doc__heading">{sec.heading}</h5>
                      <p className="legal-doc__text">{sec.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="legal-doc" style={{ padding: '1.2rem 0' }}>
                  <p style={{ fontSize: '0.95rem', lineHeight: '1.8', color: 'var(--color-text, #fff)', fontWeight: 600 }}>
                    {INFOS[infoOpen]?.text}
                  </p>
                </div>
              )}
            </div>

            <div className="footer-modal__footer">
              <button type="button" className="btn btn--secondary" onClick={() => setInfoOpen(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}
