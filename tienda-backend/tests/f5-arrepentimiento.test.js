'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Order = require('../src/models/Order');
const User = require('../src/models/User');
const Arrepentimiento = require('../src/models/Arrepentimiento');

// Mock global de emails
jest.mock('../src/config/email', () => ({
    enviarEmailPedido: jest.fn().mockResolvedValue(true),
    enviarEmailSeguimiento: jest.fn().mockResolvedValue(true),
    enviarEmailEmpaquetado: jest.fn().mockResolvedValue(true),
    enviarEmailPagoAprobado: jest.fn().mockResolvedValue(true),
    enviarEmailNotificacionAdmin: jest.fn().mockResolvedValue(true),
    enviarEmailArrepentimiento: jest.fn().mockResolvedValue(true),
    enviarConReintentos: jest.fn().mockResolvedValue(true)
}));

describe('FASE 5 — Botón de Arrepentimiento, Disposición 954/2025 y Disp. 3/2026', () => {
    let brand;
    let order;
    let adminUser;
    let adminToken;
    let regularUser;
    let regularToken;

    beforeEach(async () => {
        brand = await Brand.create({
            slug: 'fit',
            name: 'Looser Fit',
            enabled: true
        });

        // Crear pedido de prueba
        order = await Order.create({
            brand: brand._id,
            productos: [],
            total: 45000,
            tipoEnvio: 'domicilio',
            datosEnvio: {
                nombreCompleto: 'Consumidor Modelo',
                email: 'consumidor@ejemplo.com',
                telefono: '1144556677',
                provincia: 'Buenos Aires',
                localidad: 'San Isidro',
                calleNumero: 'Av Libertador 1234',
                dni: '38123456'
            },
            estado: 'Entregado',
            orderNumber: '#055',
            trackingToken: 'token_prueba_arr_123',
            shippingCost: 11000
        });

        adminUser = await User.create({
            nombre: 'Admin Legal',
            email: 'admin.legal@looserfit.com',
            password: 'hashedpassword123',
            isAdmin: true
        });

        regularUser = await User.create({
            nombre: 'Usuario Común',
            email: 'comun@test.com',
            password: 'hashedpassword123',
            isAdmin: false
        });

        adminToken = jwt.sign({ id: adminUser._id.toString(), isAdmin: true }, process.env.JWT_SECRET);
        regularToken = jwt.sign({ id: regularUser._id.toString(), isAdmin: false }, process.env.JWT_SECRET);
    });

    test('F5.1: Solicitud pública sin login obligatorio (Disposición 954/2025)', async () => {
        const res = await request(app)
            .post('/api/arrepentimientos')
            .send({
                customerName: 'Consumidor Modelo',
                customerEmail: 'consumidor@ejemplo.com',
                orderNumber: '#055',
                customerPhone: '1144556677',
                reason: 'Me arrepentí de la compra',
                message: 'El producto no fue abierto'
            });

        expect(res.status).toBe(201);
        expect(res.body.solicitud).toBeDefined();
        expect(res.body.solicitud.requestNumber).toMatch(/^ARR-\d{4}-\d{5}$/);
        expect(res.body.solicitud.status).toBe('Recibido');

        // Comprobar persistencia real en MongoDB
        const persisted = await Arrepentimiento.findOne({ requestNumber: res.body.solicitud.requestNumber });
        expect(persisted).not.toBeNull();
        expect(persisted.customerEmail).toBe('consumidor@ejemplo.com');
        expect(persisted.orderId.toString()).toBe(order._id.toString());
    });

    test('F5.2: Generación atómica secuencial del código ARR-YYYY-XXXXX', async () => {
        const [res1, res2] = await Promise.all([
            request(app).post('/api/arrepentimientos').send({
                customerName: 'Cliente A',
                customerEmail: 'a@test.com',
                orderNumber: 'ORD-A'
            }),
            request(app).post('/api/arrepentimientos').send({
                customerName: 'Cliente B',
                customerEmail: 'b@test.com',
                orderNumber: 'ORD-B'
            })
        ]);

        expect(res1.status).toBe(201);
        expect(res2.status).toBe(201);

        const code1 = res1.body.solicitud.requestNumber;
        const code2 = res2.body.solicitud.requestNumber;

        expect(code1).not.toBe(code2);
        expect(code1).toMatch(/^ARR-\d{4}-\d{5}$/);
        expect(code2).toMatch(/^ARR-\d{4}-\d{5}$/);
    });

    test('F5.3: Validación razonable de identidad y seguridad (Disposición 3/2026)', async () => {
        // Si el pedido existe (#055) pero el email enviado NO coincide con el comprador original
        const resMismatch = await request(app)
            .post('/api/arrepentimientos')
            .send({
                customerName: 'Atacante o Error',
                customerEmail: 'email_falso@otro.com',
                orderNumber: '#055'
            });

        expect(resMismatch.status).toBe(400);
        expect(resMismatch.body.mensaje).toMatch(/no coinciden con los registros/i);
    });

    test('F5.4: Validación de campos obligatorios', async () => {
        // Nombre faltante
        const res1 = await request(app).post('/api/arrepentimientos').send({
            customerEmail: 'test@test.com',
            orderNumber: '#001'
        });
        expect(res1.status).toBe(400);

        // Email inválido
        const res2 = await request(app).post('/api/arrepentimientos').send({
            customerName: 'Juan',
            customerEmail: 'email-invalido',
            orderNumber: '#001'
        });
        expect(res2.status).toBe(400);

        // Nro de orden faltante
        const res3 = await request(app).post('/api/arrepentimientos').send({
            customerName: 'Juan',
            customerEmail: 'juan@test.com'
        });
        expect(res3.status).toBe(400);
    });

    test('F5.5: Panel Administrativo y control de permisos', async () => {
        // Crear solicitud previa
        const postRes = await request(app).post('/api/arrepentimientos').send({
            customerName: 'Consumidor Admin Test',
            customerEmail: 'admintest@test.com',
            orderNumber: '#999',
            brandSlug: 'fit'
        });
        const reqNumber = postRes.body.solicitud.requestNumber;

        // 1. Acceso sin token -> 401
        const resAnon = await request(app).get('/api/arrepentimientos/all');
        expect(resAnon.status).toBe(401);

        // 2. Acceso con usuario no admin -> 403
        const resUser = await request(app)
            .get('/api/arrepentimientos/all')
            .set('Authorization', `Bearer ${regularToken}`);
        expect(resUser.status).toBe(403);

        // 3. Acceso con Admin -> 200 y listado de solicitudes
        const resAdmin = await request(app)
            .get('/api/arrepentimientos/all')
            .set('Authorization', `Bearer ${adminToken}`);
        expect(resAdmin.status).toBe(200);
        expect(Array.isArray(resAdmin.body)).toBe(true);
        expect(resAdmin.body.some(s => s.requestNumber === reqNumber)).toBe(true);

        // 4. Admin actualiza estado de la solicitud
        const solicitudDB = await Arrepentimiento.findOne({ requestNumber: reqNumber });
        const resStatus = await request(app)
            .patch(`/api/arrepentimientos/${solicitudDB._id}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({
                status: 'EnRevision',
                resolutionNotes: 'Contactado por WhatsApp y coordinado retiro'
            });

        expect(resStatus.status).toBe(200);
        expect(resStatus.body.solicitud.status).toBe('EnRevision');
        expect(resStatus.body.solicitud.resolutionNotes).toBe('Contactado por WhatsApp y coordinado retiro');

        // 5. Estado inválido -> 400
        const resBadStatus = await request(app)
            .patch(`/api/arrepentimientos/${solicitudDB._id}/status`)
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ status: 'EstadoInexistente' });
        expect(resBadStatus.status).toBe(400);
    });
});
