import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getBrandConfig } from '../../config/siteConfig'
import { crearSolicitudArrepentimiento } from '../../services/api'
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
    title: 'Garantía Legal',
    badge: 'Ley N° 24.240',
    sections: [
      {
        heading: 'Garantía legal de fabricación',
        text: 'Todas nuestras prendas cuentan con garantía legal conforme a la Ley N° 24.240 de Defensa del Consumidor por cualquier falla, rotura o defecto de confección.'
      },
      {
        heading: 'Prendas con detalles informados',
        text: 'Nuestras prendas se publican con sus medidas exactas y fotos claras de sus particularidades. Al tratarse de piezas únicas cuyas características se exhiben detalladamente antes de la compra, los detalles previamente informados no constituyen motivo de cambio.'
      }
    ]
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
    badge: 'Ley N° 25.326',
    sections: [
      {
        heading: 'Cumplimiento legal y confidencialidad',
        text: 'En cumplimiento de la Ley N° 25.326 de Protección de los Datos Personales de la República Argentina, te garantizamos que la información suministrada al operar en nuestra tienda se encuentra bajo estricto resguardo y confidencialidad.'
      },
      {
        heading: 'Finalidad de la recolección',
        text: 'Los datos requeridos (nombre, apellido, DNI, dirección, teléfono, email) son utilizados únicamente para procesar tus pedidos, emitir comprobantes de compra, coordinar los envíos postales y remitirte actualizaciones de tu compra.'
      },
      {
        heading: 'No cesión a terceros',
        text: 'Bajo ninguna circunstancia vendemos, alquilamos ni cedemos tus datos personales a empresas de publicidad o bases de datos comerciales de terceros.'
      },
      {
        heading: 'Derechos ARCO (Acceso, Rectificación, Supresión)',
        text: 'Como titular de los datos, tenés derecho a acceder a los mismos, solicitar su actualización, rectificación o eliminación definitiva en cualquier momento mediante comunicación por escrito a looserfit2004@gmail.com.'
      },
      {
        heading: 'Órgano de control',
        text: 'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA (AAIP), en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.'
      }
    ]
  }
}

export default function Footer() {
  const [infoOpen, setInfoOpen] = useState(null)
  const { brand } = useBrand()
  const config = getBrandConfig(brand?.slug)
  const basePath = brand?.slug === 'sport' ? '/sport' : ''

  // Estado del formulario de arrepentimiento
  const [arrNombre, setArrNombre] = useState('')
  const [arrEmail, setArrEmail] = useState('')
  const [arrOrden, setArrOrden] = useState('')
  const [arrTelefono, setArrTelefono] = useState('')
  const [arrMotivo, setArrMotivo] = useState('Me arrepentí de la compra')
  const [arrMensaje, setArrMensaje] = useState('')
  const [arrExito, setArrExito] = useState(null)
  const [arrError, setArrError] = useState('')

  const [arrLoading, setArrLoading] = useState(false)

  const handleArrepentimientoSubmit = async (e) => {
    e.preventDefault()
    setArrError('')

    if (!arrNombre.trim() || !arrEmail.trim() || !arrOrden.trim()) {
      setArrError('Por favor completá los campos obligatorios (Nombre, Email y N° de Orden).')
      return
    }

    try {
      setArrLoading(true)
      const resp = await crearSolicitudArrepentimiento({
        customerName: arrNombre.trim(),
        customerEmail: arrEmail.trim(),
        orderNumber: arrOrden.trim(),
        customerPhone: arrTelefono.trim(),
        reason: arrMotivo,
        message: arrMensaje.trim(),
        brandSlug: brand?.slug || 'fit'
      })

      setArrExito(resp.solicitud)
    } catch (err) {
      setArrError(err.message || 'No se pudo registrar la solicitud. Por favor verificá los datos.')
    } finally {
      setArrLoading(false)
    }
  }

  const resetArrepentimiento = () => {
    setArrNombre('')
    setArrEmail('')
    setArrOrden('')
    setArrTelefono('')
    setArrMotivo('Me arrepentí de la compra')
    setArrMensaje('')
    setArrExito(null)
    setArrError('')
    setInfoOpen(null)
  }

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__inner">

          {/* Marca / Identidad */}
          <div className="footer__brand">
            <div className="footer__logo-wrap">
              <img src={config.assets.logo} alt={config.name} className="footer__logo" />
            </div>
            <p className="footer__location">{config.contact.address}</p>
          </div>

          {/* Tienda */}
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
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('cambios')}>Garantía Legal</button></li>
            </ul>
          </div>

          {/* Legales & Normativa */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Legales</h4>
            <ul>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('terminos')}>Términos y Condiciones</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('privacidad')}>Privacidad (Ley 25.326)</button></li>
              <li><button type="button" className="footer__info-btn footer__info-btn--highlight" onClick={() => { setInfoOpen('arrepentimiento'); setArrExito(null); }}>Botón de arrepentimiento</button></li>
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

        {/* ── BARRA DESTACADA: BOTÓN DE ARREPENTIMIENTO (Disposición 954/2025) ── */}
        <div className="footer__arrepentimiento-bar">
          <div className="footer__arrepentimiento-info">
            <span className="footer__arrepentimiento-tag">Defensa del Consumidor · Disp. 954/2025</span>
            <p className="footer__arrepentimiento-desc">
              ¿Compraste y querés cancelar tu pedido? Tenés 10 días corridos desde recibido el producto para revocar tu compra sin costo.
            </p>
          </div>
          <button
            type="button"
            className="footer__arrepentimiento-action"
            onClick={() => { setInfoOpen('arrepentimiento'); setArrExito(null); }}
          >
            <span className="footer__arrepentimiento-icon">↺</span> Botón de arrepentimiento
          </button>
        </div>

        {/* Copyright & Créditos */}
        <div className="footer-content">
          <p>© {new Date().getFullYear()} {config.name} ({config.contact?.razonSocial || 'Looser Fit'}) — Todos los derechos reservados · República Argentina</p>
          <p className="footer__fiscal-info" style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
            {config.contact?.cuit ? `CUIT: ${config.contact.cuit} · ` : ''}Domicilio: {config.contact?.address} · 
            <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank" rel="noreferrer" className="defensa-consumidor-link" style={{ marginLeft: '0.4rem', textDecoration: 'underline' }}>
              Defensa del Consumidor (Ley 24.240) ↗
            </a>
          </p>
          <p className="credit">
            Creado por{' '}
            <a href="https://instagram.com/saravia.devv" target="_blank" rel="noreferrer" className="credit__link">
              Theo Saravia <span className="credit__icon">↗</span>
            </a>
          </p>
        </div>
      </div>

      {/* ── MODAL LEGALES / ARREPENTIMIENTO ── */}
      {infoOpen && (
        <div className="footer-modal-overlay" onClick={resetArrepentimiento}>
          <div className="footer-modal" onClick={e => e.stopPropagation()}>
            <div className="footer-modal__header">
              <div>
                <span className="footer-modal__badge">
                  {infoOpen === 'arrepentimiento' ? 'Ley N° 24.240 · Disposición 954/2025 y Disp. 3/2026' : INFOS[infoOpen]?.badge}
                </span>
                <h3 className="footer-modal__title">
                  {infoOpen === 'arrepentimiento' ? 'Botón de Arrepentimiento' : INFOS[infoOpen]?.title}
                </h3>
              </div>
              <button type="button" className="footer-modal__close" onClick={resetArrepentimiento} aria-label="Cerrar modal">✕</button>
            </div>

            <div className="footer-modal__body">
              {infoOpen === 'arrepentimiento' ? (
                arrExito ? (
                  /* ── Pantalla de Confirmación de Arrepentimiento ── */
                  <div className="arrepentimiento-success">
                    <div className="arrepentimiento-success__icon">✓</div>
                    <h4>Solicitud de Arrepentimiento Registrada</h4>
                    <p className="arrepentimiento-success__text">
                      Conforme al Art. 34 de la Ley N° 24.240 y la Disposición 954/2025, hemos registrado tu solicitud con código identificador oficial:
                    </p>
                    <div className="arrepentimiento-success__code-box">
                      <span className="arrepentimiento-success__code-label">Código de Trámite:</span>
                      <strong className="arrepentimiento-success__code">{arrExito.requestNumber}</strong>
                    </div>
                    <p className="arrepentimiento-success__notice">
                      Te contactaremos dentro de las <strong>24 horas hábiles</strong> a <strong>{arrExito.customerEmail}</strong> para coordinar el retiro/envío del producto y el reintegro total del dinero sin costo alguno.
                    </p>
                    <button type="button" className="btn btn--primary" onClick={resetArrepentimiento} style={{ width: '100%', marginTop: '1rem' }}>
                      Entendido / Cerrar
                    </button>
                  </div>
                ) : (
                  /* ── Formulario de Arrepentimiento ── */
                  <form onSubmit={handleArrepentimientoSubmit} className="arrepentimiento-form">
                    <div className="arrepentimiento-form__intro">
                      <p>
                        Conforme al <strong>Artículo 34 de la Ley 24.240</strong>, tenés derecho a revocar la aceptación de tu compra durante el plazo de <strong>DIEZ (10) días corridos</strong> contados a partir de la entrega del producto.
                      </p>
                      <p style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' }}>
                        Completá este formulario para registrar de inmediato tu número de trámite. Nos contactaremos en menos de 24 hs hábiles.
                      </p>
                    </div>

                    {arrError && <div className="arrepentimiento-error">{arrError}</div>}

                    <div className="arrepentimiento-grid">
                      <div className="arrepentimiento-field">
                        <label>Nombre y Apellido *</label>
                        <input
                          type="text"
                          required
                          placeholder="Tu nombre completo"
                          value={arrNombre}
                          onChange={e => setArrNombre(e.target.value)}
                        />
                      </div>
                      <div className="arrepentimiento-field">
                        <label>Email de compra *</label>
                        <input
                          type="email"
                          required
                          placeholder="email@ejemplo.com"
                          value={arrEmail}
                          onChange={e => setArrEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="arrepentimiento-grid">
                      <div className="arrepentimiento-field">
                        <label>N° de Pedido / Orden *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ej: #102 o ID del pedido"
                          value={arrOrden}
                          onChange={e => setArrOrden(e.target.value)}
                        />
                      </div>
                      <div className="arrepentimiento-field">
                        <label>Teléfono de contacto</label>
                        <input
                          type="tel"
                          placeholder="Ej: 11 2345-6789"
                          value={arrTelefono}
                          onChange={e => setArrTelefono(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="arrepentimiento-field">
                      <label>Motivo de la revocación</label>
                      <select value={arrMotivo} onChange={e => setArrMotivo(e.target.value)}>
                        <option value="Me arrepentí de la compra">Revocación de compra dentro del plazo legal (10 días)</option>
                        <option value="Demora en la entrega">Demora excesiva en la entrega</option>
                        <option value="Otro motivo">Otro motivo</option>
                      </select>
                    </div>

                    <div className="arrepentimiento-field">
                      <label>Comentarios adicionales (opcional)</label>
                      <textarea
                        rows="2"
                        placeholder="Detalles sobre el estado del paquete o información útil..."
                        value={arrMensaje}
                        onChange={e => setArrMensaje(e.target.value)}
                      />
                    </div>

                    <div className="arrepentimiento-actions">
                      <button type="button" className="btn btn--secondary" onClick={resetArrepentimiento}>
                        Cancelar
                      </button>
                      <button type="submit" className="btn btn--primary" disabled={arrLoading}>
                        {arrLoading ? 'Registrando solicitud...' : 'Enviar solicitud de arrepentimiento'}
                      </button>
                    </div>
                  </form>
                )
              ) : (
                /* ── Visualización de Términos / Privacidad / Guías ── */
                <div className="legal-doc">
                  {INFOS[infoOpen]?.sections.map((sec, idx) => (
                    <div key={idx} className="legal-doc__section">
                      <h5 className="legal-doc__heading">{sec.heading}</h5>
                      <p className="legal-doc__text">{sec.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="footer-modal__footer">
              <button type="button" className="btn btn--secondary" onClick={resetArrepentimiento}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}