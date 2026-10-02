'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Product = require('../src/models/product');
const Order = require('../src/models/Order');
const User = require('../src/models/User');
const orderService = require('../src/services/orderService');
const { generateTestMpSignature } = require('../src/utils/mpSignature');

// Mock global de emails para evitar llamadas salientes reales
jest.mock('../src/config/email', () => ({
    enviarEmailPedido: jest.fn().mockResolvedValue(true),
    enviarEmailSeguimiento: jest.fn().mockResolvedValue(true),
    enviarEmailEmpaquetado: jest.fn().mockResolvedValue(true),
    enviarEmailPagoAprobado: jest.fn().mockResolvedValue(true),
    enviarEmailNotificacionAdmin: jest.fn().mockResolvedValue(true),
    enviarConReintentos: jest.fn().mockResolvedValue(true)
}));

// Helper para firmar requests de webhook con la clave de test
function signedWebhookRequest(supertestRequest, dataId, overrideSecret = null, customTs = null) {
    const secret = overrideSecret !== null ? overrideSecret : process.env.MP_WEBHOOK_SECRET;
    const reqId = `req_${Math.random().toString(36).substring(2, 10)}`;
    const sigHeaders = generateTestMpSignature({
        dataId: String(dataId),
        requestId: reqId,
        secret,
        timestamp: customTs
    });

    return supertestRequest
        .set('x-signature', sigHeaders['x-signature'])
        .set('x-request-id', sigHeaders['x-request-id']);
}

describe('FASE 3 — Mercado Pago, Webhook Idempotente, FSM, Seguridad y Control de Stock Transaccional', () => {
    let brand;
    let category;
    let productA;
    let productB;
    let registeredUser;
    let otherUser;
    let adminUser;
    let userToken;
    let otherToken;
    let adminToken;

    beforeEach(async () => {
        brand = await Brand.create({
            slug: 'fit',
            name: 'Looser Fit',
            enabled: true
        });

        category = await Category.create({
            name: 'Pantalones',
            brand: brand._id
        });

        productA = await Product.create({
            nombre: 'Pantalón Cargo F3',
            precio: 35000,
            stock: 10,
            categoria: category._id,
            brand: brand._id,
            publicado: true
        });

        productB = await Product.create({
            nombre: 'Short Deportivo F3',
            precio: 20000,
            stock: 5,
            categoria: category._id,
            brand: brand._id,
            publicado: true
        });

        registeredUser = await User.create({
            nombre: 'Juan Comprador',
            email: 'juan@test.com',
            password: 'hashedpassword123',
            isAdmin: false
        });

        otherUser = await User.create({
            nombre: 'Usuario Ajeno',
            email: 'ajeno@test.com',
            password: 'hashedpassword123',
            isAdmin: false
        });

        adminUser = await User.create({
            nombre: 'Admin General',
            email: 'admin@looserfit.com',
            password: 'hashedpassword123',
            isAdmin: true
        });

        userToken = jwt.sign({ id: registeredUser._id.toString(), isAdmin: false }, process.env.JWT_SECRET);
        otherToken = jwt.sign({ id: otherUser._id.toString(), isAdmin: false }, process.env.JWT_SECRET);
        adminToken = jwt.sign({ id: adminUser._id.toString(), isAdmin: true }, process.env.JWT_SECRET);
    });

    // ── SEGURIDAD EN CREATE-PREFERENCE ─────────────────────────────────────────

    test('F3-SEC-PREF: /create-preference protege ownership de órdenes de usuarios registrados', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            usuario: registeredUser._id,
            datosEnvio: {
                nombreCompleto: 'Juan Comprador',
                email: 'juan@test.com',
                telefono: '1122334455',
                provincia: 'Buenos Aires',
                localidad: 'Avellaneda',
                direccionSucursal: 'Sucursal 1'
            }
        });

        // 1. Sin autenticación -> 401
        const resNoAuth = await request(app)
            .post('/api/payments/create-preference')
            .send({ orderId: order._id.toString() });
        expect(resNoAuth.status).toBe(401);

        // 2. Con token de otro usuario -> 403
        const resOther = await request(app)
            .post('/api/payments/create-preference')
            .set('Authorization', `Bearer ${otherToken}`)
            .send({ orderId: order._id.toString() });
        expect(resOther.status).toBe(403);

        // 3. Con token del propietario -> 200 (Mock Preference de MP)
        const resOwner = await request(app)
            .post('/api/payments/create-preference')
            .set('Authorization', `Bearer ${userToken}`)
            .send({ orderId: order._id.toString() });
        expect(resOwner.status).toBe(200);
        expect(resOwner.body.id).toBeDefined();

        // 4. Con token de Admin -> 200
        const resAdmin = await request(app)
            .post('/api/payments/create-preference')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ orderId: order._id.toString() });
        expect(resAdmin.status).toBe(200);
    });

    test('F3-SEC-PREF: /create-preference exige X-Guest-Token para órdenes de invitados', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Invitado F3',
                email: 'invitado@test.com',
                telefono: '1122334455',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal Quilmes'
            }
        });

        // 1. Sin X-Guest-Token -> 403
        const resNoGuestToken = await request(app)
            .post('/api/payments/create-preference')
            .send({ orderId: order._id.toString() });
        expect(resNoGuestToken.status).toBe(403);

        // 2. Con X-Guest-Token inválido -> 403
        const resBadToken = await request(app)
            .post('/api/payments/create-preference')
            .set('x-guest-token', 'token-invalido-123')
            .send({ orderId: order._id.toString() });
        expect(resBadToken.status).toBe(403);

        // 3. Con X-Guest-Token correcto -> 200
        const resValid = await request(app)
            .post('/api/payments/create-preference')
            .set('x-guest-token', order.trackingToken)
            .send({ orderId: order._id.toString() });
        expect(resValid.status).toBe(200);
        expect(resValid.body.id).toBeDefined();

        // Verificar que mpPreferenceId fue persistido en la orden
        const updatedOrder = await Order.findById(order._id);
        expect(updatedOrder.mpPreferenceId).toBe(resValid.body.id);
    });

    test('F3-PRICE: /create-preference congela precios del snapshot y rechaza stock insuficiente', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 5 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Stock Check',
                email: 'stock@test.com',
                telefono: '1122334455',
                provincia: 'Buenos Aires',
                localidad: 'Lanus',
                direccionSucursal: 'Sucursal Lanus'
            }
        });

        // Simular que el stock bajó a 2 después de crear la orden
        await Product.findByIdAndUpdate(productA._id, { stock: 2 });

        const res = await request(app)
            .post('/api/payments/create-preference')
            .set('x-guest-token', order.trackingToken)
            .send({ orderId: order._id.toString() });

        expect(res.status).toBe(400);
        expect(res.body.mensaje).toMatch(/no queda stock suficiente/i);
    });

    // ── SEGURIDAD CRIPTOGRÁFICA EN WEBHOOK ─────────────────────────────────────

    test('F3-SEC-SIG: Webhook rechaza peticiones sin firma o con firma inválida (401)', async () => {
        // 1. Sin headers de firma
        const resNoSig = await request(app)
            .post('/api/payments/webhook?topic=payment&id=888001')
            .send();
        expect(resNoSig.status).toBe(401);

        // 2. Con firma inválida (secreto erróneo)
        const reqInvalid = request(app).post('/api/payments/webhook?topic=payment&id=888001');
        const resInvalid = await signedWebhookRequest(reqInvalid, '888001', 'clave_falsa_invalida').send();
        expect(resInvalid.status).toBe(401);

        // 3. Con timestamp expirado (más de 10 minutos de antigüedad)
        const oldTimestamp = Math.floor(Date.now() / 1000) - (20 * 60); // 20 minutos atrás
        const reqExpired = request(app).post('/api/payments/webhook?topic=payment&id=888001');
        const resExpired = await signedWebhookRequest(reqExpired, '888001', null, oldTimestamp).send();
        expect(resExpired.status).toBe(401);
    });

    // ── VALIDACIÓN DE MONTO Y MONEDA ──────────────────────────────────────────

    test('F3-AMOUNT: Webhook rechaza montos o monedas alteradas sin marcar Pagado ni descontar stock', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 1 }], // 35000 + 7500 = 42500
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Monto Alterado',
                email: 'monto@test.com',
                telefono: '1122334455',
                provincia: 'Buenos Aires',
                localidad: 'Tigre',
                direccionSucursal: 'Sucursal Tigre'
            }
        });

        const originalFetch = global.fetch;

        try {
            // Caso A: Moneda incorrecta (USD en vez de ARS)
            global.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('api.mercadopago.com/v1/payments/999111')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            status: 'approved',
                            status_detail: 'accredited',
                            currency_id: 'USD',
                            transaction_amount: 42500,
                            external_reference: order._id.toString()
                        })
                    });
                }
                return originalFetch(url);
            });

            const reqA = request(app).post('/api/payments/webhook?topic=payment&id=999111');
            const resA = await signedWebhookRequest(reqA, '999111').send();
            expect(resA.status).toBe(200);

            let checkOrder = await Order.findById(order._id);
            expect(checkOrder.estado).toBe('Pendiente'); // No se debe marcar Pagado
            expect(checkOrder.stockAlert).toMatch(/Moneda de pago inválida/i);

            // Caso B: Monto manipulado (pagó $1000 en vez de $42500)
            global.fetch = jest.fn().mockImplementation((url) => {
                if (url.includes('api.mercadopago.com/v1/payments/999222')) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve({
                            status: 'approved',
                            status_detail: 'accredited',
                            currency_id: 'ARS',
                            transaction_amount: 1000,
                            external_reference: order._id.toString()
                        })
                    });
                }
                return originalFetch(url);
            });

            const reqB = request(app).post('/api/payments/webhook?topic=payment&id=999222');
            const resB = await signedWebhookRequest(reqB, '999222').send();
            expect(resB.status).toBe(200);

            checkOrder = await Order.findById(order._id);
            expect(checkOrder.estado).toBe('Pendiente'); // Sigue Pendiente
            expect(checkOrder.stockAlert).toMatch(/Discrepancia en importe/i);

            // El stock del producto debe permanecer intacto (10)
            const prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(10);
        } finally {
            global.fetch = originalFetch;
        }
    });

    // ── PROCESAMIENTO ATÓMICO Y TRANSACCIONAL ─────────────────────────────────

    test('F3.1 & F3.4: Webhook approved con firma válida descuenta stock transaccionalmente', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 2 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Comprador F3',
                email: 'f3@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Avellaneda',
                direccionSucursal: 'Sucursal Correo'
            }
        });

        const expectedTotal = order.total;

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777001')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'approved',
                        status_detail: 'accredited',
                        currency_id: 'ARS',
                        transaction_amount: expectedTotal,
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            const reqPost = request(app).post('/api/payments/webhook?topic=payment&id=777001');
            const res = await signedWebhookRequest(reqPost, '777001').send();

            expect(res.status).toBe(200);

            const updatedOrder = await Order.findById(order._id);
            expect(updatedOrder.estado).toBe('Pagado');
            expect(updatedOrder.mpPaymentId).toBe('777001');
            expect(updatedOrder.metodoPago).toBe('mercadopago');
            expect(updatedOrder.paymentProvider).toBe('mercadopago');
            expect(updatedOrder.paymentStatus).toBe('approved');
            expect(updatedOrder.paymentAmount).toBe(expectedTotal);
            expect(updatedOrder.paymentCurrency).toBe('ARS');
            expect(updatedOrder.paymentProcessedAt).toBeInstanceOf(Date);

            // Stock inicial: 10, comprado: 2 -> nuevo stock: 8
            const updatedProd = await Product.findById(productA._id);
            expect(updatedProd.stock).toBe(8);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('F3.3: Webhooks duplicados y múltiples para el mismo paymentId son estrictamente idempotentes', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 2 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Comprador Duplicado',
                email: 'duplicado@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Tigre',
                direccionSucursal: 'Sucursal Tigre'
            }
        });

        const expectedTotal = order.total;

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777002')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'approved',
                        status_detail: 'accredited',
                        currency_id: 'ARS',
                        transaction_amount: expectedTotal,
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            // Primer webhook
            const req1 = request(app).post('/api/payments/webhook?topic=payment&id=777002');
            const res1 = await signedWebhookRequest(req1, '777002').send();
            expect(res1.status).toBe(200);

            let prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);

            // Reintentos idénticos: 2da, 3ra, 4ta vez
            for (let i = 0; i < 3; i++) {
                const reqDup = request(app).post('/api/payments/webhook?topic=payment&id=777002');
                const resDup = await signedWebhookRequest(reqDup, '777002').send();
                expect(resDup.status).toBe(200);
            }

            // El stock NO debe haber bajado de 8
            prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('F3-MULTI-PAY: Múltiples pagos diferentes para la misma orden no duplican stock y alertan anomalía', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 2 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Doble Pago',
                email: 'doblepago@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Tigre',
                direccionSucursal: 'Sucursal Tigre'
            }
        });

        const expectedTotal = order.total;

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777010')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'approved',
                        status_detail: 'accredited',
                        currency_id: 'ARS',
                        transaction_amount: expectedTotal,
                        external_reference: order._id.toString()
                    })
                });
            }
            if (url.includes('api.mercadopago.com/v1/payments/777020')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'approved',
                        status_detail: 'accredited',
                        currency_id: 'ARS',
                        transaction_amount: expectedTotal,
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            // Primer pago válido (777010)
            const req1 = request(app).post('/api/payments/webhook?topic=payment&id=777010');
            const res1 = await signedWebhookRequest(req1, '777010').send();
            expect(res1.status).toBe(200);

            let prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);

            // Segundo pago DISTINTO (777020) para la misma orden
            const req2 = request(app).post('/api/payments/webhook?topic=payment&id=777020');
            const res2 = await signedWebhookRequest(req2, '777020').send();
            expect(res2.status).toBe(200);

            // El stock NO debe descontarse nuevamente (debe seguir en 8, no en 6)
            prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);

            const orderCheck = await Order.findById(order._id);
            expect(orderCheck.stockAlert).toMatch(/Anomalía de cobro/i);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('F3.6 & F3.7: Transacción aborta atómicamente si falta stock en algún producto', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [
                { productoId: productA._id, cantidad: 2 },
                { productoId: productB._id, cantidad: 1 }
            ],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Test Rollback',
                email: 'rollback@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal Quilmes'
            }
        });

        // Simular que el stock de productB se agotó justo antes de acreditarse el pago
        await Product.findByIdAndUpdate(productB._id, { stock: 0 });

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777005')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'approved',
                        status_detail: 'accredited',
                        currency_id: 'ARS',
                        transaction_amount: order.total,
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            const reqPost = request(app).post('/api/payments/webhook?topic=payment&id=777005');
            const res = await signedWebhookRequest(reqPost, '777005').send();

            expect(res.status).toBe(200);

            // Debido al abortTransaction, productA no debe quedar descontado. Su stock debe seguir en 10.
            const prodACheck = await Product.findById(productA._id);
            expect(prodACheck.stock).toBe(10);

            const orderCheck = await Order.findById(order._id);
            expect(orderCheck.estado).toBe('ConflictoStock');
            expect(orderCheck.stockAlert).toMatch(/Stock insuficiente al momento de acreditar el pago/i);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test('F3.5: Máquina de estados FSM protege ciclo de vida de pedidos', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Test FSM',
                email: 'fsm@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal 1'
            }
        });

        expect(order.estado).toBe('Pendiente');

        const pagado = await orderService.updateOrderStatus(order._id, 'Pagado');
        expect(pagado.estado).toBe('Pagado');

        const empaquetado = await orderService.updateOrderStatus(order._id, 'Empaquetado');
        expect(empaquetado.estado).toBe('Empaquetado');

        const enviado = await orderService.updateOrderStatus(order._id, 'Enviado');
        expect(enviado.estado).toBe('Enviado');

        const entregado = await orderService.updateOrderStatus(order._id, 'Entregado');
        expect(entregado.estado).toBe('Entregado');

        // Transición INVÁLIDA: Entregado -> Pendiente
        await expect(
            orderService.updateOrderStatus(order._id, 'Pendiente')
        ).rejects.toThrow(/Transición de estado inválida/);
    });
});
