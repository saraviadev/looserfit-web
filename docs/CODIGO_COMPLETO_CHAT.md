# ARCHIVOS DEL PROYECTO LOOSERFIT PARA COPIAR A CHAT

================================================================================
ARCHIVO: tienda-backend/src/routes/paymentRoutes.js
================================================================================

```javascript
const express = require('express');
const router = express.Router();
const { MercadoPagoConfig, Preference } = require('mercadopago');
const Order = require('../models/Order');
const Product = require('../models/product');

// Configurar Mercado Pago
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

// Crear Preferencia de Pago
router.post('/create-preference', async (req, res) => {
    try {
        const { orderId } = req.body;
        const pedido = await Order.findById(orderId);

        if (!pedido) {
            return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        }

        // --- VERIFICAR STOCK Y PRECIOS ANTES DE MERCADO PAGO ---
        const items = [];
        for (const p of pedido.productos) {
            const productoDB = await Product.findById(p.productoId);
            if (!productoDB) {
                return res.status(400).json({ mensaje: `Producto no encontrado: ${p.nombre}` });
            }
            if (productoDB.stock < p.cantidad) {
                return res.status(400).json({ 
                    mensaje: `Lo sentimos, ya no queda stock suficiente de "${p.nombre}". Stock disponible: ${productoDB.stock}` 
                });
            }
            // Usar precioOferta si existe y es válido, sino precio base de la DB
            const precioVerificado = (productoDB.precioOferta && productoDB.precioOferta > 0)
                ? productoDB.precioOferta
                : productoDB.precio;
            items.push({
                id: p.productoId.toString(),
                title: p.nombre,
                quantity: p.cantidad,
                unit_price: precioVerificado,
                currency_id: 'ARS'
            });
        }

        if (pedido.shippingCost && pedido.shippingCost > 0) {
            items.push({
                id: 'shipping',
                title: 'Costo de envío',
                quantity: 1,
                unit_price: pedido.shippingCost,
                currency_id: 'ARS'
            });
        }

        const preference = new Preference(client);
        const frontendUrl = process.env.FRONTEND_URL || 'https://www.looserfit.com';
        const body = {
            items,
            back_urls: {
                success: `${frontendUrl}/pedido-exito`,
                failure: `${frontendUrl}/carrito`,
                pending: `${frontendUrl}/pedido-exito`
            },
            auto_return: 'all',
            external_reference: orderId,
            statement_descriptor: 'LOOSERFIT',
            payer: {
                name: pedido.datosEnvio?.nombreCompleto?.split(' ')[0] || '',
                surname: pedido.datosEnvio?.nombreCompleto?.split(' ').slice(1).join(' ') || '',
                email: pedido.datosEnvio?.email,
                phone: {
                    area_code: '',
                    number: pedido.datosEnvio?.telefono
                },
                address: {
                    zip_code: '',
                    street_name: pedido.datosEnvio?.calleNumero || '',
                    street_number: ''
                }
            },
            notification_url: `${process.env.BACKEND_URL || 'https://looserfit-api.onrender.com'}/api/payments/webhook`
        };

        // Idempotency key única para la creación de preferencia de este pedido
        const idempotencyKey = `pref_${orderId}_${pedido.total}_${pedido.updatedAt ? new Date(pedido.updatedAt).getTime() : Date.now()}`;

        const result = await preference.create({
            body,
            requestOptions: { idempotencyKey }
        });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error al crear preferencia:', error);
        res.status(500).json({ mensaje: 'Error al crear la preferencia de pago', error: error.message });
    }
});

// Webhook para recibir notificaciones de Mercado Pago con protección estricta contra duplicados
router.post('/webhook', async (req, res) => {
    const topic = req.query.topic || req.query.type || req.body.type || req.body.topic;
    const paymentId = req.query.id || req.query['data.id'] || req.body.id || req.body['data.id'] || req.body.data?.id;

    console.log(`[Webhook MP] ${new Date().toISOString()} - Recibido: topic=${topic}, id=${paymentId}`);

    try {
        if (topic === 'payment' && paymentId) {
            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: {
                    'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Mercado Pago API error: ${response.status} ${errorText}`);
            }

            const paymentData = await response.json();
            const orderId = paymentData.external_reference || req.body.data?.object?.external_reference || req.body.external_reference;

            console.log(`[Webhook MP] Pago ${paymentId} - Estado: ${paymentData.status} - Detalle: ${paymentData.status_detail} - Orden: ${orderId}`);

            if (!orderId) {
                console.warn('[Webhook MP] ⚠️ Webhook recibido sin external_reference válido:', paymentId);
                return res.sendStatus(200);
            }

            if (paymentData.status === 'approved') {
                // ATOMIC CLAIM: Solo una solicitud simultánea puede hacer la transición a 'Pagado'
                // y asociar el mpPaymentId. Toda entrega duplicada devolverá null en claimedOrder.
                const claimedOrder = await Order.findOneAndUpdate(
                    {
                        _id: orderId,
                        estado: { $nin: ['Pagado', 'Empaquetado', 'Enviado', 'Entregado'] },
                        mpPaymentId: { $ne: String(paymentId) }
                    },
                    {
                        $set: {
                            estado: 'Pagado',
                            mpPaymentId: String(paymentId),
                            metodoPago: 'mercadopago',
                            mpStatus: paymentData.status,
                            paymentProcessedAt: new Date()
                        }
                    },
                    { returnDocument: 'after' }
                );

                if (claimedOrder) {
                    console.log(`[Webhook MP] Transición atómica exitosa para orden ${orderId}. Descontando stock de forma atómica con rollback...`);

                    // Descuento atómico de stock con compensación (rollback) ante fallas parciales
                    const stockDecrements = [];
                    let stockFailure = false;

                    for (const item of claimedOrder.productos) {
                        const updatedProduct = await Product.findOneAndUpdate(
                            { _id: item.productoId, stock: { $gte: item.cantidad } },
                            { $inc: { stock: -item.cantidad } },
                            { returnDocument: 'after' }
                        );

                        if (updatedProduct) {
                            stockDecrements.push({ productoId: item.productoId, cantidad: item.cantidad });
                        } else {
                            stockFailure = true;
                            console.error(`❌ [Webhook MP] Error crítico: Stock insuficiente para producto ${item.nombre} en pedido ${orderId}`);
                            break;
                        }
                    }

                    if (stockFailure) {
                        // Rollback: restaurar los productos que llegaron a descontarse
                        for (const dec of stockDecrements) {
                            await Product.findByIdAndUpdate(dec.productoId, {
                                $inc: { stock: dec.cantidad }
                            });
                        }
                        await Order.findByIdAndUpdate(orderId, {
                            stockAlert: 'Stock insuficiente al momento de acreditar el pago'
                        });
                        console.warn(`⚠️ [Webhook MP] Rollback de stock completado para orden ${orderId}`);
                    }

                    // Notificaciones por email (asincrónicas, no bloquean respuesta 200)
                    const { enviarEmailPagoAprobado, enviarEmailNotificacionAdmin, enviarConReintentos } = require('../config/email');
                    if (enviarEmailPagoAprobado) {
                        enviarEmailPagoAprobado(claimedOrder.datosEnvio, claimedOrder).catch(console.error);
                    }
                    if (enviarEmailNotificacionAdmin && enviarConReintentos) {
                        enviarConReintentos(() => enviarEmailNotificacionAdmin(claimedOrder), 3, 'Notificación admin').catch(console.error);
                    }

                    console.log(`✅ [Webhook MP] Pedido ${orderId} marcado como Pagado y stock descontado.`);
                } else {
                    // Notificación duplicada o pedido ya en estado avanzado
                    console.log(`[Webhook MP] Pedido ${orderId} ya estaba en estado Pagado/procesado para paymentId ${paymentId}, ignorando duplicado.`);
                }
            } else if (['pending', 'in_process'].includes(paymentData.status)) {
                await Order.findByIdAndUpdate(orderId, {
                    mpPaymentId: String(paymentId),
                    mpStatus: paymentData.status
                });
                console.log(`⏳ [Webhook MP] Pedido ${orderId} está pendiente de acreditación (${paymentData.status_detail})`);
            } else {
                await Order.findByIdAndUpdate(orderId, {
                    mpPaymentId: String(paymentId),
                    mpStatus: paymentData.status
                });
                console.log(`❌ [Webhook MP] Pedido ${orderId} falló o fue rechazado: ${paymentData.status}`);
            }
        } else {
            console.log(`[Webhook MP] Notificación ignorada: topic=${topic}, id=${paymentId}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error(`[Webhook MP] ❌ Error procesando webhook:`, error.message);
        res.sendStatus(500);
    }
});

module.exports = router;

```

================================================================================
ARCHIVO: tienda-backend/src/services/orderService.js
================================================================================

```javascript
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Product = require('../models/product');
const crypto = require('crypto');
const { enviarEmailPedido, enviarEmailSeguimiento } = require('../config/email');
const { deleteFromCloudinary } = require('../utils/cloudinaryUtils');

// Inicializa el contador con el máximo numérico existente si aún no existe
async function initOrderCounter() {
    const existing = await Counter.findById('orderNumber');
    if (!existing) {
        const orders = await Order.find({}, { orderNumber: 1 }).lean();
        let max = 0;
        for (const o of orders) {
            const m = (o.orderNumber || '').match(/^#?(\d+)$/);
            if (m) {
                const n = parseInt(m[1], 10);
                if (n > max) max = n;
            }
        }
        await Counter.initCounter('orderNumber', max);
    }
}

async function getNextOrderNumber() {
    await initOrderCounter();
    const nextSeq = await Counter.getNextSequence('orderNumber');
    return `#${String(nextSeq).padStart(3, '0')}`;
}

const createOrder = async (orderData) => {
    const { productos = [], tipoEnvio, datosEnvio, usuario, brand } = orderData;
    // Validación y sanitización de DNI para despacho postal
    if (datosEnvio) {
        if (datosEnvio.dni) {
            const cleanDni = String(datosEnvio.dni).replace(/\D/g, '');
            if (cleanDni.length >= 7 && cleanDni.length <= 8) {
                datosEnvio.dni = cleanDni;
            } else {
                throw new Error('DNI inválido: debe contener 7 u 8 dígitos numéricos.');
            }
        }
    }
    
    const productosPedido = [];
    let totalCalculado = 0;

    for (const item of productos) {
        const productoDB = await Product.findById(item.productoId);
        if (!productoDB) throw new Error(`Producto no encontrado: ${item.productoId}`);

        const cantidad = Number(item.cantidad) || 0;
        if (cantidad <= 0) throw new Error(`Cantidad inválida para ${productoDB.nombre}`);
        if ((productoDB.stock || 0) < cantidad) throw new Error(`Stock insuficiente para ${productoDB.nombre}`);

        const precioUnitario = (productoDB.precioOferta && productoDB.precioOferta > 0)
            ? productoDB.precioOferta
            : productoDB.precio;

        productosPedido.push({
            productoId: productoDB._id,
            nombre: productoDB.nombre,
            cantidad,
            precio: productoDB.precio,
            precioOferta: (productoDB.precioOferta && productoDB.precioOferta > 0) ? productoDB.precioOferta : null,
            talle: item.talle || '',
            imagen: item.imagen || (productoDB.imagenes && productoDB.imagenes[0]) || ''
        });

        totalCalculado += precioUnitario * cantidad;
    }

    // El stock ya no se descuenta aquí, sino en el webhook tras el pago.
    // Solo mantenemos la verificación inicial de stock arriba.

    const orderNumber = await getNextOrderNumber();
    const shippingCost = tipoEnvio === 'domicilio' ? 11000 : 7500;
    const totalFinal = totalCalculado + shippingCost;
    const trackingToken = crypto.randomBytes(16).toString('hex');

    const nuevoPedido = new Order({
        brand,              // Multi-marca: marca de la tienda donde se hizo la compra
        productos: productosPedido,
        total: totalFinal,
        tipoEnvio,
        datosEnvio,
        usuario,
        estado: 'Pendiente',
        orderNumber,
        trackingToken,
        shippingCost,
        comprobante: orderData.comprobante
    });

    await nuevoPedido.save();

    // Enviar email al cliente (asincrónico)
    enviarEmailPedido(datosEnvio, nuevoPedido).catch(console.error);

    return nuevoPedido;
};

const getAllOrders = async (query = {}) => {
    const filter = query.deleted === 'true'
        ? { deleted: true }
        : { deleted: { $ne: true } };
    return await Order.find(filter).populate('brand', 'slug name').sort({ createdAt: -1 });
};

const getOrdersByUser = async (usuarioId) => {
    return await Order.find({ usuario: usuarioId, deleted: { $ne: true } }).sort({ createdAt: -1 });
};

const getOrderById = async (id) => {
    return await Order.findById(id);
};

const getOrderByToken = async (token) => {
    return await Order.findOne({ trackingToken: token });
};

// Máquina de Estados Finitos (FSM) para órdenes
const VALID_TRANSITIONS = {
    Pendiente: ['Pagado', 'Cancelado'],
    Pagado: ['Empaquetado', 'Cancelado'],
    Empaquetado: ['Enviado', 'Cancelado'],
    Enviado: ['Entregado', 'Cancelado'],
    Entregado: [],
    Cancelado: []
};

const updateOrderStatus = async (id, estado) => {
    const pedidoActual = await Order.findById(id);
    if (!pedidoActual) return null;

    // Idempotencia: si ya está en ese estado, no re-procesar ni disparar emails duplicados
    if (pedidoActual.estado === estado) {
        return pedidoActual;
    }

    // Validación estricta de transiciones
    const permitidas = VALID_TRANSITIONS[pedidoActual.estado] || [];
    if (!permitidas.includes(estado)) {
        const error = new Error(`Transición de estado inválida: no se puede pasar de '${pedidoActual.estado}' a '${estado}'`);
        error.statusCode = 400;
        throw error;
    }

    const pedido = await Order.findByIdAndUpdate(id, { estado }, { returnDocument: 'after' });
    
    if (pedido) {
        const { datosEnvio } = pedido;
        if (estado === 'Empaquetado') {
            const { enviarEmailEmpaquetado } = require('../config/email');
            enviarEmailEmpaquetado(datosEnvio, pedido).catch(console.error);
        } else if (estado === 'Pagado') {
            const { enviarEmailPagoAprobado } = require('../config/email');
            enviarEmailPagoAprobado(datosEnvio, pedido).catch(console.error);
            // Notificar al admin con reintentos — si falla no se pierde la notificación
            const { enviarConReintentos, enviarEmailNotificacionAdmin } = require('../config/email');
            enviarConReintentos(() => enviarEmailNotificacionAdmin(pedido), 3, 'Notificación admin');
        }
    }
    
    return pedido;
};

const updateTracking = async (id, trackingNumber) => {
    const pedido = await Order.findByIdAndUpdate(id, { trackingNumber }, { new: true });
    if (pedido && trackingNumber) {
        enviarEmailSeguimiento(pedido.datosEnvio, trackingNumber, pedido.orderNumber).catch(console.error);
    }
    return pedido;
};

const uploadComprobante = async (id, comprobantePath) => {
    const pedido = await Order.findById(id);
    if (pedido && pedido.comprobante) {
        await deleteFromCloudinary(pedido.comprobante);
    }
    return await Order.findByIdAndUpdate(id, { comprobante: comprobantePath }, { new: true });
};

// Soft delete: marcar como eliminado sin borrar datos ni comprobantes
const deleteOrder = async (id) => {
    return await Order.findByIdAndUpdate(
        id,
        { deleted: true, deletedAt: new Date() },
        { returnDocument: 'after' }
    );
};

// Soft delete masivo: marcar como eliminados sin borrar datos ni comprobantes
const bulkDeleteOrders = async (ids) => {
    return await Order.updateMany(
        { _id: { $in: ids } },
        { deleted: true, deletedAt: new Date() }
    );
};

// Restaurar pedido eliminado
const restoreOrder = async (id) => {
    return await Order.findByIdAndUpdate(
        id,
        { deleted: false, deletedAt: null },
        { returnDocument: 'after' }
    ).populate('brand', 'slug name');
};

// Restaurar pedidos eliminados en masa
const bulkRestoreOrders = async (ids) => {
    return await Order.updateMany(
        { _id: { $in: ids } },
        { deleted: false, deletedAt: null }
    );
};

module.exports = {
    createOrder,
    getAllOrders,
    getOrdersByUser,
    getOrderById,
    getOrderByToken,
    updateOrderStatus,
    updateTracking,
    uploadComprobante,
    deleteOrder,
    bulkDeleteOrders,
    restoreOrder,
    bulkRestoreOrders
};

```

================================================================================
ARCHIVO: tienda-backend/src/models/Counter.js
================================================================================

```javascript
const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    seq: { type: Number, default: 0 }
});

// Inicialización idempotente y segura
counterSchema.statics.initCounter = async function (counterId, initialSeq = 0) {
    return await this.findOneAndUpdate(
        { _id: counterId },
        { $setOnInsert: { seq: initialSeq } },
        { upsert: true, returnDocument: 'after' }
    );
};

// Generación estrictamente atómica mediante $inc en MongoDB
counterSchema.statics.getNextSequence = async function (counterId) {
    const counter = await this.findOneAndUpdate(
        { _id: counterId },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', upsert: true }
    );
    return counter.seq;
};

module.exports = mongoose.model('Counter', counterSchema);

```

================================================================================
ARCHIVO: tienda-backend/src/controllers/orderController.js
================================================================================

```javascript
const orderService = require('../services/orderService');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');
const { subirImagen, uploadComprobanteMulter, validateMagicBytes } = require('../config/storage');

const createOrder = async (req, res) => {
    try {
        const { productos, datosEnvio, total, tipoEnvio } = req.body;
        
        const orderData = { 
            productos, 
            datosEnvio, 
            total, 
            tipoEnvio, 
            usuario: req.user ? (req.user.id || req.user._id) : null,
            comprobante: null,
            brand: req.brandId  // Multi-marca: marca de la tienda donde se generó el pedido
        };

        const order = await orderService.createOrder(orderData);
        res.status(201).json({ mensaje: 'Ticket generado con éxito', pedido: order });
    } catch (error) {
        console.error('Error createOrder:', error);
        res.status(400).json({ mensaje: 'Error al generar el ticket', error: error.message });
    }
};

const getAllOrders = async (req, res) => {
    try {
        const orders = await orderService.getAllOrders(req.query);
        res.json(orders);
    } catch (error) {
        console.error('Error getAllOrders:', error);
        res.status(500).json({ mensaje: 'Error al obtener pedidos' });
    }
};

const getOrdersMine = async (req, res) => {
    try {
        const userId = req.user ? (req.user.id || req.user._id) : null;
        const orders = await orderService.getOrdersByUser(userId);
        res.json(orders);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener tus pedidos', error: error.message });
    }
};

// SEC-01: Protección estricta de pedidos de invitados y usuarios registrados
const getOrderById = async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        
        // Extraer usuario del token si está presente
        let tokenUser = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                tokenUser = jwt.verify(token, process.env.JWT_SECRET);
            } catch (_e) {
                // Token inválido o expirado
            }
        }

        // 1. Administrador autorizado tiene acceso total
        if (tokenUser && tokenUser.isAdmin) {
            return res.json(order);
        }

        // 2. Si el pedido tiene un usuario registrado
        if (order.usuario) {
            if (!tokenUser) {
                return res.status(401).json({ mensaje: 'Acceso no autorizado a este pedido' });
            }
            const isOwner = String(tokenUser.id || tokenUser._id) === String(order.usuario);
            if (!isOwner) {
                return res.status(403).json({ mensaje: 'No tenés permiso para ver este pedido' });
            }
        } else {
            // 3. Si el pedido es de invitado (usuario === null / undefined)
            // Requiere obligatoriamente X-Guest-Token correspondiente
            const guestToken = req.headers['x-guest-token'];
            if (!guestToken) {
                return res.status(403).json({ mensaje: 'Acceso no autorizado: se requiere token de invitado' });
            }
            if (guestToken !== order.trackingToken) {
                return res.status(403).json({ mensaje: 'Token de invitado no válido para este pedido' });
            }
        }

        // Sanitización: no exponer trackingToken innecesariamente a clientes
        const orderObj = order.toObject ? order.toObject() : { ...order };
        delete orderObj.trackingToken;
        res.json(orderObj);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener pedido', error: error.message });
    }
};

const getOrderByToken = async (req, res) => {
    try {
        const order = await orderService.getOrderByToken(req.params.token);
        if (!order) return res.status(404).json({ mensaje: 'Link de seguimiento inválido o expirado' });
        
        const orderObj = order.toObject ? order.toObject() : { ...order };
        // Minimización de datos: enmascarar DNI en respuesta pública de tracking
        if (orderObj.datosEnvio && orderObj.datosEnvio.dni) {
            const rawDni = String(orderObj.datosEnvio.dni);
            orderObj.datosEnvio.dni = rawDni.length > 4 ? '***' + rawDni.slice(-4) : '***';
        }
        res.json(orderObj);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al consultar seguimiento', error: error.message });
    }
};

const updateStatus = async (req, res) => {
    try {
        const { estado } = req.body;
        const permitidos = ['Pendiente', 'Pagado', 'Empaquetado', 'Enviado', 'Entregado', 'Cancelado'];
        if (!permitidos.includes(estado)) {
            return res.status(400).json({ mensaje: 'Estado no válido' });
        }

        const order = await orderService.updateOrderStatus(req.params.id, estado);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        res.json({ mensaje: 'Estado actualizado', pedido: order });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar estado', error: error.message });
    }
};

const updateTracking = async (req, res) => {
    try {
        const { trackingNumber } = req.body;
        const order = await orderService.updateTracking(req.params.id, trackingNumber);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        res.json({ mensaje: 'Seguimiento actualizado', pedido: order });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar seguimiento', error: error.message });
    }
};

// SEC-03: Middleware previo de autorización y política de sobrescritura
const verifyOrderUploadAuth = async (req, res, next) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) {
            return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        }

        let tokenUser = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                tokenUser = jwt.verify(token, process.env.JWT_SECRET);
            } catch (_e) {
                // Token inválido
            }
        }

        const guestToken = req.headers['x-guest-token'];

        // 1. Administrador autorizado
        if (tokenUser && tokenUser.isAdmin) {
            req.order = order;
            return next();
        }

        // 2. Orden perteneciente a usuario registrado
        if (order.usuario) {
            if (!tokenUser) {
                return res.status(401).json({ mensaje: 'Se requiere autenticación para subir comprobante a este pedido' });
            }
            const isOwner = String(tokenUser.id || tokenUser._id) === String(order.usuario);
            if (!isOwner) {
                return res.status(403).json({ mensaje: 'No tenés permiso para subir comprobante a este pedido' });
            }
        } else {
            // 3. Orden de invitado (usuario === null / undefined)
            if (!guestToken) {
                return res.status(401).json({ mensaje: 'Se requiere token de invitado para subir comprobante' });
            }
            if (guestToken !== order.trackingToken) {
                return res.status(403).json({ mensaje: 'Token de invitado no válido para este pedido' });
            }
        }

        // 4. Política de no sobrescritura indebida
        if (order.estado !== 'Pendiente') {
            return res.status(400).json({ mensaje: `El pedido está en estado '${order.estado}'; no se puede modificar el comprobante.` });
        }

        if (order.comprobante) {
            return res.status(400).json({ mensaje: 'El pedido ya tiene un comprobante adjunto. Contactá a soporte para modificarlo.' });
        }

        req.order = order;
        next();
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar autorización de pedido', error: error.message });
    }
};

// SEC-03: Wrapper de Multer para captura limpia de errores de tamaño y tipo de archivo
const uploadComprobanteMiddleware = (req, res, next) => {
    uploadComprobanteMulter.single('comprobante')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ mensaje: 'El archivo excede el tamaño máximo permitido (5MB)' });
            }
            return res.status(400).json({ mensaje: err.message || 'Error al procesar el archivo' });
        }
        next();
    });
};

// SEC-03: Subida con validación de magic bytes y generación de nombre seguro
const uploadComprobante = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ mensaje: 'No se recibió el comprobante' });
        }

        // Inspección real de Magic Bytes
        const magicInfo = validateMagicBytes(req.file.buffer);
        if (!magicInfo) {
            return res.status(400).json({ mensaje: 'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG o WebP válidas.' });
        }

        const orderId = req.order ? req.order._id : req.params.id;
        const safeFileName = `comprobante_${orderId}_${Date.now()}.${magicInfo.ext}`;
        const fileToUpload = {
            ...req.file,
            originalname: safeFileName
        };

        const url = await subirImagen(fileToUpload, 'looserfit_comprobantes');
        const order = await orderService.uploadComprobante(orderId, url);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });

        res.json({ mensaje: 'Comprobante subido con éxito', pedido: order });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al subir comprobante', error: error.message });
    }
};

const deleteOrder = async (req, res) => {
    try {
        const order = await orderService.deleteOrder(req.params.id);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        res.json({ mensaje: 'Pedido eliminado con éxito' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar pedido', error: error.message });
    }
};

const bulkDeleteOrders = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ mensaje: 'Se requiere una lista de IDs válida' });
        }
        await orderService.bulkDeleteOrders(ids);
        res.json({ mensaje: 'Pedidos eliminados con éxito' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar pedidos en masa', error: error.message });
    }
};

const restoreOrder = async (req, res) => {
    try {
        const order = await orderService.restoreOrder(req.params.id);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        res.json({ mensaje: 'Pedido restaurado con éxito', pedido: order });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al restaurar pedido', error: error.message });
    }
};

const bulkRestoreOrders = async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ mensaje: 'Se requiere una lista de IDs válida' });
        }
        await orderService.bulkRestoreOrders(ids);
        res.json({ mensaje: 'Pedidos restaurados con éxito' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al restaurar pedidos en masa', error: error.message });
    }
};

module.exports = {
    createOrder,
    getAllOrders,
    getOrdersMine,
    getOrderById,
    getOrderByToken,
    updateStatus,
    updateTracking,
    verifyOrderUploadAuth,
    uploadComprobanteMiddleware,
    uploadComprobante,
    deleteOrder,
    bulkDeleteOrders,
    restoreOrder,
    bulkRestoreOrders
};

```

================================================================================
ARCHIVO: tienda-frontend/src/pages/Checkout/Checkout.jsx
================================================================================

```jsx
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCart } from '../../context/CartContext'
import { useAuth } from '../../context/AuthContext'
import { crearPedidoConBrand, crearPreferenciaPago } from '../../services/api'
import './Checkout.css'

const PROVINCIAS = [
  'Buenos Aires', 'Capital Federal', 'Catamarca', 'Chaco', 'Chubut', 
  'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 
  'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 
  'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 
  'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'
]

export default function Checkout() {

  const { user } = useAuth()
  const { items, subtotal, clearCart } = useCart()
  const [tipoEnvio, setTipoEnvio] = useState('sucursal')
  const shippingCost = tipoEnvio === 'domicilio' ? 11000 : 7500
  const totalWithShipping = subtotal + shippingCost
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({
    nombreCompleto: '',
    provincia: '',
    localidad: '',
    direccionSucursal: '',
    email: '',
    telefono: '',
    dni: '',
    calleNumero: '',
    pisoDepto: '',
    codigoPostal: '',
  })



  const productosPedido = useMemo(() => items.map(i => ({
    productoId: i._id,
    nombre: i.nombre,
    cantidad: i.cantidad,
    precio: i.precio,
    talle: i.talle || '',
    imagen: i.imagen || '',
  })), [items])
  
  useEffect(() => {
    if (user && !form.nombreCompleto) {
      setTimeout(() => {
        setForm(prev => ({
          ...prev,
          nombreCompleto: user.nombre || '',
          email: user.email || ''
        }))
      }, 0)
    }
  }, [user, form.nombreCompleto])

  // Calculate shipping cost synchronously (derived state)

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm(prev => {
      const next = { ...prev, [name]: value }
      if (name === 'provincia') {
        next.localidad = ''
        next.direccionSucursal = ''
      }
      return next
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!items.length) return setError('No hay productos en el carrito.')
    const dniClean = (form.dni || '').replace(/\D/g, '')
    if (!dniClean || dniClean.length < 7 || dniClean.length > 8) {
      return setError('DNI inválido: ingresa un documento de 7 u 8 dígitos numéricos para Correo Argentino.')
    }

    const localidad = form.localidad.trim()
    const direccionSucursal = form.direccionSucursal.trim()
    const calleNumero = form.calleNumero.trim()

    const localidadValida = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ\s]{3,}$/
    if (!localidadValida.test(localidad)) {
      return setError('Localidad inválida: ingresa una localidad real.')
    }

    if (tipoEnvio === 'sucursal') {
      if (!direccionSucursal || direccionSucursal.trim().length < 3) {
        return setError('Dirección de sucursal inválida: ingresa una dirección válida.')
      }
    }

    if (tipoEnvio === 'domicilio' && !calleNumero) {
      return setError('Calle y número son obligatorios para envío a domicilio.')
    }

    const pedidoData = {
      productos: productosPedido,
      total: totalWithShipping,
      tipoEnvio,
      datosEnvio: form,
      usuario: user?._id
    }

    try {
      setLoading(true)
      const resp = await crearPedidoConBrand(pedidoData)
      
      // Creamos la preferencia de Mercado Pago
      const preference = await crearPreferenciaPago(resp.pedido._id)
      
      // Limpiamos carrito antes de irnos
      clearCart()

      // Si es invitado (o incluso si es user para redundancia), guardamos el token de seguimiento localmente 
      // para habilitar la barra de notificaciones sin login
      localStorage.setItem('looserfit_guest_token', resp.pedido.trackingToken)

      // Redirigimos al init_point de Mercado Pago
      window.location.href = preference.init_point
    } catch (err) {
      console.error('Error en checkout:', err);
      const msg = err.response?.data?.mensaje || err.message || 'No se pudo generar el pedido. Revisa los datos.';
      setError(msg)
      setLoading(false)
    }
  }

  return (
    <div className="checkout-page">
      <div className="container">
        <div className="checkout-header">
          <Link to="/carrito" className="checkout-back">← Volver al carrito</Link>
          <h1>Checkout</h1>
        </div>

        <form className="checkout-form" onSubmit={handleSubmit}>
          <div className="checkout-layout">
            <section className="checkout-card">
              <h2>Datos de envío</h2>
              <div className="checkout-grid">
                <input name="nombreCompleto" placeholder="Nombre completo" value={form.nombreCompleto} onChange={handleChange} required />
                <input name="email" type="email" placeholder="Email" value={form.email} onChange={handleChange} required />
                <input name="telefono" placeholder="Teléfono" value={form.telefono} onChange={handleChange} required />
                <input name="dni" placeholder="DNI (para Correo Argentino)" value={form.dni} onChange={handleChange} required />
              </div>

              <div className="checkout-radio">
                <label><input type="radio" checked={tipoEnvio === 'sucursal'} onChange={() => setTipoEnvio('sucursal')} /> Retirar en sucursal</label>
                <label><input type="radio" checked={tipoEnvio === 'domicilio'} onChange={() => setTipoEnvio('domicilio')} /> Envío a domicilio</label>
              </div>

              <p style={{ margin: '0.6rem 0', color: '#333', fontSize: '0.9rem', lineHeight: '1.35' }}>
                Costo de envío: <strong>$7.500</strong> (sucursal) / <strong>$11.000</strong> (domicilio).
              </p>
              <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#666' }}>
                Si no conocés la sucursal exacta, podés elegir una en el sitio oficial de Correo Argentino:
                {' '}<a href="https://www.correoargentino.com.ar/sucursal" target="_blank" rel="noreferrer">Buscar sucursales</a>.
              </p>

              {tipoEnvio === 'sucursal' ? (
                <div className="checkout-grid">
                  {/* Selector de provincia */}
                  <select
                    name="provincia"
                    value={form.provincia}
                    onChange={handleChange}
                    required
                    className="checkout-select"
                  >
                    <option value="">Seleccioná una provincia</option>
                    {PROVINCIAS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>

                  <input
                    name="localidad"
                    placeholder="Localidad / Ciudad"
                    value={form.localidad}
                    onChange={handleChange}
                    required
                  />

                  <input
                    name="direccionSucursal"
                    placeholder="Dirección o nombre de Sucursal Correo Argentino"
                    value={form.direccionSucursal}
                    onChange={handleChange}
                    required
                  />
                </div>
              ) : (
                <div className="checkout-grid">
                  <select
                    name="provincia"
                    value={form.provincia}
                    onChange={handleChange}
                    required
                    className="checkout-select"
                  >
                    <option value="">Seleccioná provincia</option>
                    {PROVINCIAS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                  <input name="localidad" placeholder="Localidad / Ciudad" value={form.localidad} onChange={handleChange} required />
                  <input name="calleNumero" placeholder="Calle y número" value={form.calleNumero} onChange={handleChange} required />
                  <input name="pisoDepto" placeholder="Piso/Depto (opcional)" value={form.pisoDepto} onChange={handleChange} />
                  <input name="codigoPostal" placeholder="Código postal" value={form.codigoPostal} onChange={handleChange} required />
                </div>
              )}

            </section>

            <aside className="checkout-card">
              <h2>Resumen</h2>
              {items.map(i => (
                <div key={`${i._id}-${i.talle}`} className="checkout-item">
                  <span>{i.nombre} x{i.cantidad}</span>
                  <span>${(i.precio * i.cantidad).toLocaleString('es-AR')}</span>
                </div>
              ))}
              <div className="checkout-total">
                <span>Subtotal</span>
                <span>${subtotal.toLocaleString('es-AR')}</span>
              </div>
              <div className="checkout-total">
                <span>Envío</span>
                <span>${shippingCost.toLocaleString('es-AR')}</span>
              </div>
              <div className="checkout-total" style={{ marginTop: '0.2rem', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '0.4rem' }}>
                <strong>Total</strong>
                <strong>${totalWithShipping.toLocaleString('es-AR')}</strong>
              </div>
              {error && <p className="checkout-error">{error}</p>}
              <button className="btn btn-filled checkout-btn" disabled={loading}>
                {loading ? 'Confirmando...' : 'Confirmar pedido'}
              </button>
            </aside>
          </div>
        </form>
      </div>
    </div>
  )
}



```

================================================================================
ARCHIVO: tienda-frontend/src/components/Footer/Footer.jsx
================================================================================

```jsx
﻿import { useState } from 'react'
import { Link } from 'react-router-dom'
import { getBrandConfig } from '../../config/siteConfig'
import { useBrand } from '../../context/BrandContext'
import './Footer.css'

const INFOS = {
  'como-comprar': {
    title: 'Cómo comprar en Looser',
    badge: 'Guía de compra',
    sections: [
      {
        heading: '1. Elegí tus prendas',
        text: 'Navegá por nuestra tienda, seleccioná el modelo y consultá la tabla de medidas en la ficha de cada producto para elegir tu talle ideal.'
      },
      {
        heading: '2. Agregá al carrito',
        text: 'Hacé click en "Agregar al carrito". Podés seguir sumando prendas de la misma marca o avanzar directamente al checkout.'
      },
      {
        heading: '3. Datos de envío',
        text: 'Completá tus datos postales reales. Podés elegir entre retiro en sucursal oficial de Correo Argentino ($7.500) o envío directo a tu domicilio ($11.000).'
      },
      {
        heading: '4. Medio de pago',
        text: 'Aboná de forma segura con dinero en cuenta o tarjetas a través de Mercado Pago, o seleccioná Transferencia Bancaria.'
      },
      {
        heading: '5. Confirmación y seguimiento',
        text: 'Una vez acreditado el pago, tu orden entra en preparación. Recibirás un email con el código de seguimiento de Correo Argentino para rastrear tu paquete en todo momento.'
      }
    ]
  },
  'envios': {
    title: 'Envíos y Logística',
    badge: 'Correo Argentino',
    sections: [
      {
        heading: 'Cobertura nacional',
        text: 'Realizamos envíos a todo el territorio de la República Argentina a través de Correo Argentino.'
      },
      {
        heading: 'Costos vigentes',
        text: '• Retiro en sucursal de Correo Argentino: $7.500\n• Envío directo a domicilio: $11.000\nLos costos son fijos y se abonan junto con el pedido al momento del checkout.'
      },
      {
        heading: 'Plazos de despacho y entrega',
        text: 'Los pedidos se preparan y despachan dentro de las 24 a 72 horas hábiles posteriores a la confirmación del pago. Una vez despachado, el tiempo de entrega habitual de Correo Argentino oscila entre 3 y 6 días hábiles según la localidad de destino.'
      },
      {
        heading: 'Seguimiento en tiempo real',
        text: 'Apenas despachamos tu pedido, te enviamos por correo electrónico el código de seguimiento (tracking ID) para que puedas consultar el estado de tu encomienda en la web oficial de Correo Argentino.'
      }
    ]
  },
  'cambios': {
    title: 'Cambios y Garantía Legal',
    badge: 'Ley N° 24.240',
    sections: [
      {
        heading: 'Garantía legal de fabricación',
        text: 'Todas nuestras prendas cuentan con garantía legal conforme a la Ley N° 24.240 de Defensa del Consumidor por cualquier falla, rotura o defecto de confección.'
      },
      {
        heading: 'Cambios por talle o modelo',
        text: 'Podés solicitar el cambio dentro de los 15 días corridos posteriores a la recepción de la prenda. La prenda debe encontrarse sin uso, sin manchas, con sus etiquetas colocadas y en su empaque original.'
      },
      {
        heading: 'Costos de envío en cambios',
        text: 'Si el cambio es por falla de fábrica o error en el despacho, todos los costos de envío corren 100% por nuestra cuenta. Si el cambio es por elección de talle o preferencia del cliente, los costos logísticos de reenvío corren a cargo del comprador.'
      },
      {
        heading: 'Cómo iniciar un cambio',
        text: 'Escribinos por mensaje directo a nuestro Instagram oficial o a nuestro email con tu número de orden y fotos de la prenda para coordinar de inmediato.'
      }
    ]
  },
  'terminos': {
    title: 'Términos y Condiciones Generales',
    badge: 'Términos de servicio',
    sections: [
      {
        heading: 'Aceptación de las condiciones',
        text: 'El uso de este sitio web y la adquisición de cualquier producto a través de nuestra tienda online implica la aceptación plena de los presentes Términos y Condiciones.'
      },
      {
        heading: 'Precios y facturación',
        text: 'Todos los precios publicados en el sitio están expresados en Pesos Argentinos (ARS) e incluyen los impuestos correspondientes. Nos reservamos el derecho de modificar precios, promociones y disponibilidad sin previo aviso.'
      },
      {
        heading: 'Disponibilidad y stock',
        text: 'La concreción de la compra queda sujeta a la disponibilidad efectiva de stock al momento de la acreditación del pago. En caso de quiebre de stock fortuito, se reintegrará de inmediato el 100% del dinero abonado por el mismo medio de pago.'
      },
      {
        heading: 'Responsabilidad y fuerza mayor',
        text: 'Nos comprometemos al correcto acondicionamiento y despacho del paquete en tiempo y forma. La empresa no será responsable por demoras extraordinarias imputables exclusivamente al operador postal o a contingencias climáticas/fuerza mayor.'
      }
    ]
  },
  'privacidad': {
    title: 'Política de Privacidad y Protección de Datos',
    badge: 'Ley N° 25.326',
    sections: [
      {
        heading: 'Cumplimiento legal y confidencialidad',
        text: 'En cumplimiento de la Ley N° 25.326 de Protección de los Datos Personales de la República Argentina, te garantizamos que la información suministrada al operar en nuestra tienda se encuentra bajo estricto resguardo y confidencialidad.'
      },
      {
        heading: 'Finalidad de la recolección',
        text: 'Los datos requeridos (nombre, apellido, DNI, dirección, teléfono, email) son utilizados únicamente para procesar tus pedidos, emitir comprobantes de compra, coordinar los envíos postales y remitirte actualizaciones de tu compra.'
      },
      {
        heading: 'No cesión a terceros',
        text: 'Bajo ninguna circunstancia vendemos, alquilamos ni cedemos tus datos personales a empresas de publicidad o bases de datos comerciales de terceros.'
      },
      {
        heading: 'Derechos ARCO (Acceso, Rectificación, Supresión)',
        text: 'Como titular de los datos, tenés derecho a acceder a los mismos, solicitar su actualización, rectificación o eliminación definitiva en cualquier momento mediante comunicación por escrito a looserfit2004@gmail.com.'
      },
      {
        heading: 'Órgano de control',
        text: 'La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA (AAIP), en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.'
      }
    ]
  }
}

export default function Footer() {
  const [infoOpen, setInfoOpen] = useState(null)
  const { brand } = useBrand()
  const config = getBrandConfig(brand?.slug)
  const basePath = brand?.slug === 'sport' ? '/sport' : ''

  // Estado del formulario de arrepentimiento
  const [arrNombre, setArrNombre] = useState('')
  const [arrEmail, setArrEmail] = useState('')
  const [arrOrden, setArrOrden] = useState('')
  const [arrTelefono, setArrTelefono] = useState('')
  const [arrMotivo, setArrMotivo] = useState('Me arrepentí de la compra')
  const [arrMensaje, setArrMensaje] = useState('')
  const [arrExito, setArrExito] = useState(null)
  const [arrError, setArrError] = useState('')

  const handleArrepentimientoSubmit = (e) => {
    e.preventDefault()
    setArrError('')

    if (!arrNombre.trim() || !arrEmail.trim() || !arrOrden.trim()) {
      setArrError('Por favor completá los campos obligatorios (Nombre, Email y N° de Orden).')
      return
    }

    const code = `ARR-${new Date().getFullYear()}-${Math.random().toString(36).substring(2, 7).toUpperCase()}`
    const record = {
      code,
      fecha: new Date().toISOString(),
      nombre: arrNombre.trim(),
      email: arrEmail.trim(),
      orden: arrOrden.trim(),
      telefono: arrTelefono.trim(),
      motivo: arrMotivo,
      mensaje: arrMensaje.trim()
    }

    try {
      const prev = JSON.parse(localStorage.getItem('looserfit_arrepentimientos') || '[]')
      localStorage.setItem('looserfit_arrepentimientos', JSON.stringify([record, ...prev]))
    } catch { /* ignore */ }

    setArrExito(record)
  }

  const resetArrepentimiento = () => {
    setArrNombre('')
    setArrEmail('')
    setArrOrden('')
    setArrTelefono('')
    setArrMotivo('Me arrepentí de la compra')
    setArrMensaje('')
    setArrExito(null)
    setArrError('')
    setInfoOpen(null)
  }

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer__inner">

          {/* Marca / Identidad */}
          <div className="footer__brand">
            <div className="footer__logo-wrap">
              <img src={config.assets.logo} alt={config.name} className="footer__logo" />
            </div>
            <p className="footer__location">{config.contact.address}</p>
          </div>

          {/* Tienda */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Tienda</h4>
            <ul>
              <li><Link to={`${basePath}/tienda`}>Todos los productos</Link></li>
            </ul>
          </div>

          {/* Información */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Información</h4>
            <ul>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('como-comprar')}>Cómo comprar</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('envios')}>Envíos y Logística</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('cambios')}>Cambios y Garantía</button></li>
            </ul>
          </div>

          {/* Legales & Normativa */}
          <div className="footer__nav">
            <h4 className="footer__nav-title">Legales</h4>
            <ul>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('terminos')}>Términos y Condiciones</button></li>
              <li><button type="button" className="footer__info-btn" onClick={() => setInfoOpen('privacidad')}>Privacidad (Ley 25.326)</button></li>
              <li><button type="button" className="footer__info-btn footer__info-btn--highlight" onClick={() => { setInfoOpen('arrepentimiento'); setArrExito(null); }}>Botón de arrepentimiento</button></li>
            </ul>
          </div>

          {/* Soporte y Redes */}
          <div className="footer__social">
            <h4 className="footer__nav-title">Contacto</h4>
            <p className="footer__soporte">
              Escribinos por Instagram al{' '}
              <a
                href={`https://www.instagram.com/${config.socials.instagram.replace('@', '')}`}
                target="_blank"
                rel="noreferrer"
                className="footer__dm-link"
              >
                DM
              </a>
              {' '}o a nuestro email oficial.
            </p>
            <div className="footer__social-links" style={{ marginTop: '0.8rem' }}>
              <a href={`https://www.instagram.com/${config.socials.instagram.replace('@', '')}`} target="_blank" rel="noreferrer">
                Instagram Oficial ↗
              </a>
            </div>
          </div>

        </div>

        {/* ── BARRA DESTACADA: BOTÓN DE ARREPENTIMIENTO (Resolución 424/2020 SCI) ── */}
        <div className="footer__arrepentimiento-bar">
          <div className="footer__arrepentimiento-info">
            <span className="footer__arrepentimiento-tag">Defensa del Consumidor · Res. 424/2020</span>
            <p className="footer__arrepentimiento-desc">
              ¿Compraste y querés cancelar tu pedido? Tenés 10 días corridos desde recibido el producto para revocar tu compra sin costo.
            </p>
          </div>
          <button
            type="button"
            className="footer__arrepentimiento-action"
            onClick={() => { setInfoOpen('arrepentimiento'); setArrExito(null); }}
          >
            <span className="footer__arrepentimiento-icon">↺</span> Botón de arrepentimiento
          </button>
        </div>

        {/* Copyright & Créditos */}
        <div className="footer-content">
          <p>© {new Date().getFullYear()} {config.name} ({config.contact?.razonSocial || 'Looser Fit'}) — Todos los derechos reservados · República Argentina</p>
          <p className="footer__fiscal-info" style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '0.3rem' }}>
            CUIT: {config.contact?.cuit || '[EN TRÁMITE]'} · Domicilio: {config.contact?.address} · 
            <a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank" rel="noreferrer" className="defensa-consumidor-link" style={{ marginLeft: '0.4rem', textDecoration: 'underline' }}>
              Defensa del Consumidor (Ley 24.240) ↗
            </a>
          </p>
          <p className="credit">
            Creado por{' '}
            <a href="https://instagram.com/saravia.devv" target="_blank" rel="noreferrer" className="credit__link">
              Theo Saravia <span className="credit__icon">↗</span>
            </a>
          </p>
        </div>
      </div>

      {/* ── MODAL LEGALES / ARREPENTIMIENTO ── */}
      {infoOpen && (
        <div className="footer-modal-overlay" onClick={resetArrepentimiento}>
          <div className="footer-modal" onClick={e => e.stopPropagation()}>
            <div className="footer-modal__header">
              <div>
                <span className="footer-modal__badge">
                  {infoOpen === 'arrepentimiento' ? 'Ley N° 24.240 · Res. 424/2020' : INFOS[infoOpen]?.badge}
                </span>
                <h3 className="footer-modal__title">
                  {infoOpen === 'arrepentimiento' ? 'Botón de Arrepentimiento' : INFOS[infoOpen]?.title}
                </h3>
              </div>
              <button type="button" className="footer-modal__close" onClick={resetArrepentimiento} aria-label="Cerrar modal">✕</button>
            </div>

            <div className="footer-modal__body">
              {infoOpen === 'arrepentimiento' ? (
                arrExito ? (
                  /* ── Pantalla de Confirmación de Arrepentimiento ── */
                  <div className="arrepentimiento-success">
                    <div className="arrepentimiento-success__icon">✓</div>
                    <h4>Solicitud de Arrepentimiento Registrada</h4>
                    <p className="arrepentimiento-success__text">
                      Conforme al Art. 34 de la Ley N° 24.240 y la Res. 424/2020, hemos generado tu número de trámite oficial:
                    </p>
                    <div className="arrepentimiento-success__code-box">
                      <span className="arrepentimiento-success__code-label">Código de Trámite:</span>
                      <strong className="arrepentimiento-success__code">{arrExito.code}</strong>
                    </div>
                    <p className="arrepentimiento-success__notice">
                      Te contactaremos dentro de las <strong>24 horas hábiles</strong> a <strong>{arrExito.email}</strong> para coordinar el retiro/envío del producto y el reintegro total del dinero sin costo alguno.
                    </p>
                    <button type="button" className="btn btn--primary" onClick={resetArrepentimiento} style={{ width: '100%', marginTop: '1rem' }}>
                      Entendido / Cerrar
                    </button>
                  </div>
                ) : (
                  /* ── Formulario de Arrepentimiento ── */
                  <form onSubmit={handleArrepentimientoSubmit} className="arrepentimiento-form">
                    <div className="arrepentimiento-form__intro">
                      <p>
                        Conforme al <strong>Artículo 34 de la Ley 24.240</strong>, tenés derecho a revocar la aceptación de tu compra durante el plazo de <strong>DIEZ (10) días corridos</strong> contados a partir de la entrega del producto.
                      </p>
                      <p style={{ marginTop: '0.4rem', fontSize: '0.82rem', color: 'rgba(255,255,255,0.6)' }}>
                        Completá este formulario para registrar de inmediato tu número de trámite. Nos contactaremos en menos de 24 hs hábiles.
                      </p>
                    </div>

                    {arrError && <div className="arrepentimiento-error">{arrError}</div>}

                    <div className="arrepentimiento-grid">
                      <div className="arrepentimiento-field">
                        <label>Nombre y Apellido *</label>
                        <input
                          type="text"
                          required
                          placeholder="Tu nombre completo"
                          value={arrNombre}
                          onChange={e => setArrNombre(e.target.value)}
                        />
                      </div>
                      <div className="arrepentimiento-field">
                        <label>Email de compra *</label>
                        <input
                          type="email"
                          required
                          placeholder="email@ejemplo.com"
                          value={arrEmail}
                          onChange={e => setArrEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="arrepentimiento-grid">
                      <div className="arrepentimiento-field">
                        <label>N° de Pedido / Orden *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ej: #102 o ID del pedido"
                          value={arrOrden}
                          onChange={e => setArrOrden(e.target.value)}
                        />
                      </div>
                      <div className="arrepentimiento-field">
                        <label>Teléfono de contacto</label>
                        <input
                          type="tel"
                          placeholder="Ej: 11 2345-6789"
                          value={arrTelefono}
                          onChange={e => setArrTelefono(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="arrepentimiento-field">
                      <label>Motivo de la revocación</label>
                      <select value={arrMotivo} onChange={e => setArrMotivo(e.target.value)}>
                        <option value="Me arrepentí de la compra">Me arrepentí de la compra (derecho de revocación)</option>
                        <option value="Producto con falla o defecto">Producto con falla o defecto de fábrica</option>
                        <option value="Disconformidad con el talle o medidas">Disconformidad con el talle o medidas</option>
                        <option value="Error en la entrega o demora">Error en la entrega o demora de envío</option>
                        <option value="Otro motivo">Otro motivo</option>
                      </select>
                    </div>

                    <div className="arrepentimiento-field">
                      <label>Comentarios adicionales (opcional)</label>
                      <textarea
                        rows="2"
                        placeholder="Detalles sobre el estado del paquete o información útil..."
                        value={arrMensaje}
                        onChange={e => setArrMensaje(e.target.value)}
                      />
                    </div>

                    <div className="arrepentimiento-actions">
                      <button type="button" className="btn btn--secondary" onClick={resetArrepentimiento}>
                        Cancelar
                      </button>
                      <button type="submit" className="btn btn--primary">
                        Enviar solicitud de arrepentimiento
                      </button>
                    </div>
                  </form>
                )
              ) : (
                /* ── Visualización de Términos / Privacidad / Guías ── */
                <div className="legal-doc">
                  {INFOS[infoOpen]?.sections.map((sec, idx) => (
                    <div key={idx} className="legal-doc__section">
                      <h5 className="legal-doc__heading">{sec.heading}</h5>
                      <p className="legal-doc__text">{sec.text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="footer-modal__footer">
              <button type="button" className="btn btn--secondary" onClick={resetArrepentimiento}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </footer>
  )
}
```

================================================================================
ARCHIVO: tienda-frontend/src/config/siteConfig.js
================================================================================

```javascript
/**
 * siteConfig.js — Configuración estática de cada marca para el frontend.
 * getBrandConfig(slug) devuelve la config de la marca solicitada.
 * siteConfig mantiene el valor de Fit para compatibilidad con código legacy.
 */

const BRAND_CONFIGS = {
  fit: {
    name: 'Looser Fit',
    tagline: 'High Quality Aesthetic Wear',
    socials: {
      instagram: '@looser.fit',
      twitter: '@looserfit',
    },
    contact: {
      email: 'hola@looserfit.com',
      address: 'Buenos Aires, Argentina',
      cuit: '[CUIT EN TRÁMITE - RESPONSABLE A DESIGNAR]',
      razonSocial: 'Looser Fit Indumentaria',
      defensaConsumidorUrl: 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario',
    },
    assets: {
      logo: '/logo3.0.png',
      favicon: '/favicon.ico',
      adminAvatar: '/logo3.0.png',
    },
    settings: {
      showNewsletter: true,
      showTracking: true,
    },
  },
  sport: {
    name: 'Looser Sport',
    tagline: 'Performance & Style',
    socials: {
      instagram: '@looser.sport',
      twitter: '@loosersport',
    },
    contact: {
      email: 'hola@loosersport.com',
      address: 'Buenos Aires, Argentina',
    },
    assets: {
      logo: '/logo-sport.png',
      favicon: '/favicon.ico',
      adminAvatar: '/logo-sport.png',
    },
    settings: {
      showNewsletter: true,
      showTracking: true,
    },
  },
}

// Helper: obtener config por slug de marca
export const getBrandConfig = (slug = 'fit') => BRAND_CONFIGS[slug] || BRAND_CONFIGS.fit

// Compatibilidad legacy: código que importa siteConfig directamente sigue usando Fit
export const siteConfig = BRAND_CONFIGS.fit

```

================================================================================
ARCHIVO: tienda-frontend/index.html
================================================================================

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    
    <!-- Branding & Favicon -->
    <link rel="icon" type="image/png" href="/logo3.0.png" />
    <link rel="apple-touch-icon" href="/logo3.0.png" />

    <!-- SEO Primario -->
    <title>looserfit.com</title>
    <meta name="title" content="looserfit.com" />
    <meta name="description" content="Looser Fit — Indumentaria urbana, ropa oversize y streetwear de alta calidad en Argentina. Envíos a todo el país por Correo Argentino." />
    <meta name="robots" content="index, follow" />
    <link rel="canonical" href="https://www.looserfit.com" />

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="https://www.looserfit.com" />
    <meta property="og:title" content="looserfit.com" />
    <meta property="og:description" content="Looser Fit — Indumentaria urbana, ropa oversize y streetwear de alta calidad en Argentina. Envíos a todo el país." />
    <meta property="og:image" content="https://www.looserfit.com/logo3.0.png" />
    <meta property="og:site_name" content="Looser Fit" />
    <meta property="og:locale" content="es_AR" />

    <!-- Twitter / X -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="https://www.looserfit.com" />
    <meta name="twitter:title" content="looserfit.com" />
    <meta name="twitter:description" content="Looser Fit — Indumentaria urbana, ropa oversize y streetwear de alta calidad en Argentina." />
    <meta name="twitter:image" content="https://www.looserfit.com/logo3.0.png" />

    <!-- Structured Data (JSON-LD) - Schema.org ClothingStore & WebSite -->
    <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "WebSite",
          "@id": "https://www.looserfit.com/#website",
          "url": "https://www.looserfit.com",
          "name": "Looser Fit",
          "description": "Indumentaria urbana y streetwear en Argentina",
          "inLanguage": "es-AR"
        },
        {
          "@type": "ClothingStore",
          "@id": "https://www.looserfit.com/#store",
          "name": "Looser Fit",
          "url": "https://www.looserfit.com",
          "logo": "https://www.looserfit.com/logo3.0.png",
          "image": "https://www.looserfit.com/logo3.0.png",
          "description": "Tienda oficial de indumentaria urbana y oversize en Argentina.",
          "address": {
            "@type": "PostalAddress",
            "addressCountry": "AR",
            "addressRegion": "Buenos Aires"
          },
          "contactPoint": {
            "@type": "ContactPoint",
            "contactType": "customer service",
            "email": "hola@looserfit.com",
            "availableLanguage": "Spanish"
          }
        }
      ]
    }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>

```

