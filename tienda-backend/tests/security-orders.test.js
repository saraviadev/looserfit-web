const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Order = require('../src/models/Order');
const User = require('../src/models/User');
const storage = require('../src/config/storage');

describe('FASE 1 — Hardening de Seguridad (SEC-01 / SEC-02 / SEC-03)', () => {
    let brand;
    let userA;
    let userB;
    let adminUser;
    let tokenUserA;
    let tokenUserB;
    let tokenAdmin;
    let orderUserA;
    let orderGuest1;
    let orderGuest2;

    // Buffer válido de imagen JPEG (Magic bytes: FF D8 FF)
    const validJpegBuffer = Buffer.from([
        0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
        0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48,
        0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
        0xFF, 0xD9
    ]);

    beforeEach(async () => {
        // Mock de ImageKit para subida controlada sin llamadas salientes
        jest.spyOn(storage.imagekit, 'upload').mockResolvedValue({ url: 'https://ik.imagekit.io/looserfit/mock-comprobante.jpg' });

        brand = await Brand.create({
            slug: 'fit',
            name: 'Looser Fit',
            enabled: true
        });

        userA = await User.create({
            nombre: 'Usuario Propietario A',
            email: 'usera@test.com',
            password: 'password123',
            isAdmin: false
        });

        userB = await User.create({
            nombre: 'Usuario Atacante B',
            email: 'userb@test.com',
            password: 'password123',
            isAdmin: false
        });

        adminUser = await User.create({
            nombre: 'Administrador Tienda',
            email: 'admin@looserfit.com',
            password: 'password123',
            isAdmin: true
        });

        const secret = process.env.JWT_SECRET;
        tokenUserA = jwt.sign({ id: userA._id, isAdmin: false }, secret);
        tokenUserB = jwt.sign({ id: userB._id, isAdmin: false }, secret);
        tokenAdmin = jwt.sign({ id: adminUser._id, isAdmin: true }, secret);

        // Orden de usuario registrado A
        orderUserA = await Order.create({
            brand: brand._id,
            usuario: userA._id,
            productos: [],
            total: 25000,
            tipoEnvio: 'domicilio',
            datosEnvio: {
                nombreCompleto: 'Usuario A',
                email: 'usera@test.com',
                telefono: '1122334455',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                calleNumero: 'San Martin 123',
                codigoPostal: '1878'
            },
            estado: 'Pendiente',
            orderNumber: '#050',
            trackingToken: 'token_hex_usera_050_sec12345678',
            shippingCost: 11000
        });

        // Orden de invitado 1
        orderGuest1 = await Order.create({
            brand: brand._id,
            usuario: null,
            productos: [],
            total: 30000,
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Invitado Comprador 1',
                email: 'invitado1@cliente.com',
                telefono: '1199887766',
                provincia: 'Capital Federal',
                localidad: 'Palermo',
                direccionSucursal: 'Sucursal Correo Palermo'
            },
            estado: 'Pendiente',
            orderNumber: '#051',
            trackingToken: 'guest_token_order1_051_abcdef12',
            shippingCost: 7500
        });

        // Orden de invitado 2
        orderGuest2 = await Order.create({
            brand: brand._id,
            usuario: null,
            productos: [],
            total: 18000,
            tipoEnvio: 'domicilio',
            datosEnvio: {
                nombreCompleto: 'Invitado Comprador 2',
                email: 'invitado2@cliente.com',
                telefono: '1155443322',
                provincia: 'Santa Fe',
                localidad: 'Rosario',
                calleNumero: 'Cordoba 456',
                codigoPostal: '2000'
            },
            estado: 'Pendiente',
            orderNumber: '#052',
            trackingToken: 'guest_token_order2_052_fedcba98',
            shippingCost: 11000
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // =========================================================================
    // 1. SEC-01 — PROTECCIÓN DE PEDIDOS DE INVITADOS (GET /api/orders/:id)
    // =========================================================================
    describe('SEC-01 — Control de Acceso y Autorización en Pedidos', () => {
        test('TEST_SEC01_A: Usuario A consulta orden de usuario B -> 403', async () => {
            const res = await request(app)
                .get(`/api/orders/${orderUserA._id}`)
                .set('Authorization', `Bearer ${tokenUserB}`);

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/No tenés permiso/);
        });

        test('TEST_SEC01_B: Usuario A (o cualquier usuario) consulta orden de invitado sin Guest Token -> 403', async () => {
            const res = await request(app)
                .get(`/api/orders/${orderGuest1._id}`)
                .set('Authorization', `Bearer ${tokenUserA}`);

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/se requiere token de invitado/);
        });

        test('TEST_SEC01_C: Guest consulta su orden con token correcto -> 200 y sanitizado', async () => {
            const res = await request(app)
                .get(`/api/orders/${orderGuest1._id}`)
                .set('X-Guest-Token', 'guest_token_order1_051_abcdef12');

            expect(res.status).toBe(200);
            expect(res.body._id).toBe(orderGuest1._id.toString());
            expect(res.body.orderNumber).toBe('#051');
            // Sanitización: trackingToken no debe ser expuesto en el cuerpo
            expect(res.body.trackingToken).toBeUndefined();
        });

        test('TEST_SEC01_D: Guest consulta otra orden con token válido de una orden diferente -> 403', async () => {
            const res = await request(app)
                .get(`/api/orders/${orderGuest1._id}`)
                .set('X-Guest-Token', 'guest_token_order2_052_fedcba98'); // Token de guest 2 usado en guest 1

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/Token de invitado no válido/);
        });

        test('TEST_SEC01_E: Guest utiliza token inexistente o inventado -> 403', async () => {
            const res = await request(app)
                .get(`/api/orders/${orderGuest1._id}`)
                .set('X-Guest-Token', 'token_falso_inexistente_99999999');

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/Token de invitado no válido/);
        });

        test('TEST_SEC01_EXTRA: Administrador puede consultar cualquier orden con status 200', async () => {
            const resGuest = await request(app)
                .get(`/api/orders/${orderGuest1._id}`)
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(resGuest.status).toBe(200);
            expect(resGuest.body._id).toBe(orderGuest1._id.toString());

            const resUser = await request(app)
                .get(`/api/orders/${orderUserA._id}`)
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(resUser.status).toBe(200);
            expect(resUser.body._id).toBe(orderUserA._id.toString());
        });
    });

    // =========================================================================
    // 2. SEC-02 — VALIDACIÓN ESTRICTA EN REGISTER FROM ORDER
    // =========================================================================
    describe('SEC-02 — Register From Order con Coincidencia Estricta de Emails', () => {
        test('TEST_SEC02_A: orderId de A + email de B -> 400/403 rechazado', async () => {
            const res = await request(app)
                .post('/api/auth/register-from-order')
                .send({
                    email: 'hacker@malicioso.com',
                    nombre: 'Atacante',
                    password: 'password123',
                    orderId: orderGuest1._id
                });

            expect([400, 403]).toContain(res.status);
            expect(res.body.error).toMatch(/no coincide con el email del pedido/);

            // Verificar que la orden no fue vinculada al atacante
            const orderCheck = await Order.findById(orderGuest1._id);
            expect(orderCheck.usuario).toBeNull();
        });

        test('TEST_SEC02_B: orderId de A + email de A (con diferente capitalización y espacios) -> 201', async () => {
            const res = await request(app)
                .post('/api/auth/register-from-order')
                .send({
                    email: '  INVITADO1@CLIENTE.COM  ', // Normalización requerida
                    nombre: 'Invitado Comprador 1',
                    password: 'password123',
                    orderId: orderGuest1._id
                });

            expect(res.status).toBe(201);
            expect(res.body.token).toBeDefined();
            expect(res.body.user.email).toBe('invitado1@cliente.com');

            // Verificar que la orden fue efectivamente asociada
            const orderCheck = await Order.findById(orderGuest1._id);
            expect(orderCheck.usuario.toString()).toBe(res.body.user.id.toString());
        });

        test('TEST_SEC02_C: orden ya asociada a un usuario -> rechazo (400/409)', async () => {
            const res = await request(app)
                .post('/api/auth/register-from-order')
                .send({
                    email: 'usera@test.com',
                    nombre: 'Usuario Intento Reasignar',
                    password: 'password123',
                    orderId: orderUserA._id // orderUserA ya tiene usuario: userA._id
                });

            expect([400, 409]).toContain(res.status);
            expect(res.body.error).toBeDefined();
        });

        test('TEST_SEC02_D: orden inexistente -> rechazo (400/404)', async () => {
            const fakeOrderId = '60d5ec49f1b2c82b88123456';
            const res = await request(app)
                .post('/api/auth/register-from-order')
                .send({
                    email: 'nuevo@cliente.com',
                    nombre: 'Cliente',
                    password: 'password123',
                    orderId: fakeOrderId
                });

            expect([400, 404]).toContain(res.status);
            expect(res.body.error).toMatch(/Pedido no encontrado/);
        });
    });

    // =========================================================================
    // 3. SEC-03 — UPLOAD DE COMPROBANTE Y VALIDACIÓN DE ARCHIVOS
    // =========================================================================
    describe('SEC-03 — Upload de Comprobante y Políticas de Archivo', () => {
        test('TEST_SEC03_A: upload sin credencial -> 401/403', async () => {
            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest1._id}`)
                .attach('comprobante', validJpegBuffer, 'comprobante.jpg');

            expect([401, 403]).toContain(res.status);
        });

        test('TEST_SEC03_B: upload con token incorrecto -> 403', async () => {
            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest1._id}`)
                .set('X-Guest-Token', 'token_invalido_xyz')
                .attach('comprobante', validJpegBuffer, 'comprobante.jpg');

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/Token de invitado no válido/);
        });

        test('TEST_SEC03_C: upload con token de otra orden -> 403', async () => {
            const res = await request(app)
                .post(`/api/orders/${orderGuest1._id}/upload-comprobante/${orderGuest1._id}`)
                .set('X-Guest-Token', 'guest_token_order2_052_fedcba98') // Token perteneciente a orderGuest2
                .attach('comprobante', validJpegBuffer, 'comprobante.jpg');

            expect([403, 404]).toContain(res.status);
        });

        test('TEST_SEC03_D: upload autorizado con guest token correcto -> 200', async () => {
            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest1._id}`)
                .set('X-Guest-Token', 'guest_token_order1_051_abcdef12')
                .attach('comprobante', validJpegBuffer, 'comprobante.jpg');

            expect(res.status).toBe(200);
            expect(res.body.mensaje).toMatch(/Comprobante subido con éxito/);
            expect(res.body.pedido.comprobante).toMatch(/https:\/\/ik\.imagekit\.io/);

            // Verificar que no permite sobrescritura arbitraria una vez cargado
            const resOverwrite = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest1._id}`)
                .set('X-Guest-Token', 'guest_token_order1_051_abcdef12')
                .attach('comprobante', validJpegBuffer, 'otro_comprobante.jpg');

            expect(resOverwrite.status).toBe(400);
            expect(resOverwrite.body.mensaje).toMatch(/ya tiene un comprobante adjunto/);
        });

        test('TEST_SEC03_E: archivo no permitido (ejecutable / html / extensión falsa) -> 400/415', async () => {
            const dangerousBuffer = Buffer.from('<script>alert("XSS")</script>');
            
            // Intento 1: Extensión no permitida (.html)
            const resHtml = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest2._id}`)
                .set('X-Guest-Token', 'guest_token_order2_052_fedcba98')
                .attach('comprobante', dangerousBuffer, 'payload.html');

            expect([400, 415]).toContain(resHtml.status);

            // Intento 2: Extensión falsa .jpg con contenido script (falla inspección Magic Bytes)
            const resFakeJpg = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest2._id}`)
                .set('X-Guest-Token', 'guest_token_order2_052_fedcba98')
                .attach('comprobante', dangerousBuffer, 'fake.jpg');

            expect([400, 415]).toContain(resFakeJpg.status);
            expect(resFakeJpg.body.mensaje).toMatch(/Tipo de archivo no permitido/);
        });

        test('TEST_SEC03_F: archivo excede límite de 5MB -> 400/413', async () => {
            // Buffer de 5.5MB con cabecera JPEG
            const oversizedBuffer = Buffer.alloc(5.5 * 1024 * 1024);
            oversizedBuffer[0] = 0xFF;
            oversizedBuffer[1] = 0xD8;
            oversizedBuffer[2] = 0xFF;

            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${orderGuest2._id}`)
                .set('X-Guest-Token', 'guest_token_order2_052_fedcba98')
                .attach('comprobante', oversizedBuffer, 'pesada.jpg');

            expect([400, 413]).toContain(res.status);
            expect(res.body.mensaje).toMatch(/excede el tamaño máximo/);
        });
    });
});
