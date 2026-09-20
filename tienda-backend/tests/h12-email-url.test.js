const { enviarEmailPedido, transporter } = require('../src/config/email');

describe('Fase 2.2 — H12: Resolución de URL en Enlace de Seguimiento de Email', () => {
  const originalSiteFrontendUrl = process.env.SITE_FRONTEND_URL;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  const dummyDatosEnvio = {
    nombreCompleto: 'Juan Pérez',
    email: 'juan@test.com',
    telefono: '11223344',
    provincia: 'Buenos Aires',
    localidad: 'Avellaneda'
  };

  const dummyPedido = {
    orderNumber: '#999',
    total: 35000,
    tipoEnvio: 'domicilio',
    trackingToken: 'token_seguro_xyz_123',
    productos: [
      {
        nombre: 'Remera Oversize',
        talle: 'L',
        cantidad: 1,
        precio: 35000
      }
    ]
  };

  afterEach(() => {
    process.env.SITE_FRONTEND_URL = originalSiteFrontendUrl;
    process.env.FRONTEND_URL = originalFrontendUrl;
    jest.clearAllMocks();
  });

  test('1. Usa SITE_FRONTEND_URL si está definido y elimina barra final', async () => {
    process.env.SITE_FRONTEND_URL = 'https://looserfit.com/';
    delete process.env.FRONTEND_URL;

    await enviarEmailPedido(dummyDatosEnvio, dummyPedido);

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = transporter.sendMail.mock.calls[0][0];
    expect(mailArgs.html).toContain('href="https://looserfit.com/seguimiento/token_seguro_xyz_123"');
    expect(mailArgs.html).not.toContain('https://looserfit.com//seguimiento');
  });

  test('2. Usa FRONTEND_URL si SITE_FRONTEND_URL no está definido', async () => {
    delete process.env.SITE_FRONTEND_URL;
    process.env.FRONTEND_URL = 'https://looserfit-app-final.loca.lt';

    await enviarEmailPedido(dummyDatosEnvio, dummyPedido);

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = transporter.sendMail.mock.calls[0][0];
    expect(mailArgs.html).toContain('href="https://looserfit-app-final.loca.lt/seguimiento/token_seguro_xyz_123"');
    expect(mailArgs.html).not.toContain('localhost');
  });

  test('3. Fallback seguro a https://www.looserfit.com si ninguna variable está definida (nunca localhost)', async () => {
    delete process.env.SITE_FRONTEND_URL;
    delete process.env.FRONTEND_URL;

    await enviarEmailPedido(dummyDatosEnvio, dummyPedido);

    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
    const mailArgs = transporter.sendMail.mock.calls[0][0];
    expect(mailArgs.html).toContain('href="https://www.looserfit.com/seguimiento/token_seguro_xyz_123"');
    expect(mailArgs.html).not.toContain('localhost');
  });
});
