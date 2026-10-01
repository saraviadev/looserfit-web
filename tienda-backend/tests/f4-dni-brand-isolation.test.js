const request = require('supertest');
const app = require('../index');
const Brand = require('../src/models/Brand');
const Category = require('../src/models/Category');
const Product = require('../src/models/product');
const orderService = require('../src/services/orderService');

// Mock de emails
jest.mock('../src/config/email', () => ({
    enviarEmailPedido: jest.fn().mockResolvedValue(true),
    enviarEmailSeguimiento: jest.fn().mockResolvedValue(true),
    enviarEmailEmpaquetado: jest.fn().mockResolvedValue(true),
    enviarEmailPagoAprobado: jest.fn().mockResolvedValue(true),
    enviarEmailNotificacionAdmin: jest.fn().mockResolvedValue(true),
    enviarConReintentos: jest.fn().mockResolvedValue(true)
}));

describe('FASE 4 — DNI Postal, Minimización y Aislamiento Multi-Marca Looser Fit / Sport', () => {
    let brandFit;
    let brandSport;
    let catFit;
    let catSport;
    let prodFit;
    let prodSport;

    beforeEach(async () => {
        brandFit = await Brand.create({
            slug: 'fit',
            name: 'Looser Fit',
            enabled: true
        });

        brandSport = await Brand.create({
            slug: 'sport',
            name: 'Looser Sport',
            enabled: true
        });

        catFit = await Category.create({
            name: 'Remeras Streetwear',
            brand: brandFit._id
        });

        catSport = await Category.create({
            name: 'Indumentaria Deportiva',
            brand: brandSport._id
        });

        prodFit = await Product.create({
            nombre: 'Remera Fit Oversize 2026',
            precio: 30000,
            stock: 20,
            categoria: catFit._id,
            brand: brandFit._id,
            publicado: true
        });

        prodSport = await Product.create({
            nombre: 'Camiseta DryFit Sport',
            precio: 28000,
            stock: 15,
            categoria: catSport._id,
            brand: brandSport._id,
            publicado: true
        });
    });

    // 1. DNI válido y normalizado
    test('F4.1: DNI válido (7 u 8 dígitos) es normalizado y persistido en la orden', async () => {
        const order = await orderService.createOrder({
            brand: brandFit._id,
            productos: [{ productoId: prodFit._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'Juan Postal',
                email: 'postal@test.com',
                telefono: '1133445566',
                dni: '40.123.456', // Con formato de puntos
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal Correo Argentino'
            }
        });

        expect(order.datosEnvio.dni).toBe('40123456'); // Limpio y numérico
    });

    // 2. DNI inválido es rechazado
    test('F4.1: DNI inválido (< 7 dígitos o letras) es rechazado en la creación', async () => {
        await expect(
            orderService.createOrder({
                brand: brandFit._id,
                productos: [{ productoId: prodFit._id, cantidad: 1 }],
                tipoEnvio: 'sucursal',
                datosEnvio: {
                    nombreCompleto: 'Error DNI',
                    email: 'errordni@test.com',
                    telefono: '1133445566',
                    dni: '1234', // Demasiado corto
                    provincia: 'Buenos Aires',
                    localidad: 'Quilmes',
                    direccionSucursal: 'Sucursal'
                }
            })
        ).rejects.toThrow(/DNI inválido/);
    });

    // 3. Minimización de datos en tracking público
    test('F4.1: Endpoint de seguimiento público enmascara el DNI (minimización de datos)', async () => {
        const order = await orderService.createOrder({
            brand: brandFit._id,
            productos: [{ productoId: prodFit._id, cantidad: 1 }],
            tipoEnvio: 'domicilio',
            datosEnvio: {
                nombreCompleto: 'Cliente Privacidad',
                email: 'privacidad@test.com',
                telefono: '1133445566',
                dni: '38999888',
                provincia: 'Buenos Aires',
                localidad: 'Bernal',
                calleNumero: 'Zapiola 123',
                codigoPostal: '1876'
            }
        });

        const res = await request(app).get(`/api/orders/track/${order.trackingToken}`);
        expect(res.status).toBe(200);
        // Debe estar enmascarado
        expect(res.body.datosEnvio.dni).toBe('***9888');
        expect(res.body.datosEnvio.dni).not.toBe('38999888');
    });

    // 4. Aislamiento de Productos entre marcas
    test('F4.2: Catálogo de productos está estrictamente aislado por marca (fit vs sport)', async () => {
        // Petición a Fit
        const resFit = await request(app).get('/api/products/all?brand=fit&soloPublicados=true');
        expect(resFit.status).toBe(200);
        expect(resFit.body.some(p => p._id === prodFit._id.toString())).toBe(true);
        expect(resFit.body.some(p => p._id === prodSport._id.toString())).toBe(false);

        // Petición a Sport
        const resSport = await request(app).get('/api/products/all?brand=sport&soloPublicados=true');
        expect(resSport.status).toBe(200);
        expect(resSport.body.some(p => p._id === prodSport._id.toString())).toBe(true);
        expect(resSport.body.some(p => p._id === prodFit._id.toString())).toBe(false);
    });

    // 5. Aislamiento de Categorías entre marcas
    test('F4.2: Categorías están aisladas por marca', async () => {
        const resCatFit = await request(app).get('/api/categories?brand=fit');
        expect(resCatFit.status).toBe(200);
        expect(resCatFit.body.some(c => c._id === catFit._id.toString())).toBe(true);
        expect(resCatFit.body.some(c => c._id === catSport._id.toString())).toBe(false);

        const resCatSport = await request(app).get('/api/categories?brand=sport');
        expect(resCatSport.status).toBe(200);
        expect(resCatSport.body.some(c => c._id === catSport._id.toString())).toBe(true);
        expect(resCatSport.body.some(c => c._id === catFit._id.toString())).toBe(false);
    });

    // 6. Órdenes creadas mantienen referencia a la marca respectiva
    test('F4.2: Órdenes creadas preservan su marca respectiva sin contaminar', async () => {
        const orderFit = await orderService.createOrder({
            brand: brandFit._id,
            productos: [{ productoId: prodFit._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'User Fit',
                email: 'fit@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal'
            }
        });

        const orderSport = await orderService.createOrder({
            brand: brandSport._id,
            productos: [{ productoId: prodSport._id, cantidad: 1 }],
            tipoEnvio: 'sucursal',
            datosEnvio: {
                nombreCompleto: 'User Sport',
                email: 'sport@test.com',
                telefono: '1133445566',
                provincia: 'Buenos Aires',
                localidad: 'Quilmes',
                direccionSucursal: 'Sucursal'
            }
        });

        expect(orderFit.brand.toString()).toBe(brandFit._id.toString());
        expect(orderSport.brand.toString()).toBe(brandSport._id.toString());
    });
});
