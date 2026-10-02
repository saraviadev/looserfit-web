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
        pass: (process.env.EMAIL_PASS || '').replace(/\s+/g, '')
    },
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    },
    connectionTimeout: 15000,
    greetingTimeout: 8000,
    socketTimeout: 20000
});

// Verificar al arrancar — no bloquea si falla (ignorado en tests)
if (process.env.NODE_ENV !== 'test') {
    transporter.verify((error) => {
        if (error) {
            console.warn('⚠️  Email SMTP no disponible:', error.message);
        } else {
            console.log('✅ Servidor de email SMTP listo');
        }
    });
}

// ── Motor unificado de envío: Resend API HTTP con fallback a Nodemailer SMTP ──
async function sendEmail({ to, bcc, subject, html }) {
    const defaultFrom = `"${process.env.SITE_NAME || 'Looser Fit'}" <${process.env.EMAIL_USER || 'looserfit2004@gmail.com'}>`;
    let from = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || defaultFrom;

    // 1. Si existe API KEY de Resend, enviamos vía HTTP (puerto 443, sin bloqueos de puerto en Render)
    const preferGmail = process.env.EMAIL_PROVIDER === 'gmail' || (!process.env.RESEND_API_KEY && process.env.EMAIL_PASS);
    if (process.env.RESEND_API_KEY && !preferGmail) {
        // En Resend, si no hay un dominio personalizado verificado en EMAIL_FROM, usar el remitente oficial de prueba
        const configuredFrom = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM;
        if (!configuredFrom || configuredFrom.includes('gmail.com')) {
            from = `"${process.env.SITE_NAME || 'Looser Fit'}" <onboarding@resend.dev>`;
        }
        let recipientList;
        if (to) {
            recipientList = Array.isArray(to) ? to : [to];
        } else if (process.env.EMAIL_USER) {
            recipientList = [process.env.EMAIL_USER];
        } else {
            recipientList = ['looserfit2004@gmail.com'];
        }

        const payload = {
            from,
            to: recipientList,
            subject,
            html,
            reply_to: process.env.EMAIL_USER || 'looserfit2004@gmail.com'
        };

        if (bcc) {
            payload.bcc = Array.isArray(bcc) ? bcc : [bcc];
        }

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Resend HTTP ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return { success: true, messageId: data.id, provider: 'resend' };
    }

    // 2. Fallback: Nodemailer SMTP (para pruebas locales cuando no hay RESEND_API_KEY)
    const mailOptions = {
        from,
        to: to || (bcc ? (process.env.EMAIL_USER || 'looserfit2004@gmail.com') : undefined),
        replyTo: process.env.EMAIL_USER || 'looserfit2004@gmail.com',
        subject,
        html
    };
    if (bcc) mailOptions.bcc = bcc;

    const info = await transporter.sendMail(mailOptions);
    return { success: true, messageId: info?.messageId || 'mock-id', provider: 'smtp' };
}

// ── Helpers internos ──

function productosHTML(productos = []) {
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
    try {
        const trackingBaseUrl = (process.env.FRONTEND_URL_FIT || process.env.SITE_FRONTEND_URL || process.env.FRONTEND_URL || 'https://www.looserfit.com').replace(/\/$/, '');
        const trackingLink = `${trackingBaseUrl}/seguimiento/${pedido.trackingToken}`;

        const direccionDetalle = pedido.tipoEnvio === 'sucursal'
            ? `<p style="margin:0 0 6px"><strong>Sucursal:</strong> ${datosEnvio.direccionSucursal || 'A convenir'}</p>`
            : `<p style="margin:0 0 6px"><strong>Dirección:</strong> ${datosEnvio.calleNumero || ''}${datosEnvio.pisoDepto ? ` (${datosEnvio.pisoDepto})` : ''}</p>`;

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
               ${direccionDetalle}
               <p style="margin:0 0 6px"><strong>Provincia:</strong> ${datosEnvio.provincia}, ${datosEnvio.localidad}</p>
                <p style="margin:0">
                  <a href="${trackingLink}" style="color:#0d0d0d;font-weight:bold">
                     Ver estado de mi pedido
                  </a>
                </p>
              </div>

              <p style="margin-top:20px;color:#3d3d3d">
                Cualquier consulta escribinos por 
                <a href="https://instagram.com/${(process.env.SITE_INSTAGRAM || 'instagram').replace('@','')}" style="color:#0d0d0d">@${(process.env.SITE_INSTAGRAM || 'instagram').replace('@','')}</a>
              </p>`
        );

        await sendEmail({
            to: datosEnvio.email,
            subject: `Pedido recibido — Orden ${pedido.orderNumber}`,
            html
        });

        console.log(`✅ Email pedido enviado a ${datosEnvio.email} (Orden ${pedido.orderNumber})`);
        return true;
    } catch (err) {
        console.error(`❌ [Email Error] tipo: Pedido recibido | orden: ${pedido?.orderNumber || 'N/A'} | error:`, err.message);
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

        await sendEmail({
            to: datosEnvio.email,
            subject: `📦 Tu pedido ${pedido.orderNumber} ya está listo - ${process.env.SITE_NAME || 'Store'}`,
            html
        });

        console.log(`✅ Email empaquetado enviado a ${datosEnvio.email} (Orden ${pedido.orderNumber})`);
        return true;
    } catch (error) {
        console.error(`❌ [Email Error] tipo: Empaquetado | orden: ${pedido?.orderNumber || 'N/A'} | error:`, error.message);
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

        await sendEmail({
            to: datosEnvio.email,
            subject: `🎉 Pago aprobado - Orden ${pedido.orderNumber} - Looserfit`,
            html
        });

        console.log(`✅ Email pago aprobado enviado a ${datosEnvio.email} (Orden ${pedido.orderNumber})`);
        return true;
    } catch (error) {
        console.error(`❌ [Email Error] tipo: Pago aprobado | orden: ${pedido?.orderNumber || 'N/A'} | error:`, error.message);
        return false;
    }
}

// ── Email al cliente con código de seguimiento ──
async function enviarEmailSeguimiento(datosEnvio, trackingNumber, orderNumber) {
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

        await sendEmail({
            to: datosEnvio.email,
            subject: `Tu pedido está en camino — Código ${trackingNumber}`,
            html
        });

        console.log(`✅ Email seguimiento enviado a ${datosEnvio.email} (Orden ${orderNumber})`);
        return true;
    } catch (err) {
        console.error(`❌ [Email Error] tipo: Seguimiento | orden: ${orderNumber || 'N/A'} | error:`, err.message);
        return false;
    }
}

// ── Notificación interna al admin ──
async function enviarEmailNotificacionAdmin(pedido) {
    try {
        const direccionAdmin = pedido.tipoEnvio === 'sucursal'
            ? `<tr style="background:#f5f3ef"><td style="padding:8px"><strong>Sucursal</strong></td><td style="padding:8px">${pedido.datosEnvio?.direccionSucursal || 'No especificada'}</td></tr>`
            : `<tr style="background:#f5f3ef"><td style="padding:8px"><strong>Dirección</strong></td><td style="padding:8px">${pedido.datosEnvio?.calleNumero || ''}${pedido.datosEnvio?.pisoDepto ? ` (${pedido.datosEnvio.pisoDepto})` : ''}</td></tr>`;

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
               ${direccionAdmin}
             </table>

             <h4 style="border-top:1px solid #d4d0c8;padding-top:16px">Productos</h4>
             <table width="100%" cellpadding="0" cellspacing="0">
               ${productosHTML(pedido.productos)}
             </table>`
        );

        await sendEmail({
            to: process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'looserfit2004@gmail.com',
            subject: `🛒 Nuevo pedido ${pedido.orderNumber} — ${pedido.datosEnvio?.nombreCompleto}`,
            html
        });

        console.log(`✅ Notificación admin enviada (Orden ${pedido.orderNumber})`);
        return true;
    } catch (err) {
        console.error(`❌ [Email Error] tipo: Notificación admin | orden: ${pedido?.orderNumber || 'N/A'} | error:`, err.message);
        return false;
    }
}


/**
 * Envía confirmación oficial de recepción de Solicitud de Arrepentimiento
 * Conforme a Disposición 954/2025 y Ley N° 24.240 de Defensa del Consumidor
 */
async function enviarEmailArrepentimiento(datos, solicitud) {
    try {
        const siteName = process.env.SITE_NAME || 'Looser Fit';
        const contactEmail = process.env.EMAIL_USER || 'looserfit2004@gmail.com';
        const fechaFormateada = new Date(solicitud.createdAt || Date.now()).toLocaleDateString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        const html = wrapHTML(
            `<h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;letter-spacing:-0.5px">Solicitud de Arrepentimiento Registrada</h2>
            <p style="margin:0 0 12px;color:#cccccc;line-height:1.6">Hola <strong>${solicitud.customerName || datos.customerName}</strong>,</p>
            <p style="margin:0 0 16px;color:#cccccc;line-height:1.6">
                Te confirmamos que hemos recibido tu solicitud de revocación conforme al <strong>Artículo 34 de la Ley N° 24.240</strong> y la <strong>Disposición 954/2025</strong> de la Subsecretaría de Defensa del Consumidor.
            </p>

            <div style="background:#1a1a1a;border:1px solid #333333;border-radius:8px;padding:16px;margin:20px 0">
                <table width="100%" cellpadding="6" cellspacing="0" style="color:#e0e0e0;font-size:14px">
                    <tr>
                        <td width="40%" style="color:#888888"><strong>Código Oficial:</strong></td>
                        <td><span style="display:inline-block;background:#333;color:#00e5ff;font-family:monospace;font-size:16px;font-weight:700;padding:4px 10px;border-radius:4px">${solicitud.requestNumber}</span></td>
                    </tr>
                    <tr>
                        <td style="color:#888888"><strong>Pedido Asociado:</strong></td>
                        <td><strong>${solicitud.orderNumber || datos.orderNumber || 'No especificado'}</strong></td>
                    </tr>
                    <tr>
                        <td style="color:#888888"><strong>Fecha y Hora:</strong></td>
                        <td>${fechaFormateada} hs</td>
                    </tr>
                    <tr>
                        <td style="color:#888888"><strong>Estado Inicial:</strong></td>
                        <td><span style="color:#ffb74d">● Recibido</span></td>
                    </tr>
                </table>
            </div>

            <p style="margin:0 0 12px;color:#cccccc;line-height:1.6">
                <strong>Plazo de respuesta:</strong> Conforme al marco legal vigente, dentro de las <strong>24 horas hábiles</strong> siguientes nos pondremos en contacto por este mismo medio para coordinar la devolución del producto y el reintegro total del importe abonado sin costo alguno para vos.
            </p>

            <p style="margin:20px 0 0;font-size:12px;color:#777777;border-top:1px solid #2a2a2a;padding-top:12px">
                Ante cualquier duda podés responder directamente a este correo o contactarnos a ${contactEmail}.
            </p>`
        );

        const adminNotificationEmail = process.env.ADMIN_EMAIL || process.env.EMAIL_USER || 'looserfit2004@gmail.com';
        await sendEmail({
            to: solicitud.customerEmail || datos.customerEmail,
            bcc: [adminNotificationEmail],
            subject: `Solicitud de Arrepentimiento ${solicitud.requestNumber} — ${siteName}`,
            html
        });

        console.log(`✅ Email de confirmación de arrepentimiento enviado (${solicitud.requestNumber})`);
        return true;
    } catch (err) {
        console.error(`❌ [Email Error] tipo: Arrepentimiento | solicitud: ${solicitud?.requestNumber || 'N/A'} | error:`, err.message);
        return false;
    }
}

module.exports = {
    enviarEmailArrepentimiento,
    transporter,
    sendEmail,
    wrapHTML,
    productosHTML,
    enviarEmailPedido,
    enviarEmailPagoAprobado,
    enviarEmailEmpaquetado,
    enviarEmailSeguimiento,
    enviarEmailNotificacionAdmin
};
