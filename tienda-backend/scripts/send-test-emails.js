'use strict';

require('dotenv').config();
const { 
    sendEmail, 
    enviarEmailPedido, 
    enviarEmailPagoAprobado, 
    enviarEmailEmpaquetado, 
    enviarEmailSeguimiento, 
    enviarEmailNotificacionAdmin 
} = require('../src/config/email');

async function main() {
    const targetEmail = process.env.TEST_EMAIL_TO;

    if (!targetEmail || !targetEmail.includes('@')) {
        console.log('═══════════════════════════════════════════════════════════════════');
        console.log('⚠️  TEST_EMAIL_TO no está definido o es inválido.');
        console.log('Para ejecutar esta prueba manual en producción o local, ejecuta:');
        console.log('  TEST_EMAIL_TO="tu_correo@ejemplo.com" node scripts/send-test-emails.js');
        console.log('═══════════════════════════════════════════════════════════════════');
        process.exit(0);
    }

    console.log(`🚀 Iniciando prueba de emails hacia: ${targetEmail}`);
    console.log(`Proveedor activo: ${process.env.RESEND_API_KEY ? 'Resend API (HTTP 443)' : 'Nodemailer SMTP (Gmail)'}`);

    const dummyDatosEnvio = {
        nombreCompleto: 'Comprador de Prueba',
        email: targetEmail,
        telefono: '1123456789',
        provincia: 'Buenos Aires',
        localidad: 'Quilmes',
        calleNumero: 'San Martín 123',
        pisoDepto: '4B',
        direccionSucursal: 'Sucursal Correo Argentino Quilmes Centro'
    };

    const dummyPedido = {
        orderNumber: '#TEST-999',
        total: 45000,
        tipoEnvio: 'domicilio',
        trackingToken: 'token_prueba_resend_123',
        datosEnvio: dummyDatosEnvio,
        productos: [
            {
                nombre: 'Remera Oversize Signature',
                talle: 'L',
                cantidad: 2,
                precio: 20000,
                precioOferta: null
            },
            {
                nombre: 'Gorra Looserfit Classic',
                talle: 'Único',
                cantidad: 1,
                precio: 5000,
                precioOferta: null
            }
        ]
    };

    try {
        console.log('1. Probando sendEmail genérico...');
        await sendEmail({
            to: targetEmail,
            subject: 'Prueba de Conexión Email — Looserfit',
            html: '<h1>Conexión exitosa</h1><p>El servicio de email está funcionando correctamente.</p>'
        });

        console.log('2. Enviando plantilla: Pedido recibido...');
        await enviarEmailPedido(dummyDatosEnvio, dummyPedido);

        console.log('3. Enviando plantilla: Pago aprobado...');
        await enviarEmailPagoAprobado(dummyDatosEnvio, dummyPedido);

        console.log('4. Enviando plantilla: Pedido empaquetado...');
        await enviarEmailEmpaquetado(dummyDatosEnvio, dummyPedido);

        console.log('5. Enviando plantilla: Seguimiento...');
        await enviarEmailSeguimiento(dummyDatosEnvio, 'AR-123456789-QA', dummyPedido.orderNumber);

        console.log('6. Enviando plantilla: Notificación admin...');
        await enviarEmailNotificacionAdmin(dummyPedido);

        console.log('✨ Todas las plantillas fueron enviadas exitosamente.');
    } catch (err) {
        console.error('❌ Error ejecutando prueba de emails:', err.message);
        process.exit(1);
    }
}

main();
