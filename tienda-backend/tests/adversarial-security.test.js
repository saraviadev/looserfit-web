'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const app = require('../index');
const Order = require('../src/models/Order');
const Product = require('../src/models/product');
const Category = require('../src/models/Category');
const Brand = require('../src/models/Brand');
const User = require('../src/models/User');

describe('SUITE ADVERSARIAL: Pruebas de Estrés, Seguridad y Penetración', () => {
    let brandFit, brandSport;
    let catFit, catSport;
    let productFit, productSport;
    let userA, userB, adminUser;
    let tokenUserA, tokenUserB, tokenAdmin;

    beforeEach(async () => {
        // Inicializar marcas
        brandFit = await Brand.create({
            name: 'Looser Fit',
            slug: 'fit',
            order: 1,
            enabled: true
        });

        brandSport = await Brand.create({
            name: 'Looser Sport',
            slug: 'sport',
            order: 2,
            enabled: true
        });

        // Categorías por marca
        catFit = await Category.create({ name: 'Remeras', brand: brandFit._id });
        catSport = await Category.create({ name: 'Shorts', brand: brandSport._id });

        // Productos
        productFit = await Product.create({
            nombre: 'Remera Oversize Heavyweight',
            precio: 35000,
            precioOferta: 30000,
            stock: 20,
            publicado: true,
            categoria: catFit._id,
            brand: brandFit._id
        });

        productSport = await Product.create({
            nombre: 'Short Deportivo Pro',
            precio: 25000,
            stock: 20,
            publicado: true,
            categoria: catSport._id,
            brand: brandSport._id
        });

        // Usuarios
        userA = await User.create({
            nombre: 'Victim User',
            email: 'victim@adversarial.com',
            password: 'Password123!',
            isAdmin: false
        });

        userB = await User.create({
            nombre: 'Attacker User',
            email: 'attacker@adversarial.com',
            password: 'Password123!',
            isAdmin: false
        });

        adminUser = await User.create({
            nombre: 'Admin Master',
            email: 'admin@adversarial.com',
            password: 'Password123!',
            isAdmin: true
        });

        const secret = process.env.JWT_SECRET || 'test_jwt_secret_super_safe_12345';
        tokenUserA = jwt.sign({ id: userA._id, isAdmin: false }, secret, { expiresIn: '1h' });
        tokenUserB = jwt.sign({ id: userB._id, isAdmin: false }, secret, { expiresIn: '1h' });
        tokenAdmin = jwt.sign({ id: adminUser._id, isAdmin: true }, secret, { expiresIn: '1h' });
    });

    describe('1. Manipulación de Datos en Checkout (Precios, Envíos, Identidad)', () => {
        test('ADV-01: Atacante envía precio unitario $1 y total $1 -> Servidor ignora y cobra precio real de BD', async () => {
            const res = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{
                        productoId: productFit._id,
                        cantidad: 1,
                        precio: 1
                    }],
                    total: 1,
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Comprador Hacker',
                        email: 'hacker@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal Correo Quilmes'
                    }
                });

            expect(res.status).toBe(201);
            expect(res.body.pedido.total).toBe(37500);
            expect(res.body.pedido.shippingCost).toBe(7500);
            expect(res.body.pedido.productos[0].precio).toBe(35000);
            expect(res.body.pedido.productos[0].precioOferta).toBe(30000);
        });

        test('ADV-02: Modalidad de envío inválida es rechazada con 400', async () => {
            const res = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'envio_gratis_falso',
                    datosEnvio: {
                        nombreCompleto: 'Hacker',
                        email: 'hacker@test.com',
                        telefono: '1133445566',
                        provincia: 'BA',
                        localidad: 'La Plata'
                    }
                });

            expect(res.status).toBe(400);
            expect(res.body.error || res.body.mensaje).toMatch(/Modalidad de envío inválida/);
        });

        test('ADV-03: Envío a domicilio sin calle y número es rechazado con 400', async () => {
            const res = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'domicilio',
                    datosEnvio: {
                        nombreCompleto: 'Juan Test',
                        email: 'juan@test.com',
                        telefono: '1133445566',
                        provincia: 'CABA',
                        localidad: 'Belgrano'
                    }
                });

            expect(res.status).toBe(400);
            expect(res.body.error || res.body.mensaje).toMatch(/Calle y número son obligatorios/);
        });

        test('ADV-04: Atacante no autenticado intenta inyectar usuario de víctima en el body -> Pedido queda como invitado', async () => {
            const res = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    usuario: userA._id,
                    datosEnvio: {
                        nombreCompleto: 'Hacker Infiltrado',
                        email: 'hacker@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });

            expect(res.status).toBe(201);
            expect(res.body.pedido.usuario).toBeNull();
        });

        test('ADV-05: Usuario autenticado compra -> Pedido se vincula automáticamente a su cuenta', async () => {
            const res = await request(app)
                .post('/api/orders/create?brand=fit')
                .set('Authorization', `Bearer ${tokenUserA}`)
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Victim User',
                        email: 'victim@adversarial.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });

            expect(res.status).toBe(201);
            expect(String(res.body.pedido.usuario)).toBe(String(userA._id));
        });
    });

    describe('2. Seguimiento Público y Fuga de Información Sensible', () => {
        test('ADV-06: GET /api/orders/track/:token minimiza estrictamente los datos privados', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'domicilio',
                    datosEnvio: {
                        nombreCompleto: 'Mariano Moreno',
                        email: 'mariano.moreno@revolucion.gob.ar',
                        telefono: '1199887766',
                        provincia: 'Buenos Aires',
                        localidad: 'San Telmo',
                        calleNumero: 'Defensa 1234',
                        dni: '12345678'
                    }
                });
            const testOrder = orderRes.body.pedido;

            const res = await request(app).get(`/api/orders/track/${testOrder.trackingToken}`);
            expect(res.status).toBe(200);

            expect(res.body.trackingToken).toBeUndefined();
            expect(res.body.usuario).toBeUndefined();
            expect(res.body.datosEnvio.email).toBeUndefined();
            expect(res.body.datosEnvio.telefono).toBeUndefined();
            expect(res.body.datosEnvio.dni).toBe('***5678');
            expect(res.body.datosEnvio.calleNumero).toBe('Defensa ***');
            expect(res.body.datosEnvio.nombreCompleto).toBe('Mariano M.');
            expect(res.body.comprobante).toBeUndefined();
            expect(res.body.mpPaymentId).toBeUndefined();
            expect(res.body.mpPreferenceId).toBeUndefined();
        });

        test('ADV-07: Consulta con token inexistente devuelve 404', async () => {
            const res = await request(app).get('/api/orders/track/token_totalmente_inventado_12345');
            expect(res.status).toBe(404);
            expect(res.body.mensaje).toMatch(/Link de seguimiento inválido/);
        });
    });

    describe('3. Almacenamiento y Protección de Comprobantes', () => {
        test('ADV-08: Subida de comprobante PDF válido con magic bytes %PDF -> Aceptado 200', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Cliente Comprobante',
                        email: 'cliente.recibo@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const guestOrder = orderRes.body.pedido;

            const validPdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Title (Recibo Oficial) >>\nendobj\nxref\ntrailer\nstartxref\n%%EOF');

            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${guestOrder._id}`)
                .set('x-guest-token', guestOrder.trackingToken)
                .attach('comprobante', validPdfBuffer, 'comprobante_banco.pdf');

            expect(res.status).toBe(200);
            expect(res.body.mensaje).toMatch(/Comprobante subido con éxito/);
            expect(res.body.pedido.comprobante).toBeDefined();
        });

        test('ADV-09: Archivo malicioso camuflado como imagen (.jpg pero contenido ejecutable) -> Rechazado 400 por Magic Bytes', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Cliente Fake',
                        email: 'fake@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const fakeOrder = orderRes.body.pedido;

            const maliciousBuffer = Buffer.from('MZ... Windows Executable Fake Header Content');

            const res = await request(app)
                .post(`/api/orders/upload-comprobante/${fakeOrder._id}`)
                .set('x-guest-token', fakeOrder.trackingToken)
                .attach('comprobante', maliciousBuffer, 'payload.jpg');

            expect(res.status).toBe(400);
            expect(res.body.mensaje).toMatch(/Tipo de archivo no permitido/);
        });

        test('ADV-10: Usuario no autorizado intenta acceder al comprobante de la orden -> 401/403', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Cliente Comprobante',
                        email: 'cliente.recibo@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const guestOrder = orderRes.body.pedido;

            const res = await request(app)
                .get(`/api/orders/${guestOrder._id}/comprobante`);
            expect([401, 403]).toContain(res.status);
        });

        test('ADV-11: Guest con token correcto accede a su comprobante -> 200', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productFit._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Cliente Comprobante',
                        email: 'cliente.recibo@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const guestOrder = orderRes.body.pedido;

            const validPdf = Buffer.from('%PDF-1.4\ntest');
            await request(app)
                .post(`/api/orders/upload-comprobante/${guestOrder._id}`)
                .set('x-guest-token', guestOrder.trackingToken)
                .attach('comprobante', validPdf, 'recibo.pdf');

            const res = await request(app)
                .get(`/api/orders/${guestOrder._id}/comprobante`)
                .set('x-guest-token', guestOrder.trackingToken);
            expect(res.status).toBe(200);
            expect(res.body.comprobante).toBeDefined();
        });
    });

    describe('4. Aislamiento Multi-Marca Fit vs Sport', () => {
        test('ADV-12: Petición con marca Fit no puede modificar producto de Sport -> 403', async () => {
            const res = await request(app)
                .put(`/api/products/${productSport._id}?brand=fit`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({ precio: 99999 });

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/No tenés permiso para modificar un producto de otra marca/);
        });

        test('ADV-13: Petición con marca Fit no puede eliminar producto de Sport -> 403', async () => {
            const res = await request(app)
                .delete(`/api/products/${productSport._id}?brand=fit`)
                .set('Authorization', `Bearer ${tokenAdmin}`);

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/No tenés permiso para eliminar un producto de otra marca/);
        });

        test('ADV-14: Petición con marca Sport no puede modificar categoría de Fit -> 403', async () => {
            const res = await request(app)
                .put(`/api/categories/${catFit._id}?brand=sport`)
                .set('Authorization', `Bearer ${tokenAdmin}`)
                .send({ name: 'Remeras Hackeadas' });

            expect(res.status).toBe(403);
            expect(res.body.mensaje).toMatch(/No tenés permiso para modificar una categoría de otra marca/);
        });
    });

    describe('5. Hardening de Webhook Mercado Pago y Validación Criptográfica', () => {
        test('ADV-15: Webhook con firma HMAC inválida -> Rechazado 401', async () => {
            const currentTs = Math.floor(Date.now() / 1000);
            const res = await request(app)
                .post('/api/payments/webhook?topic=payment&id=123456')
                .set('x-signature', `ts=${currentTs},v1=bad_hmac_hash_000000000000000000000000`)
                .set('x-request-id', 'req-123456')
                .send({});

            expect(res.status).toBe(401);
            expect(res.body.motivo || res.body.mensaje).toMatch(/Firma.*inválida|Firma HMAC no coincide|Firma de webhook/);
        });

        test('ADV-16: Webhook con timestamp expirado (>5 min drift) -> Rechazado 401', async () => {
            const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
            const secret = process.env.MP_WEBHOOK_SECRET || 'test_webhook_secret_mp_789xyz';
            const manifest = `id:123456;request-id:req-drift;ts:${oldTimestamp};`;
            const hmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

            const res = await request(app)
                .post('/api/payments/webhook?topic=payment&id=123456')
                .set('x-signature', `ts=${oldTimestamp},v1=${hmac}`)
                .set('x-request-id', 'req-drift')
                .send({});

            expect(res.status).toBe(401);
            expect(res.body.motivo || res.body.mensaje).toMatch(/expirado|fuera de rango/);
        });

        test('ADV-17: Intento de pagar con moneda diferente a ARS (ej. USD) -> Rechazado', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productSport._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Pagador MP',
                        email: 'pagador@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const orderForPayment = orderRes.body.pedido;

            const paymentId = '999111';
            const ts = Math.floor(Date.now() / 1000);
            const secret = process.env.MP_WEBHOOK_SECRET || 'test_webhook_secret_mp_789xyz';
            const manifest = `id:${paymentId};request-id:req-curr;ts:${ts};`;
            const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

            const originalFetch = global.fetch;
            global.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('/v1/payments/')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        text: () => Promise.resolve(''),
                        json: () => Promise.resolve({
                            id: 999111,
                            status: 'approved',
                            status_detail: 'accredited',
                            currency_id: 'USD',
                            transaction_amount: 32500,
                            external_reference: String(orderForPayment._id)
                        })
                    });
                }
                return originalFetch(url);
            });

            const res = await request(app)
                .post(`/api/payments/webhook?topic=payment&id=${paymentId}`)
                .set('x-signature', `ts=${ts},v1=${v1}`)
                .set('x-request-id', 'req-curr')
                .send({});

            expect(res.status).toBe(200);

            const orderCheck = await Order.findById(orderForPayment._id);
            expect(orderCheck.estado).toBe('Pendiente');
            expect(orderCheck.stockAlert).toMatch(/Moneda de pago inválida/);

            global.fetch = originalFetch;
        });

        test('ADV-18: Intento de pagar monto inferior al total de la orden -> Flag de monto incorrecto', async () => {
            const orderRes = await request(app)
                .post('/api/orders/create?brand=fit')
                .send({
                    productos: [{ productoId: productSport._id, cantidad: 1 }],
                    tipoEnvio: 'sucursal',
                    datosEnvio: {
                        nombreCompleto: 'Pagador MP 2',
                        email: 'pagador2@test.com',
                        telefono: '1133445566',
                        provincia: 'Buenos Aires',
                        localidad: 'Quilmes',
                        direccionSucursal: 'Sucursal 1'
                    }
                });
            const orderForPayment = orderRes.body.pedido;

            const paymentId = '999222';
            const ts = Math.floor(Date.now() / 1000);
            const secret = process.env.MP_WEBHOOK_SECRET || 'test_webhook_secret_mp_789xyz';
            const manifest = `id:${paymentId};request-id:req-amt;ts:${ts};`;
            const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

            const originalFetch = global.fetch;
            global.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('/v1/payments/')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        text: () => Promise.resolve(''),
                        json: () => Promise.resolve({
                            id: 999222,
                            status: 'approved',
                            status_detail: 'accredited',
                            currency_id: 'ARS',
                            transaction_amount: 100,
                            external_reference: String(orderForPayment._id)
                        })
                    });
                }
                return originalFetch(url);
            });

            const res = await request(app)
                .post(`/api/payments/webhook?topic=payment&id=${paymentId}`)
                .set('x-signature', `ts=${ts},v1=${v1}`)
                .set('x-request-id', 'req-amt')
                .send({});

            expect(res.status).toBe(200);

            const orderCheck = await Order.findById(orderForPayment._id);
            expect(orderCheck.estado).toBe('Pendiente');
            expect(orderCheck.stockAlert).toMatch(/Discrepancia en importe abonado/);

            global.fetch = originalFetch;
        });
    });
});
