const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Order = require('../src/models/Order');
const User = require('../src/models/User');

describe('Fase 2.1 — H11: Control de Acceso y Autorización en Pedidos (getOrderById)', () => {
  let defaultBrand;
  let ownerUser;
  let otherUser;
  let adminUser;
  let ownerToken;
  let otherToken;
  let adminToken;
  let userOrder;
  let guestOrder;

  beforeEach(async () => {
    defaultBrand = await Brand.create({
      slug: 'fit',
      name: 'Looser Fit',
      enabled: true
    });

    ownerUser = await User.create({
      nombre: 'Dueño Pedido',
      email: 'dueno@test.com',
      password: 'password123',
      isAdmin: false
    });

    otherUser = await User.create({
      nombre: 'Otro Usuario',
      email: 'otro@test.com',
      password: 'password123',
      isAdmin: false
    });

    adminUser = await User.create({
      nombre: 'Administrador',
      email: 'admin@test.com',
      password: 'password123',
      isAdmin: true
    });

    // Tokens generados exactamente como los emite userService.js ({ id, isAdmin })
    const secret = process.env.JWT_SECRET;
    ownerToken = jwt.sign({ id: ownerUser._id, isAdmin: false }, secret);
    otherToken = jwt.sign({ id: otherUser._id, isAdmin: false }, secret);
    adminToken = jwt.sign({ id: adminUser._id, isAdmin: true }, secret);

    userOrder = await Order.create({
      brand: defaultBrand._id,
      usuario: ownerUser._id,
      productos: [],
      total: 15000,
      tipoEnvio: 'sucursal',
      datosEnvio: {
        nombreCompleto: 'Dueño Pedido',
        email: 'dueno@test.com',
        telefono: '11223344',
        provincia: 'Buenos Aires',
        localidad: 'Quilmes'
      },
      estado: 'Pendiente',
      orderNumber: '#101',
      trackingToken: 'token_user_order_101',
      shippingCost: 7500
    });

    guestOrder = await Order.create({
      brand: defaultBrand._id,
      usuario: null,
      productos: [],
      total: 20000,
      tipoEnvio: 'domicilio',
      datosEnvio: {
        nombreCompleto: 'Invitado Comprador',
        email: 'invitado@test.com',
        telefono: '11998877',
        provincia: 'Capital Federal',
        localidad: 'Palermo'
      },
      estado: 'Pendiente',
      orderNumber: '#102',
      trackingToken: 'token_guest_order_102',
      shippingCost: 11000
    });
  });

  test('1. Dueño accede: Usuario registrado puede consultar su propio pedido (status 200)', async () => {
    const res = await request(app)
      .get(`/api/orders/${userOrder._id}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(userOrder._id.toString());
    expect(res.body.orderNumber).toBe('#101');
  });

  test('2. Otro usuario recibe 403: Usuario que no es dueño ni admin no puede consultar el pedido', async () => {
    const res = await request(app)
      .get(`/api/orders/${userOrder._id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.mensaje).toMatch(/No tenés permiso/);
  });

  test('2b. Tercero autenticado recibe 403 al intentar consultar un pedido de invitado', async () => {
    const res = await request(app)
      .get(`/api/orders/${guestOrder._id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
    expect(res.body.mensaje).toMatch(/No tenés permiso/);
  });

  test('3. Admin accede: Administrador puede consultar cualquier pedido (registrado o invitado)', async () => {
    const resUserOrder = await request(app)
      .get(`/api/orders/${userOrder._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resUserOrder.status).toBe(200);
    expect(resUserOrder.body._id).toBe(userOrder._id.toString());

    const resGuestOrder = await request(app)
      .get(`/api/orders/${guestOrder._id}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(resGuestOrder.status).toBe(200);
    expect(resGuestOrder.body._id).toBe(guestOrder._id.toString());
  });

  test('4. Invitado no rompe: Consulta de pedido sin usuario y sin token devuelve 200', async () => {
    const res = await request(app)
      .get(`/api/orders/${guestOrder._id}`);

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(guestOrder._id.toString());
    expect(res.body.orderNumber).toBe('#102');
  });

  test('5. No autenticado recibe 401 si intenta ver un pedido de usuario registrado sin token', async () => {
    const res = await request(app)
      .get(`/api/orders/${userOrder._id}`);

    expect(res.status).toBe(401);
    expect(res.body.mensaje).toMatch(/Acceso no autorizado/);
  });
});
