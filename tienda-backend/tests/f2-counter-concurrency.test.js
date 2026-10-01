const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Order = require('../src/models/Order');
const Product = require('../src/models/product');
const Counter = require('../src/models/Counter');
const User = require('../src/models/User');
const orderService = require('../src/services/orderService');
jest.mock('../src/config/email', () => ({
    enviarEmailPedido: jest.fn().mockResolvedValue(true),
    enviarEmailSeguimiento: jest.fn().mockResolvedValue(true),
    enviarEmailEmpaquetado: jest.fn().mockResolvedValue(true),
    enviarEmailPagoAprobado: jest.fn().mockResolvedValue(true),
    enviarEmailNotificacionAdmin: jest.fn().mockResolvedValue(true),
    enviarConReintentos: jest.fn().mockResolvedValue(true)
}));

describe('FASE 2 — Contador Atómico de Órdenes, Concurrencia y Admin Fixes', () => {
    let brand;
    let category;
    let product;
    let adminUser;
    let regularUser;
    let adminToken;
    let regularToken;

    beforeEach(async () => {


        brand = await Brand.create({
            slug: 'fit',
            name: 'Looser Fit',
            enabled: true
        });

        category = await Category.create({
            name: 'Remeras',
            brand: brand._id
        });

        product = await Product.create({
            nombre: 'Remera Oversize F2 Test',
            precio: 25000,
            stock: 100,
            brand: brand._id,
            categoria: category._id,
            imagenes: ['https://example.com/test.jpg']
        });

        adminUser = await User.create({
            nombre: 'Admin F2',
            email: 'admin-f2@test.com',
            password: 'password123',
            isAdmin: true
        });

        regularUser = await User.create({
            nombre: 'User F2',
            email: 'user-f2@test.com',
            password: 'password123',
            isAdmin: false
        });

        const secret = process.env.JWT_SECRET || 'testsecret';
        adminToken = jwt.sign({ id: adminUser._id, isAdmin: true }, secret, { expiresIn: '1h' });
        regularToken = jwt.sign({ id: regularUser._id, isAdmin: false }, secret, { expiresIn: '1h' });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('F2.1 / F2.2: Inicialización correcta a partir del máximo numérico existente', async () => {
        // Simular órdenes existentes con máximo #027
        await Order.create({
            brand: brand._id,
            total: 25000,
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Cliente 27',
                provincia: 'Buenos Aires',
                localidad: 'CABA',
                email: 'cliente27@test.com',
                telefono: '1122334455',
                direccionSucursal: 'Sucursal Central'
            },
            orderNumber: '#027',
            shippingCost: 7500,
            trackingToken: 'token-pre-27'
        });

        // Crear una nueva orden con createOrder
        const nuevaOrden = await orderService.createOrder({
            brand: brand._id,
            items: [{ productoId: product._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Cliente 28',
                provincia: 'Buenos Aires',
                localidad: 'CABA',
                email: 'cliente28@test.com',
                telefono: '1122334455',
                direccionSucursal: 'Sucursal Central'
            }
        });

        expect(nuevaOrden.orderNumber).toBe('#028');

        const counterDoc = await Counter.findById('orderNumber');
        expect(counterDoc.seq).toBe(28);
    });

    test('F2.6: Concurrencia masiva (25 solicitudes simultáneas sin colisiones ni duplicados)', async () => {
        const CONCURRENT_REQUESTS = 25;

        // Lanzar 25 creaciones simultáneas
        const promises = Array.from({ length: CONCURRENT_REQUESTS }, (_, i) => {
            return orderService.createOrder({
                brand: brand._id,
                items: [{ productoId: product._id, cantidad: 1 }],
                tipoEnvio: 'domicilio',
                datosEnvio: {
                    nombreCompleto: `Cliente Concurrente ${i + 1}`,
                    provincia: 'Buenos Aires',
                    localidad: 'Morón',
                    email: `concurrente${i + 1}@test.com`,
                    telefono: '1199887766',
                    calleNumero: 'Av Rivadavia 1234',
                    codigoPostal: '1708'
                }
            });
        });

        const createdOrders = await Promise.all(promises);

        expect(createdOrders.length).toBe(CONCURRENT_REQUESTS);

        const orderNumbers = createdOrders.map(o => o.orderNumber);
        const uniqueOrderNumbers = new Set(orderNumbers);

        // 1. Unicidad absoluta: ningún número repetido
        expect(uniqueOrderNumbers.size).toBe(CONCURRENT_REQUESTS);

        // 2. Formato estricto #XXX
        for (const num of orderNumbers) {
            expect(num).toMatch(/^#\d{3,}$/);
        }

        // 3. Monotonicidad y verificación en Counter
        const counterDoc = await Counter.findById('orderNumber');
        const numericValues = orderNumbers.map(n => parseInt(n.replace('#', ''), 10));
        const maxCreated = Math.max(...numericValues);

        expect(counterDoc.seq).toBe(maxCreated);
    });

    test('F2.7 / BUG-01: restoreOrder individual vía servicio y endpoint admin', async () => {
        const orden = await orderService.createOrder({
            brand: brand._id,
            items: [{ productoId: product._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Test Restore',
                provincia: 'CABA',
                localidad: 'Palermo',
                email: 'restore@test.com',
                telefono: '1122334455',
                direccionSucursal: 'Sucursal 1'
            }
        });

        // 1. Soft-delete
        await orderService.deleteOrder(orden._id);
        const ordenEliminada = await Order.findById(orden._id);
        expect(ordenEliminada.deleted).toBe(true);
        expect(ordenEliminada.deletedAt).not.toBeNull();

        // 2. Intento de restauración sin permisos -> 403
        const resForbidden = await request(app)
            .patch(`/api/orders/${orden._id}/restore`)
            .set('Authorization', `Bearer ${regularToken}`);
        expect(resForbidden.status).toBe(403);

        // 3. Restauración con token admin -> 200
        const resAdmin = await request(app)
            .patch(`/api/orders/${orden._id}/restore`)
            .set('Authorization', `Bearer ${adminToken}`);
        expect(resAdmin.status).toBe(200);
        expect(resAdmin.body.pedido.deleted).toBe(false);
        expect(resAdmin.body.pedido.deletedAt).toBeNull();

        // 4. Verificación en base de datos
        const ordenRestaurada = await Order.findById(orden._id);
        expect(ordenRestaurada.deleted).toBe(false);
        expect(ordenRestaurada.deletedAt).toBeNull();
    });

    test('F2.7 / BUG-01 & BUG-02: bulkDelete y bulkRestoreOrders vía servicio y endpoint admin', async () => {
        const o1 = await orderService.createOrder({
            brand: brand._id,
            items: [{ productoId: product._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Bulk 1',
                provincia: 'CABA',
                localidad: 'Recoleta',
                email: 'bulk1@test.com',
                telefono: '1122334455',
                direccionSucursal: 'Sucursal 1'
            }
        });

        const o2 = await orderService.createOrder({
            brand: brand._id,
            items: [{ productoId: product._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Bulk 2',
                provincia: 'CABA',
                localidad: 'Belgrano',
                email: 'bulk2@test.com',
                telefono: '1122334455',
                direccionSucursal: 'Sucursal 2'
            }
        });

        const ids = [o1._id.toString(), o2._id.toString()];

        // 1. bulkDeleteOrders (verifica que BUG-02 dead code fue eliminado y no produce errores)
        await orderService.bulkDeleteOrders(ids);

        const checkDeleted = await Order.find({ _id: { $in: ids } });
        expect(checkDeleted.every(o => o.deleted === true)).toBe(true);

        // 2. bulkRestore vía endpoint admin
        const resBulk = await request(app)
            .post('/api/orders/restore-bulk')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ ids });

        expect(resBulk.status).toBe(200);
        expect(resBulk.body.mensaje).toMatch(/restaurados con éxito/i);

        // 3. Verificación en base de datos
        const checkRestored = await Order.find({ _id: { $in: ids } });
        expect(checkRestored.every(o => o.deleted === false)).toBe(true);
        expect(checkRestored.every(o => o.deletedAt === null)).toBe(true);
    });
});
