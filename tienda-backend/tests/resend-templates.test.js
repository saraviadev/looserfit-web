const { 
  sendEmail, 
  enviarEmailPedido, 
  enviarEmailPagoAprobado, 
  enviarEmailEmpaquetado, 
  enviarEmailSeguimiento, 
  enviarEmailNotificacionAdmin,
  transporter 
} = require('../src/config/email');

describe('Paso B — Pruebas de Resend API y Renderizado de Plantillas de Email', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  const dummyClienteDomicilio = {
    nombreCompleto: 'Martín Palermo',
    email: 'martin@boca.com',
    telefono: '1144556677',
    provincia: 'Buenos Aires',
    localidad: 'La Plata',
    calleNumero: 'Calle 7 1234',
    pisoDepto: '3B'
  };

  const dummyClienteSucursal = {
    nombreCompleto: 'Juan Román Riquelme',
    email: 'roman@boca.com',
    telefono: '1199887766',
    provincia: 'Capital Federal',
    localidad: 'La Boca',
    direccionSucursal: 'Sucursal Correo Argentino Brandsen 805'
  };

  const dummyPedidoDomicilio = {
    orderNumber: '#BOCA-101',
    total: 75000,
    tipoEnvio: 'domicilio',
    trackingToken: 'token_seguimiento_seguro_domicilio_123',
    datosEnvio: dummyClienteDomicilio,
    productos: [
      {
        nombre: 'Buzo Hoodie Heavyweight',
        talle: 'XL',
        cantidad: 2,
        precio: 35000,
        precioOferta: null
      },
      {
        nombre: 'Gorra Trucker',
        talle: 'Único',
        cantidad: 1,
        precio: 5000,
        precioOferta: null
      }
    ]
  };

  const dummyPedidoSucursal = {
    orderNumber: '#BOCA-102',
    total: 45000,
    tipoEnvio: 'sucursal',
    trackingToken: 'token_seguimiento_seguro_sucursal_456',
    datosEnvio: dummyClienteSucursal,
    productos: [
      {
        nombre: 'Remera Boxy Fit',
        talle: 'M',
        cantidad: 1,
        precio: 45000,
        precioOferta: null
      }
    ]
  };

  beforeEach(() => {
    process.env.SITE_FRONTEND_URL = 'https://www.looserfit.com';
    delete process.env.RESEND_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  describe('1. Motor sendEmail y Provider Switching', () => {
    test('Usa Resend API HTTP (POST https://api.resend.com/emails) cuando RESEND_API_KEY está configurada', async () => {
      process.env.RESEND_API_KEY = 're_test_key_12345';
      process.env.EMAIL_FROM = 'Looserfit <pedidos@looserfit.com>';

      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'resend_email_id_999' })
      });
      global.fetch = mockFetch;

      const res = await sendEmail({
        to: 'destinatario@test.com',
        bcc: ['copia1@test.com', 'copia2@test.com'],
        subject: 'Prueba Resend',
        html: '<p>Hola</p>'
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('resend');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.resend.com/emails');
      expect(options.method).toBe('POST');
      expect(options.headers['Authorization']).toBe('Bearer re_test_key_12345');

      const body = JSON.parse(options.body);
      expect(body.from).toBe('Looserfit <pedidos@looserfit.com>');
      expect(body.to).toEqual(['destinatario@test.com']);
      expect(body.bcc).toEqual(['copia1@test.com', 'copia2@test.com']);
      expect(body.subject).toBe('Prueba Resend');
    });

    test('Usa Nodemailer SMTP como fallback local cuando no hay RESEND_API_KEY', async () => {
      delete process.env.RESEND_API_KEY;

      const res = await sendEmail({
        to: 'destinatario@test.com',
        subject: 'Prueba SMTP Local',
        html: '<p>Hola Local</p>'
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('smtp');
      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. Verificación de Contenido de Plantillas', () => {
    test('enviarEmailPedido renderiza correctamente nombre, orden, productos (talle y cantidad), envío, dirección y tracking URL', async () => {
      await enviarEmailPedido(dummyClienteDomicilio, dummyPedidoDomicilio);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      expect(mail.to).toBe('martin@boca.com');
      expect(mail.subject).toBe('Pedido recibido — Orden #BOCA-101');

      const html = mail.html;
      // Nombre del cliente
      expect(html).toContain('Martín Palermo');
      // Número de orden
      expect(html).toContain('#BOCA-101');
      // Ítems con talle y cantidad
      expect(html).toContain('Buzo Hoodie Heavyweight (XL) x2');
      expect(html).toContain('Gorra Trucker (Único) x1');
      // Total formateado
      expect(html).toContain('$75.000');
      // Tipo de envío y dirección
      expect(html).toContain('Envío a domicilio');
      expect(html).toContain('Calle 7 1234');
      // Link de seguimiento
      expect(html).toContain('href="https://www.looserfit.com/seguimiento/token_seguimiento_seguro_domicilio_123"');
      // NUNCA debe contener localhost
      expect(html).not.toContain('localhost');
    });

    test('enviarEmailPedido renderiza correctamente sucursal cuando tipoEnvio es sucursal', async () => {
      await enviarEmailPedido(dummyClienteSucursal, dummyPedidoSucursal);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      const html = mail.html;
      expect(html).toContain('Juan Román Riquelme');
      expect(html).toContain('#BOCA-102');
      expect(html).toContain('Remera Boxy Fit (M) x1');
      expect(html).toContain('Retiro en sucursal');
      expect(html).toContain('Sucursal Correo Argentino Brandsen 805');
      expect(html).toContain('href="https://www.looserfit.com/seguimiento/token_seguimiento_seguro_sucursal_456"');
      expect(html).not.toContain('localhost');
    });

    test('enviarEmailPagoAprobado renderiza nombre y orden correctamente', async () => {
      await enviarEmailPagoAprobado(dummyClienteDomicilio, dummyPedidoDomicilio);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      expect(mail.to).toBe('martin@boca.com');
      expect(mail.subject).toContain('#BOCA-101');
      expect(mail.html).toContain('Martín Palermo');
      expect(mail.html).toContain('#BOCA-101');
      expect(mail.html).toContain('¡Pago aprobado!');
    });

    test('enviarEmailEmpaquetado renderiza nombre y orden correctamente', async () => {
      await enviarEmailEmpaquetado(dummyClienteDomicilio, dummyPedidoDomicilio);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      expect(mail.to).toBe('martin@boca.com');
      expect(mail.subject).toContain('#BOCA-101');
      expect(mail.html).toContain('Martín Palermo');
      expect(mail.html).toContain('#BOCA-101');
      expect(mail.html).toContain('¡Tu pedido ya está listo!');
    });

    test('enviarEmailSeguimiento renderiza nombre, orden, código y botón de Correo Argentino', async () => {
      const trackingNumber = 'AR-99887766-QA';
      await enviarEmailSeguimiento(dummyClienteDomicilio, trackingNumber, dummyPedidoDomicilio.orderNumber);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      expect(mail.to).toBe('martin@boca.com');
      expect(mail.subject).toContain(trackingNumber);
      expect(mail.html).toContain('Martín Palermo');
      expect(mail.html).toContain(trackingNumber);
      expect(mail.html).toContain('#BOCA-101');
      expect(mail.html).toContain('https://www.correoargentino.com.ar/seguimiento-de-envios?codigoSeguimiento=AR-99887766-QA');
    });

    test('enviarEmailNotificacionAdmin renderiza orden, datos completos del cliente y tabla de productos', async () => {
      await enviarEmailNotificacionAdmin(dummyPedidoDomicilio);

      expect(transporter.sendMail).toHaveBeenCalledTimes(1);
      const mail = transporter.sendMail.mock.calls[0][0];

      expect(mail.subject).toContain('#BOCA-101');
      expect(mail.subject).toContain('Martín Palermo');
      const html = mail.html;
      expect(html).toContain('Martín Palermo');
      expect(html).toContain('martin@boca.com');
      expect(html).toContain('1144556677');
      expect(html).toContain('Buenos Aires, La Plata');
      expect(html).toContain('Calle 7 1234');
      expect(html).toContain('$75.000');
      expect(html).toContain('Buzo Hoodie Heavyweight (XL) x2');
    });
  });

  describe('3. Resiliencia: Fallos en el envío nunca interrumpen la ejecución', () => {
    test('enviarEmailPedido captura el error sin arrojar excepción y devuelve false', async () => {
      transporter.sendMail.mockRejectedValueOnce(new Error('SMTP Connection timeout'));

      const result = await enviarEmailPedido(dummyClienteDomicilio, dummyPedidoDomicilio);
      expect(result).toBe(false);
    });

    test('sendEmail con Resend captura error HTTP sin romper llamadas protegidas', async () => {
      process.env.RESEND_API_KEY = 're_invalid_key';
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized API Key'
      });

      const result = await enviarEmailPedido(dummyClienteDomicilio, dummyPedidoDomicilio);
      expect(result).toBe(false);
    });
  });
});
