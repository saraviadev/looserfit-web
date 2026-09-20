const request = require('supertest');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Product = require('../src/models/product');
const Order = require('../src/models/Order');
const User = require('../src/models/User');

describe('Fase 1 — Tests de Caracterización y Guarda de Seguridad', () => {
  let defaultBrand;
  let defaultCategory;
  let testProduct;

  beforeEach(async () => {
    // Seed mínimo para pruebas
    defaultBrand = await Brand.create({
      slug: 'fit',
      name: 'Looser Fit',
      enabled: true
    });

    defaultCategory = await Category.create({
      name: 'Tops / Remeras',
      brand: defaultBrand._id
    });

    testProduct = await Product.create({
      nombre: 'Remera Oversize Test',
      precio: 10000,
      stock: 10,
      categoria: defaultCategory._id,
      brand: defaultBrand._id,
      publicado: true
    });
  });

  // 1. Guarda Anti-Atlas
  test('Seguridad: La guarda anti-Atlas bloquea cualquier intento de conexión a mongodb.net', async () => {
    await expect(
      mongoose.connect('mongodb+srv://admin:secret@cluster0.mongodb.net/production?retryWrites=true')
    ).rejects.toThrow(/SEGURIDAD CRÍTICA.*Atlas/);
  });

  // 2. Crear orden y cálculo de envío a Sucursal
  test('Órdenes: Crea orden con tipoEnvio "sucursal", asigna shippingCost $7.500 y total correcto', async () => {
    const res = await request(app)
      .post('/api/orders/create?brand=fit')
      .send({
        productos: [
          {
            productoId: testProduct._id,
            cantidad: 2,
            precio: 10000
          }
        ],
        tipoEnvio: 'sucursal',
        datosEnvio: {
          nombreCompleto: 'Juan Perez',
          email: 'juan@test.com',
          telefono: '1133445566',
          provincia: 'Buenos Aires',
          localidad: 'Quilmes',
          direccionSucursal: 'Sucursal Correo Quilmes'
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.pedido).toBeDefined();
    expect(res.body.pedido.orderNumber).toMatch(/^#\d{3,}$/);
    expect(res.body.pedido.shippingCost).toBe(7500);
    // (10000 * 2) + 7500 = 27500
    expect(res.body.pedido.total).toBe(27500);
    expect(res.body.pedido.estado).toBe('Pendiente');
    expect(res.body.pedido.trackingToken).toBeDefined();

    const orderInDb = await Order.findById(res.body.pedido._id);
    expect(orderInDb).not.toBeNull();
    expect(orderInDb.shippingCost).toBe(7500);
    expect(orderInDb.total).toBe(27500);
  });

  // 3. Crear orden y cálculo de envío a Domicilio
  test('Órdenes: Crea orden con tipoEnvio "domicilio", asigna shippingCost $11.000 y total correcto', async () => {
    const res = await request(app)
      .post('/api/orders/create?brand=fit')
      .send({
        productos: [
          {
            productoId: testProduct._id,
            cantidad: 1,
            precio: 10000
          }
        ],
        tipoEnvio: 'domicilio',
        datosEnvio: {
          nombreCompleto: 'Maria Lopez',
          email: 'maria@test.com',
          telefono: '1144556677',
          provincia: 'Capital Federal',
          localidad: 'Palermo',
          calleNumero: 'Av Santa Fe 1234',
          codigoPostal: '1425'
        }
      });

    expect(res.status).toBe(201);
    expect(res.body.pedido.shippingCost).toBe(11000);
    // (10000 * 1) + 11000 = 21000
    expect(res.body.pedido.total).toBe(21000);
  });

  // 4. updateProfile con campos válidos e intento de isAdmin (Regresión H2)
  test('Seguridad / Auth: updateProfile actualiza nombre pero ignora intento de escalación isAdmin (H2)', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        nombre: 'Usuario Normal',
        email: 'user@normal.com',
        password: 'password123'
      });

    expect(regRes.status).toBe(201);
    const token = regRes.body.token;
    expect(token).toBeDefined();

    // Intento de escalación a administrador
    const updateRes = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Usuario Modificado',
        isAdmin: true,
        role: 'admin'
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.nombre).toBe('Usuario Modificado');
    expect(updateRes.body.isAdmin).toBe(false);

    // Verificar directamente en base de datos
    const userInDb = await User.findOne({ email: 'user@normal.com' });
    expect(userInDb.isAdmin).toBe(false);
  });

  // 5. Handler de Webhook de Mercado Pago con pago aprobado (Caracterización H9)
  test('Pagos: Webhook procesa pago aprobado, marca orden Pagada y descuenta stock', async () => {
    const order = await Order.create({
      brand: defaultBrand._id,
      productos: [
        {
          productoId: testProduct._id,
          nombre: testProduct.nombre,
          cantidad: 2,
          precio: 10000
        }
      ],
      total: 27500,
      tipoEnvio: 'sucursal',
      datosEnvio: {
        nombreCompleto: 'Test Webhook',
        email: 'webhook@test.com',
        telefono: '11223344',
        provincia: 'Buenos Aires',
        localidad: 'Quilmes'
      },
      estado: 'Pendiente',
      orderNumber: '#999',
      trackingToken: 'test_token_webhook_123',
      shippingCost: 7500
    });

    // Mock de fetch global para simular la API de Mercado Pago
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockImplementation((url) => {
      if (url.includes('api.mercadopago.com/v1/payments/999888')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            status: 'approved',
            status_detail: 'accredited',
            external_reference: order._id.toString()
          })
        });
      }
      return originalFetch(url);
    });

    try {
      const res = await request(app)
        .post('/api/payments/webhook?topic=payment&id=999888')
        .send();

      expect(res.status).toBe(200);

      // Verificar que la orden pasó a 'Pagado'
      const updatedOrder = await Order.findById(order._id);
      expect(updatedOrder.estado).toBe('Pagado');

      // Verificar que el stock se descontó de 10 a 8
      const updatedProduct = await Product.findById(testProduct._id);
      expect(updatedProduct.stock).toBe(8);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 6. Regresión de secreto SMTP (H3)
  test('Seguridad / Email: src/config/email.js no contiene contraseñas SMTP hardcodeadas (H3)', () => {
    const emailConfigContent = fs.readFileSync(
      path.join(__dirname, '../src/config/email.js'),
      'utf8'
    );
    expect(emailConfigContent).not.toContain('euup wzrs uhke gcwu');
  });
});
