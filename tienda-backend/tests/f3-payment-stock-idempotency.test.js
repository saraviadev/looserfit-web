const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Product = require('../src/models/product');
const Order = require('../src/models/Order');
const orderService = require('../src/services/orderService');

// Mock global de emails para evitar llamadas salientes reales
jest.mock('../src/config/email', () => ({
    enviarEmailPedido: jest.fn().mockResolvedValue(true),
    enviarEmailSeguimiento: jest.fn().mockResolvedValue(true),
    enviarEmailEmpaquetado: jest.fn().mockResolvedValue(true),
    enviarEmailPagoAprobado: jest.fn().mockResolvedValue(true),
    enviarEmailNotificacionAdmin: jest.fn().mockResolvedValue(true),
    enviarConReintentos: jest.fn().mockResolvedValue(true)
}));

describe('FASE 3 — Mercado Pago, Webhook Idempotente, FSM y Control de Stock Atómico', () => {
    let brand;
    let category;
    let productA;
    let productB;

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
    });

    // 1. Webhook Approved básico con persistencia y descuento de stock
    test('F3.1 & F3.4: Webhook approved persiste mpPaymentId, metodoPago y descuenta stock atómicamente', async () => {
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

        // Simular que otro usuario agotó el stock de productB entre la creación de la orden y la confirmación del pago
        await Product.findByIdAndUpdate(productB._id, { stock: 0 });

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777001')) {
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
                .post('/api/payments/webhook?topic=payment&id=777001')
                .send();

            expect(res.status).toBe(200);

            const updatedOrder = await Order.findById(order._id);
            expect(updatedOrder.estado).toBe('Pagado');
            expect(updatedOrder.mpPaymentId).toBe('777001');
            expect(updatedOrder.metodoPago).toBe('mercadopago');
            expect(updatedOrder.mpStatus).toBe('approved');
            expect(updatedOrder.paymentProcessedAt).toBeInstanceOf(Date);

            // Stock inicial: 10, comprado: 2 -> nuevo stock: 8
            const updatedProd = await Product.findById(productA._id);
            expect(updatedProd.stock).toBe(8);
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 2. Idempotencia ante Webhooks Duplicados (entrega secuencial del mismo paymentId)
    test('F3.3: Webhook duplicado no vuelve a descontar stock ni altera la orden', async () => {
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

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777002')) {
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
            // Primer webhook
            const res1 = await request(app)
                .post('/api/payments/webhook?topic=payment&id=777002')
                .send();
            expect(res1.status).toBe(200);

            let prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);

            // Segundo webhook exactamente idéntico (reintento de MP)
            const res2 = await request(app)
                .post('/api/payments/webhook?topic=payment&id=777002')
                .send();
            expect(res2.status).toBe(200);

            // El stock NO debe haber bajado a 6, debe seguir en 8
            prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(8);
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 3. Webhooks Simultáneos / Concurrentes (Race condition test)
    test('F3.3: Webhooks concurrentes para la misma orden descuentan stock exactamente 1 vez', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 3 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Comprador Concurrente',
                email: 'concurrentemp@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Lanus',
                direccionSucursal: 'Sucursal Lanus'
            }
        });

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777003')) {
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
            // Disparar dos peticiones concurrentes simultáneas
            const [resA, resB] = await Promise.all([
                request(app).post('/api/payments/webhook?topic=payment&id=777003').send(),
                request(app).post('/api/payments/webhook?topic=payment&id=777003').send()
            ]);

            expect(resA.status).toBe(200);
            expect(resB.status).toBe(200);

            // Stock inicial 10 - 3 = 7 (no 4)
            const prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(7);

            const orderCheck = await Order.findById(order._id);
            expect(orderCheck.estado).toBe('Pagado');
            expect(orderCheck.mpPaymentId).toBe('777003');
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 4. Pago rechazado o cancelado: no descuenta stock
    test('F3.6: Pago rechazado/cancelado actualiza mpStatus pero no descuenta stock', async () => {
        const order = await orderService.createOrder({
            brand: brand._id,
            productos: [{ productoId: productA._id, cantidad: 2 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Pago Rechazado',
                email: 'rechazado@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal Quilmes'
            }
        });

        const originalFetch = global.fetch;
        global.fetch = jest.fn().mockImplementation((url) => {
            if (url.includes('api.mercadopago.com/v1/payments/777004')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve({
                        status: 'rejected',
                        status_detail: 'cc_rejected_insufficient_amount',
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            const res = await request(app)
                .post('/api/payments/webhook?topic=payment&id=777004')
                .send();

            expect(res.status).toBe(200);

            const orderCheck = await Order.findById(order._id);
            expect(orderCheck.estado).toBe('Pendiente');
            expect(orderCheck.mpStatus).toBe('rejected');
            expect(orderCheck.mpPaymentId).toBe('777004');

            // Stock no debe modificarse (sigue en 10)
            const prodCheck = await Product.findById(productA._id);
            expect(prodCheck.stock).toBe(10);
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 5. Stock Rollback: Falla parcial en orden con múltiples productos
    test('F3.6 & F3.7: Rollback de stock atómico si uno de los productos no tiene stock suficiente al aprobar pago', async () => {
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

        // Simular que otro usuario compró el stock de productB justo antes del webhook
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
                        external_reference: order._id.toString()
                    })
                });
            }
            return originalFetch(url);
        });

        try {
            const res = await request(app)
                .post('/api/payments/webhook?topic=payment&id=777005')
                .send();

            expect(res.status).toBe(200);

            // productA tenía stock 10, fue descontado temporalmente pero al fallar productB (stock 0),
            // se debe haber ejecutado rollback y su stock debe permanecer en 10.
            const prodACheck = await Product.findById(productA._id);
            expect(prodACheck.stock).toBe(10);

            const orderCheck = await Order.findById(order._id);
            expect(orderCheck.stockAlert).toMatch(/Stock insuficiente/i);
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 6. FSM Transiciones de Estado
    test('F3.5: Máquina de estados permite flujo normal y rechaza transiciones inválidas', async () => {
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

        // Transición válida: Pendiente -> Pagado
        const pagado = await orderService.updateOrderStatus(order._id, 'Pagado');
        expect(pagado.estado).toBe('Pagado');

        // Transición válida: Pagado -> Empaquetado
        const empaquetado = await orderService.updateOrderStatus(order._id, 'Empaquetado');
        expect(empaquetado.estado).toBe('Empaquetado');

        // Transición válida: Empaquetado -> Enviado
        const enviado = await orderService.updateOrderStatus(order._id, 'Enviado');
        expect(enviado.estado).toBe('Enviado');

        // Transición válida: Enviado -> Entregado
        const entregado = await orderService.updateOrderStatus(order._id, 'Entregado');
        expect(entregado.estado).toBe('Entregado');

        // Transición INVÁLIDA: Entregado -> Pendiente (terminal state)
        await expect(
            orderService.updateOrderStatus(order._id, 'Pendiente')
        ).rejects.toThrow(/Transición de estado inválida/);

        // Idempotencia: Entregado -> Entregado no arroja error
        const mismo = await orderService.updateOrderStatus(order._id, 'Entregado');
        expect(mismo.estado).toBe('Entregado');
    });
});
