'use strict';

// ── FIX IPv4 en Render ──
// Forzar que todos los DNS resuelvan IPv4 primero,
// antes de que nodemailer intente conectarse.
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER || 'looserfit2004@gmail.com',
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    },
    // Timeouts generosos para Render (cold starts)
    connectionTimeout: 15000,
    greetingTimeout: 8000,
    socketTimeout: 20000
});

// Verificar al arrancar — no bloquea si falla (ignorado en tests)
if (process.env.NODE_ENV !== 'test') {
    transporter.verify((error) => {
        if (error) {
            console.warn('⚠️  Email no disponible:', error.message);
        } else {
            console.log('✅ Servidor de email listo');
        }
    });
}

// ── Helpers internos ──

function productosHTML(productos) {
    return productos
        .map(p => `
            <tr>
                <td style="padding:8px;border-bottom:1px solid #eee">
                    ${p.nombre}${p.talle ? ` (${p.talle})` : ''} x${p.cantidad}
                </td>
                <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">
                    ${p.precioOferta ? 
                      `<span style="text-decoration:line-through;color:#888;font-size:0.9em;margin-right:4px">$${Number(p.precio).toLocaleString('es-AR')}</span>
                       <span style="color:#d32f2f;font-weight:bold">$${Number(p.precioOferta).toLocaleString('es-AR')}</span>` 
                      : `$${Number(p.precio).toLocaleString('es-AR')}`
                    }
                </td>
            </tr>`)
        .join('');
}

function wrapHTML(titulo, contenido) {
    return `
    <!DOCTYPE html>
    <html lang="es">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f5f3ef;font-family:Arial,sans-serif">
      <div style="max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#0d0d0d;padding:20px;text-align:center;margin-bottom:20px">
          <p style="color:#fff;font-size:22px;font-weight:bold;letter-spacing:4px;margin:0">${(process.env.SITE_NAME || 'STORE').toUpperCase()}</p>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #d4d0c8">
          <h2 style="color:#0d0d0d;margin-top:0">${titulo}</h2>
          ${contenido}
        </div>
        <p style="color:#8a8a8a;font-size:11px;text-align:center;margin-top:20px">
          © ${new Date().getFullYear()} ${process.env.SITE_NAME || 'Store'} · ${process.env.SITE_LOCATION || 'Caba, Argentina'}
        </p>
      </div>
    </body>
    </html>`;
}

// ── Email al cliente cuando confirma el pedido ──
async function enviarEmailPedido(datosEnvio, pedido) {
    // removed early return to allow fallback

    try {
        const html = wrapHTML(
            '¡Pedido recibido!',
            `<p>Hola <strong>${datosEnvio.nombreCompleto}</strong>,</p>
             <p>Tu pedido fue registrado correctamente. Te contactaremos para coordinar el pago.</p>
             
             <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0">
               <tr style="background:#f5f3ef">
                 <td style="padding:8px"><strong>Orden</strong></td>
                 <td style="padding:8px;text-align:right"><strong>${pedido.orderNumber}</strong></td>
               </tr>
               ${productosHTML(pedido.productos)}
               <tr>
                 <td style="padding:10px;font-weight:bold">Total</td>
                 <td style="padding:10px;text-align:right;font-weight:bold">
                   $${Number(pedido.total).toLocaleString('es-AR')}
                 </td>
               </tr>
             </table>

             <div style="background:#f5f3ef;padding:14px;margin-top:16px">
               <p style="margin:0 0 6px"><strong>Tipo de envío:</strong> 
                 ${pedido.tipoEnvio === 'sucursal' ? 'Retiro en sucursal' : 'Envío a domicilio'}
               </p>
               <p style="margin:0 0 6px"><strong>Provincia:</strong> ${datosEnvio.provincia}, ${datosEnvio.localidad}</p>
                <p style="margin:0">
                  <a href="${(process.env.SITE_FRONTEND_URL || process.env.FRONTEND_URL || 'https://www.looserfit.com').replace(/\/$/, '')}/seguimiento/${pedido.trackingToken}" style="color:#0d0d0d;font-weight:bold">
                     Ver estado de mi pedido
                  </a>
                </p>
              </div>

              <p style="margin-top:20px;color:#3d3d3d">
                Cualquier consulta escribinos por 
                <a href="https://instagram.com/${(process.env.SITE_INSTAGRAM || 'instagram').replace('@','')}" style="color:#0d0d0d">@${(process.env.SITE_INSTAGRAM || 'instagram').replace('@','')}</a>
              </p>`
        );

        await transporter.sendMail({
            from: `"${process.env.SITE_NAME || 'Store'}" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`,
            to: datosEnvio.email,
            subject: `Pedido recibido — Orden ${pedido.orderNumber}`,
            html
        });

        console.log(`✅ Email enviado a ${datosEnvio.email}`);
        return true;
    } catch (err) {
        console.error('❌ Error email pedido:', err.message);
        return false;
    }
}

// ── Email al cliente cuando el pedido está empaquetado ──
async function enviarEmailEmpaquetado(datosEnvio, pedido) {
    try {
        const html = wrapHTML(
            '📦 ¡Tu pedido ya está listo!',
            `<p>Hola <strong>${datosEnvio.nombreCompleto}</strong>,</p>
             <p>¡Grandes noticias! Tu pedido ha sido empaquetado y ya está listo para ser enviado.</p>
             
             <div style="background:#f5f3ef;padding:14px;margin:16px 0">
               <p style="margin:0"><strong>Orden:</strong> ${pedido.orderNumber}</p>
               <p style="margin:4px 0 0"><strong>Estado:</strong> Preparado para entrega / envío</p>
             </div>
             
             <p>Te avisaremos por este medio en cuanto el correo pase a retirarlo para darte tu código de seguimiento (si aplica).</p>`
        );

        await transporter.sendMail({
            from: `"${process.env.SITE_NAME || 'Store'}" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`,
            to: datosEnvio.email,
            subject: `📦 Tu pedido ${pedido.orderNumber} ya está listo - ${process.env.SITE_NAME || 'Store'}`,
            html
        });

        console.log(`✅ Email de empaquetado enviado a ${datosEnvio.email}`);
        return true;
    } catch (error) {
        console.error('❌ Error email empaquetado:', error.message);
        return false;
    }
}

// ── Notificación de pago aprobado (Webhook) ──
async function enviarEmailPagoAprobado(datosEnvio, pedido) {
    try {
        const html = wrapHTML(
            '¡Pago aprobado! 🎉',
            `<p>Hola <strong>${datosEnvio.nombreCompleto}</strong>,</p>
             <p>Hemos recibido el pago de tu pedido correctamente. ¡Muchas gracias por tu compra!</p>
             
             <div style="background:#f5f3ef;padding:14px;margin:16px 0">
               <p style="margin:0"><strong>Orden:</strong> ${pedido.orderNumber}</p>
               <p style="margin:4px 0 0"><strong>Estado:</strong> Pagado / En preparación</p>
             </div>
             
             <p>Te avisaremos en cuanto el pedido esté listo y cuando sea despachado al correo.</p>`
        );

        await transporter.sendMail({
            from: `"Looserfit" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`,
            to: datosEnvio.email,
            subject: `🎉 Pago aprobado - Orden ${pedido.orderNumber} - Looserfit`,
            html
        });

        console.log(`✅ Email de pago aprobado enviado a ${datosEnvio.email}`);
        return true;
    } catch (error) {
        console.error('❌ Error email pago aprobado:', error.message);
        return false;
    }
}

// ── Email al cliente con código de seguimiento ──
async function enviarEmailSeguimiento(datosEnvio, trackingNumber, orderNumber) {
    // removed early return to allow fallback

    try {
        const trackingUrl = `https://www.correoargentino.com.ar/seguimiento-de-envios?codigoSeguimiento=${trackingNumber}`;

        const html = wrapHTML(
            '¡Tu pedido está en camino! 📦',
            `<p>Hola <strong>${datosEnvio.nombreCompleto}</strong>,</p>
             <p>Tu pedido fue enviado por Correo Argentino.</p>

             <div style="background:#f5f3ef;padding:20px;margin:20px 0;text-align:center">
               <p style="margin:0 0 6px;color:#8a8a8a;font-size:13px">CÓDIGO DE SEGUIMIENTO</p>
               <p style="margin:0;font-size:24px;font-weight:bold;letter-spacing:3px;color:#0d0d0d">
                 ${trackingNumber}
               </p>
             </div>

             <div style="text-align:center;margin:20px 0">
               <a href="${trackingUrl}"
                  style="background:#0d0d0d;color:#fff;padding:12px 28px;text-decoration:none;
                         font-weight:bold;letter-spacing:2px;font-size:13px">
                 RASTREAR PEDIDO
               </a>
             </div>

             <p style="margin-top:16px;color:#3d3d3d">
               Orden: <strong>${orderNumber}</strong>
             </p>`
        );

        await transporter.sendMail({
            from: `"Looserfit" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`,
            to: datosEnvio.email,
            subject: `Tu pedido está en camino — Código ${trackingNumber}`,
            html
        });

        console.log(`✅ Email seguimiento enviado a ${datosEnvio.email}`);
        return true;
    } catch (err) {
        console.error('❌ Error email seguimiento:', err.message);
        return false;
    }
}

// ── Notificación interna al admin ──
async function enviarEmailNotificacionAdmin(pedido) {
    // removed early return to allow fallback

    try {
        const html = wrapHTML(
            `🛒 Nuevo Pedido — ${pedido.orderNumber}`,
            `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
               <tr style="background:#f5f3ef">
                 <td style="padding:8px"><strong>Cliente</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio?.nombreCompleto}</td>
               </tr>
               <tr>
                 <td style="padding:8px"><strong>Email</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio?.email}</td>
               </tr>
               <tr style="background:#f5f3ef">
                 <td style="padding:8px"><strong>Teléfono</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio?.telefono}</td>
               </tr>
               <tr>
                 <td style="padding:8px"><strong>Total</strong></td>
                 <td style="padding:8px;font-weight:bold">$${Number(pedido.total).toLocaleString('es-AR')}</td>
               </tr>
               <tr style="background:#f5f3ef">
                 <td style="padding:8px"><strong>Envío</strong></td>
                 <td style="padding:8px">
                   ${pedido.tipoEnvio === 'sucursal' ? 'Retiro en sucursal' : 'A domicilio'}
                 </td>
               </tr>
               <tr>
                 <td style="padding:8px"><strong>Provincia</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio?.provincia}, ${pedido.datosEnvio?.localidad}</td>
               </tr>
               ${pedido.datosEnvio?.calleNumero ? `
               <tr style="background:#f5f3ef">
                 <td style="padding:8px"><strong>Dirección</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio.calleNumero}</td>
               </tr>` : ''}
               ${pedido.datosEnvio?.direccionSucursal ? `
               <tr>
                 <td style="padding:8px"><strong>Sucursal</strong></td>
                 <td style="padding:8px">${pedido.datosEnvio.direccionSucursal}</td>
               </tr>` : ''}
             </table>

             <h4 style="border-top:1px solid #d4d0c8;padding-top:16px">Productos</h4>
             <table width="100%" cellpadding="0" cellspacing="0">
               ${productosHTML(pedido.productos)}
             </table>`
        );

        await transporter.sendMail({
            from: `"${process.env.SITE_NAME || 'Store'} Bot" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`,
            to: process.env.EMAIL_USER || 'looserfit2004@gmail.com',
            subject: `🛒 Nuevo pedido ${pedido.orderNumber} — ${pedido.datosEnvio?.nombreCompleto}`,
            html
        });

        console.log('✅ Notificación admin enviada');
        return true;
    } catch (err) {
        console.error('❌ Error email admin:', err.message);
        return false;
    }
}

module.exports = {
    transporter,
    enviarEmailPedido,
    enviarEmailPagoAprobado,
    enviarEmailEmpaquetado,
    enviarEmailSeguimiento,
    enviarEmailNotificacionAdmin
};
