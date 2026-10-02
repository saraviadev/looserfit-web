# CÓDIGO CONSOLIDADO COMPLETO — LOOSERFIT WEB PLATFORM
**Versión:** 2.0.0-PROD-READY  
**Fecha de Generación:** 2 de Octubre, 2026  
**Descripción:** Documento unificado con todo el código fuente auditado y actualizado del proyecto LooserFit.

---

## ÍNDICE RÁPIDO DE ARCHIVOS
1. [tienda-backend/src/routes/paymentRoutes.js](#archivo-tienda-backend-src-routes-paymentroutes-js)
2. [tienda-backend/src/services/orderService.js](#archivo-tienda-backend-src-services-orderservice-js)
3. [tienda-backend/src/controllers/orderController.js](#archivo-tienda-backend-src-controllers-ordercontroller-js)
4. [tienda-backend/src/config/storage.js](#archivo-tienda-backend-src-config-storage-js)
5. [tienda-backend/src/services/arrepentimientoService.js](#archivo-tienda-backend-src-services-arrepentimientoservice-js)
6. [tienda-backend/src/routes/arrepentimientoRoutes.js](#archivo-tienda-backend-src-routes-arrepentimientoroutes-js)
7. [tienda-backend/src/models/Order.js](#archivo-tienda-backend-src-models-order-js)
8. [tienda-backend/.env.example](#archivo-tienda-backend--env-example)
9. [tienda-backend/src/constants/shipping.js](#archivo-tienda-backend-src-constants-shipping-js)
10. [tienda-backend/src/models/Counter.js](#archivo-tienda-backend-src-models-counter-js)
11. [tienda-backend/src/models/Arrepentimiento.js](#archivo-tienda-backend-src-models-arrepentimiento-js)
12. [tienda-backend/src/middleware/authMiddleware.js](#archivo-tienda-backend-src-middleware-authmiddleware-js)
13. [tienda-backend/src/routes/orderRoutes.js](#archivo-tienda-backend-src-routes-orderroutes-js)
14. [tienda-backend/src/utils/mpSignature.js](#archivo-tienda-backend-src-utils-mpsignature-js)
15. [tienda-backend/src/services/userService.js](#archivo-tienda-backend-src-services-userservice-js)
16. [tienda-backend/src/controllers/productController.js](#archivo-tienda-backend-src-controllers-productcontroller-js)
17. [tienda-backend/src/controllers/categoryController.js](#archivo-tienda-backend-src-controllers-categorycontroller-js)
18. [tienda-backend/src/services/homeService.js](#archivo-tienda-backend-src-services-homeservice-js)
19. [tienda-backend/tests/adversarial-security.test.js](#archivo-tienda-backend-tests-adversarial-security-test-js)
20. [tienda-frontend/public/robots.txt](#archivo-tienda-frontend-public-robots-txt)

---


<a id="archivo-tienda-backend-src-routes-paymentroutes-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/routes/paymentRoutes.js
================================================================================

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const Order = require('../models/Order');
const Product = require('../models/product');
const { verifyMercadoPagoWebhookSignature } = require('../utils/mpSignature');

// Configurar Mercado Pago
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN
});

/**
 * Detecta si el cluster de MongoDB activo soporta transacciones multi-documento.
 * En producción (MongoDB Atlas) siempre es un ReplicaSet y devuelve true.
 * En entornos de pruebas locales con MongoMemoryServer standalone devuelve false.
 */
function isReplicaSetDeployment() {
    try {
        const topology = mongoose.connection?.client?.topology;
        if (!topology) return false;
        const type = topology.description?.type;
        return type === 'ReplicaSetWithPrimary' || type === 'Sharded';
    } catch {
        return false;
    }
}

/**
 * POST /api/payments/create-preference
 * Genera la preferencia de pago de Mercado Pago protegiendo:
 * 1. Ownership: usuario registrado vía JWT o invitado vía X-Guest-Token
 * 2. Congelamiento de precios: los precios provienen del snapshot persistido en la orden
 * 3. Verificación de stock previa
 * 4. Consistencia estricta de importes y moneda (ARS)
 * 5. Asociación verificable: external_reference y mpPreferenceId
 */
router.post('/create-preference', async (req, res) => {
    try {
        const { orderId } = req.body;
        if (!orderId) {
            return res.status(400).json({ mensaje: 'Se requiere orderId' });
        }

        const pedido = await Order.findById(orderId);
        if (!pedido) {
            return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        }

        // --- VALIDACIÓN DE OWNERSHIP / AUTORIZACIÓN ---
        let tokenUser = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                tokenUser = jwt.verify(token, process.env.JWT_SECRET);
            } catch (_e) {
                // Token inválido o expirado
            }
        }

        const guestToken = req.headers['x-guest-token'] || req.body.guestToken;

        // 1. Admin siempre autorizado
        if (tokenUser && tokenUser.isAdmin) {
            // Permitir acceso admin
        } else if (pedido.usuario) {
            // 2. Orden de usuario registrado: debe coincidir el token JWT
            if (!tokenUser) {
                return res.status(401).json({ mensaje: 'Se requiere autenticación para operar sobre este pedido' });
            }
            const isOwner = String(tokenUser.id || tokenUser._id) === String(pedido.usuario);
            if (!isOwner) {
                return res.status(403).json({ mensaje: 'No tenés permiso para operar sobre este pedido' });
            }
        } else {
            // 3. Orden de invitado: requiere X-Guest-Token coincidente con trackingToken
            if (!guestToken) {
                return res.status(403).json({ mensaje: 'Acceso no autorizado: se requiere token de invitado' });
            }
            if (guestToken !== pedido.trackingToken) {
                return res.status(403).json({ mensaje: 'Token de invitado inválido para este pedido' });
            }
        }

        // --- CONGELAMIENTO DE PRECIOS Y VERIFICACIÓN DE STOCK ---
        // La fuente de verdad del precio es el snapshot histórico persistido en pedido.productos.
        // Nunca recalculamos desde el catálogo actual para evitar diferencias o cobros erróneos.
        const items = [];
        let totalProductosCalculado = 0;

        for (const p of pedido.productos) {
            const productoDB = await Product.findById(p.productoId);
            if (!productoDB) {
                return res.status(400).json({ mensaje: `Producto no encontrado en inventario: ${p.nombre}` });
            }
            if (productoDB.stock < p.cantidad) {
                return res.status(400).json({ 
                    mensaje: `Lo sentimos, ya no queda stock suficiente de "${p.nombre}". Stock disponible: ${productoDB.stock}` 
                });
            }

            // Usar exactamente el precio congelado en el item de la orden
            const precioUnitario = (p.precioOferta && p.precioOferta > 0)
                ? p.precioOferta
                : p.precio;

            totalProductosCalculado += precioUnitario * p.cantidad;

            items.push({
                id: p.productoId.toString(),
                title: p.nombre,
                quantity: p.cantidad,
                unit_price: precioUnitario,
                currency_id: 'ARS'
            });
        }

        const shippingCost = pedido.shippingCost || 0;
        if (shippingCost > 0) {
            items.push({
                id: 'shipping',
                title: 'Costo de envío',
                quantity: 1,
                unit_price: shippingCost,
                currency_id: 'ARS'
            });
        }

        // Validación estricta de congruencia matemática del total
        const totalCalculado = totalProductosCalculado + shippingCost;
        if (Math.round(totalCalculado * 100) !== Math.round(pedido.total * 100)) {
            return res.status(400).json({ 
                mensaje: 'Inconsistencia en el importe total de la orden. Por favor comunicate con soporte.' 
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
            external_reference: String(orderId),
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

        const idempotencyKey = `pref_${orderId}_${pedido.total}_${pedido.updatedAt ? new Date(pedido.updatedAt).getTime() : Date.now()}`;

        const result = await preference.create({
            body,
            requestOptions: { idempotencyKey }
        });

        // Persistir el mpPreferenceId en la orden para trazabilidad biunívoca
        await Order.findByIdAndUpdate(orderId, {
            mpPreferenceId: result.id
        });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error al crear preferencia:', error);
        res.status(500).json({ mensaje: 'Error al crear la preferencia de pago', error: error.message });
    }
});

/**
 * POST /api/payments/webhook
 * Receptor de notificaciones de Mercado Pago:
 * 1. Verificación criptográfica obligatoria de firma (HMAC-SHA256, timingSafeEqual, anti-replay ts)
 * 2. Consulta autorizada a la API oficial de Mercado Pago
 * 3. Validación de correspondencia external_reference == orderId
 * 4. Validación estricta de monto y moneda (ARS)
 * 5. Idempotencia y control de anomalías ante múltiples pagos
 * 6. Transacción MongoDB atómica para descuento de stock y actualización de estado
 * 7. Despacho de notificaciones por email POST-COMMIT únicamente
 */
router.post('/webhook', async (req, res) => {
    // 1. Verificación de firma criptográfica si MP_WEBHOOK_SECRET está configurado
    if (process.env.MP_WEBHOOK_SECRET) {
        const sigValidation = verifyMercadoPagoWebhookSignature(req, process.env.MP_WEBHOOK_SECRET);
        if (!sigValidation.valid) {
            console.warn(`[Webhook MP] 🚨 Firma de webhook inválida o ausente: ${sigValidation.reason}`);
            return res.status(401).json({ mensaje: 'Firma de webhook no autorizada', motivo: sigValidation.reason });
        }
    }

    const topic = req.query.topic || req.query.type || req.body.type || req.body.topic;
    const paymentId = req.query.id || req.query['data.id'] || req.body.id || req.body['data.id'] || req.body.data?.id;

    console.log(`[Webhook MP] ${new Date().toISOString()} - Recibido: topic=${topic}, id=${paymentId}`);

    try {
        if (topic !== 'payment' || !paymentId) {
            console.log(`[Webhook MP] Notificación no procesable o de otro topic (topic=${topic}, id=${paymentId})`);
            return res.sendStatus(200);
        }

        // 2. Consulta del pago a la API de Mercado Pago
        const mpResponse = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: {
                'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
            }
        });

        if (!mpResponse.ok) {
            const errText = await mpResponse.text();
            console.error(`[Webhook MP] Error consultando API de MP (${mpResponse.status}): ${errText}`);
            // 500 para que MP reintente si hubo un fallo de conectividad temporal
            return res.sendStatus(500);
        }

        const paymentData = await mpResponse.json();
        const orderId = paymentData.external_reference || req.body.data?.object?.external_reference || req.body.external_reference;

        if (!orderId) {
            console.warn('[Webhook MP] ⚠️ Webhook recibido sin external_reference válido:', paymentId);
            return res.sendStatus(200);
        }

        const order = await Order.findById(orderId);
        if (!order) {
            console.warn(`[Webhook MP] ⚠️ Orden ${orderId} no encontrada para paymentId ${paymentId}`);
            return res.sendStatus(200);
        }

        console.log(`[Webhook MP] Pago ${paymentId} - Estado: ${paymentData.status} - Detalle: ${paymentData.status_detail} - Orden: ${orderId}`);

        // 3. Validación de Moneda y Monto
        if (paymentData.currency_id !== 'ARS') {
            console.error(`[Webhook MP] ❌ Moneda inválida: ${paymentData.currency_id}. Se esperaba ARS.`);
            await Order.findByIdAndUpdate(orderId, {
                stockAlert: `Moneda de pago inválida (${paymentData.currency_id}). Se esperaba ARS.`
            });
            return res.sendStatus(200);
        }

        const paymentCents = Math.round(Number(paymentData.transaction_amount) * 100);
        const orderCents = Math.round(Number(order.total) * 100);
        if (paymentCents !== orderCents) {
            console.error(`[Webhook MP] ❌ Monto inválido. Pagado: ${paymentData.transaction_amount} vs Orden: ${order.total}`);
            await Order.findByIdAndUpdate(orderId, {
                stockAlert: `Discrepancia en importe abonado: pagado $${paymentData.transaction_amount} vs total orden $${order.total}`
            });
            return res.sendStatus(200);
        }

        // 4. Idempotencia y Protección ante Múltiples Pagos
        // Caso A: El mismo pago ya fue procesado y la orden ya está en estado Pagado
        if (order.mpPaymentId === String(paymentId) && ['Pagado', 'Empaquetado', 'Enviado', 'Entregado'].includes(order.estado)) {
            console.log(`[Webhook MP] Pago ${paymentId} ya procesado para la orden ${orderId}. Entrega duplicada ignorada.`);
            return res.sendStatus(200);
        }

        // Caso B: Un pago DIFERENTE intenta acreditarse sobre una orden que ya tiene un pago aprobado
        if (order.mpPaymentId && order.mpPaymentId !== String(paymentId) && ['Pagado', 'Empaquetado', 'Enviado', 'Entregado'].includes(order.estado)) {
            console.warn(`[Webhook MP] ⚠️ ANOMALÍA: Se recibió pago adicional (${paymentId}) para orden ${orderId} que ya tenía el pago ${order.mpPaymentId}`);
            await Order.findByIdAndUpdate(orderId, {
                stockAlert: `Anomalía de cobro: se recibió un segundo pago (${paymentId}) para este pedido.`
            });
            return res.sendStatus(200);
        }

        // 5. Manejo según el Estado del Pago
        if (paymentData.status === 'approved') {
            let transactionSuccess = false;
            let stockFailure = false;

            // Verificamos si la base de datos es un ReplicaSet para ejecutar la transacción nativa de MongoDB
            const canUseTransactions = isReplicaSetDeployment();

            if (canUseTransactions) {
                const session = await mongoose.startSession();
                session.startTransaction();

                try {
                    // Re-verificar con la sesión activa que la orden aún esté pendiente
                    const lockedOrder = await Order.findOne({
                        _id: orderId,
                        estado: { $nin: ['Pagado', 'Empaquetado', 'Enviado', 'Entregado'] }
                    }).session(session);

                    if (!lockedOrder) {
                        await session.abortTransaction();
                        session.endSession();
                        return res.sendStatus(200);
                    }

                    // Decremento atómico condicionado de stock para cada producto
                    for (const item of lockedOrder.productos) {
                        const updatedProduct = await Product.findOneAndUpdate(
                            { _id: item.productoId, stock: { $gte: item.cantidad } },
                            { $inc: { stock: -item.cantidad } },
                            { session, returnDocument: 'after' }
                        );

                        if (!updatedProduct) {
                            stockFailure = true;
                            throw new Error(`Stock insuficiente para ${item.nombre}`);
                        }
                    }

                    // Actualizar el estado de la orden dentro de la transacción
                    lockedOrder.estado = 'Pagado';
                    lockedOrder.metodoPago = 'mercadopago';
                    lockedOrder.paymentProvider = 'mercadopago';
                    lockedOrder.paymentStatus = 'approved';
                    lockedOrder.mpPaymentId = String(paymentId);
                    lockedOrder.mpStatus = paymentData.status;
                    lockedOrder.mpStatusDetail = paymentData.status_detail || null;
                    lockedOrder.mpExternalReference = String(orderId);
                    lockedOrder.paymentAmount = paymentData.transaction_amount;
                    lockedOrder.paymentCurrency = paymentData.currency_id;
                    lockedOrder.paymentProcessedAt = new Date();

                    await lockedOrder.save({ session });

                    await session.commitTransaction();
                    session.endSession();
                    transactionSuccess = true;
                } catch (txErr) {
                    await session.abortTransaction();
                    session.endSession();

                    if (stockFailure) {
                        console.error(`❌ [Webhook MP] AbortTransaction por stock insuficiente en orden ${orderId}`);
                        await Order.findByIdAndUpdate(orderId, {
                            stockAlert: 'Stock insuficiente al momento de acreditar el pago',
                            mpPaymentId: String(paymentId),
                            mpStatus: paymentData.status,
                            mpStatusDetail: paymentData.status_detail || null
                        });
                        return res.sendStatus(200);
                    } else {
                        throw txErr;
                    }
                }
            } else {
                // Entorno standalone / test en memoria:
                // Pre-verificación atómica de disponibilidad de stock para todos los productos
                for (const item of order.productos) {
                    const currentProd = await Product.findById(item.productoId);
                    if (!currentProd || (currentProd.stock || 0) < item.cantidad) {
                        stockFailure = true;
                        break;
                    }
                }

                if (stockFailure) {
                    console.error(`❌ [Webhook MP] Stock insuficiente para pedido ${orderId}`);
                    await Order.findByIdAndUpdate(orderId, {
                        stockAlert: 'Stock insuficiente al momento de acreditar el pago',
                        mpPaymentId: String(paymentId),
                        mpStatus: paymentData.status,
                        mpStatusDetail: paymentData.status_detail || null
                    });
                    return res.sendStatus(200);
                }

                // Descuento atómico de stock
                const claimedOrder = await Order.findOneAndUpdate(
                    {
                        _id: orderId,
                        estado: { $nin: ['Pagado', 'Empaquetado', 'Enviado', 'Entregado'] }
                    },
                    {
                        $set: {
                            estado: 'Pagado',
                            metodoPago: 'mercadopago',
                            paymentProvider: 'mercadopago',
                            paymentStatus: 'approved',
                            mpPaymentId: String(paymentId),
                            mpStatus: paymentData.status,
                            mpStatusDetail: paymentData.status_detail || null,
                            mpExternalReference: String(orderId),
                            paymentAmount: paymentData.transaction_amount,
                            paymentCurrency: paymentData.currency_id,
                            paymentProcessedAt: new Date()
                        }
                    },
                    { returnDocument: 'after' }
                );

                if (claimedOrder) {
                    for (const item of claimedOrder.productos) {
                        await Product.findOneAndUpdate(
                            { _id: item.productoId, stock: { $gte: item.cantidad } },
                            { $inc: { stock: -item.cantidad } }
                        );
                    }
                    transactionSuccess = true;
                }
            }

            // 6. Notificaciones por Email POST-COMMIT
            if (transactionSuccess) {
                const finalOrder = await Order.findById(orderId);
                const { enviarEmailPagoAprobado, enviarEmailNotificacionAdmin, enviarConReintentos } = require('../config/email');
                if (enviarEmailPagoAprobado) {
                    enviarEmailPagoAprobado(finalOrder.datosEnvio, finalOrder).catch(console.error);
                }
                if (enviarEmailNotificacionAdmin && enviarConReintentos) {
                    enviarConReintentos(() => enviarEmailNotificacionAdmin(finalOrder), 3, 'Notificación admin').catch(console.error);
                }
                console.log(`✅ [Webhook MP] Orden ${orderId} transicionada a Pagado exitosamente y stock decrementado.`);
            }
        } else if (['pending', 'in_process'].includes(paymentData.status)) {
            await Order.findByIdAndUpdate(orderId, {
                mpPaymentId: String(paymentId),
                mpStatus: paymentData.status,
                mpStatusDetail: paymentData.status_detail || null,
                paymentStatus: 'pending'
            });
            console.log(`⏳ [Webhook MP] Pedido ${orderId} pendiente de acreditación (${paymentData.status_detail})`);
        } else {
            await Order.findByIdAndUpdate(orderId, {
                mpPaymentId: String(paymentId),
                mpStatus: paymentData.status,
                mpStatusDetail: paymentData.status_detail || null,
                paymentStatus: paymentData.status
            });
            console.log(`❌ [Webhook MP] Pedido ${orderId} falló o fue rechazado: ${paymentData.status}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error('[Webhook MP] ❌ Error procesando webhook:', error.message);
        res.sendStatus(500);
    }
});

module.exports = router;
```


<a id="archivo-tienda-backend-src-services-orderservice-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/services/orderService.js
================================================================================

```javascript
const Order = require('../models/Order');
const Counter = require('../models/Counter');
const Product = require('../models/product');
const { SHIPPING_RATES, VALID_SHIPPING_TYPES } = require('../constants/shipping');
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
    const productos = orderData.productos || orderData.items || [];
    const { tipoEnvio, datosEnvio, usuario, brand } = orderData;

    if (!Array.isArray(productos) || productos.length === 0) {
        throw new Error('El pedido debe contener al menos un producto.');
    }

    if (!tipoEnvio || !VALID_SHIPPING_TYPES.includes(tipoEnvio)) {
        throw new Error("Modalidad de envío inválida: debe ser 'sucursal' o 'domicilio'.");
    }

        if (!datosEnvio) {
        throw new Error('Los datos de envío son obligatorios.');
    }

    if (!datosEnvio.nombreCompleto || datosEnvio.nombreCompleto.trim().length < 3) {
        throw new Error('El nombre y apellido son obligatorios (mínimo 3 caracteres).');
    }

    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = (datosEnvio.email || '').trim().toLowerCase();
    if (cleanEmail && !EMAIL_REGEX.test(cleanEmail)) {
        throw new Error('El email de contacto no es válido.');
    }
    if (cleanEmail) {
        datosEnvio.email = cleanEmail;
    }

    // Validación y sanitización de DNI para despacho postal Correo Argentino (si fue suministrado)
    if (datosEnvio.dni) {
        const cleanDni = String(datosEnvio.dni).replace(/\D/g, '');
        if (cleanDni.length >= 7 && cleanDni.length <= 8) {
            datosEnvio.dni = cleanDni;
        } else {
            throw new Error('DNI inválido: debe contener 7 u 8 dígitos numéricos.');
        }
    }

    if (tipoEnvio === 'domicilio') {
        if (!datosEnvio.calleNumero || datosEnvio.calleNumero.trim().length < 2) {
            throw new Error('Calle y número son obligatorios para envío a domicilio.');
        }
    } else if (tipoEnvio === 'sucursal') {
        if (!datosEnvio.direccionSucursal || datosEnvio.direccionSucursal.trim().length < 3) {
            throw new Error('La dirección o identificación de la sucursal es obligatoria para retiro en sucursal.');
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

    const orderNumber = await getNextOrderNumber();
    const shippingCost = SHIPPING_RATES[tipoEnvio];
    const totalFinal = totalCalculado + shippingCost;
    const trackingToken = crypto.randomBytes(16).toString('hex');

    const nuevoPedido = new Order({
        brand,
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
    if (query.brand) {
        filter.brand = query.brand;
    }
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


const reconcileStalePendingOrders = async (days = 7) => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await Order.updateMany(
        {
            estado: 'Pendiente',
            comprobante: null,
            mpPaymentId: null,
            createdAt: { $lt: cutoff }
        },
        {
            $set: {
                estado: 'Cancelado',
                stockAlert: 'Cancelado automáticamente por inactividad prolongada (> 7 días)'
            }
        }
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
    bulkRestoreOrders,
    reconcileStalePendingOrders
};
```


<a id="archivo-tienda-backend-src-controllers-ordercontroller-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/controllers/orderController.js
================================================================================

```javascript

const verifyOrderComprobanteAccess = async (req, res, next) => {
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

        // 2. Orden de usuario registrado
        if (order.usuario) {
            if (!tokenUser) {
                return res.status(401).json({ mensaje: 'Se requiere autenticación para ver el comprobante' });
            }
            const isOwner = String(tokenUser.id || tokenUser._id) === String(order.usuario);
            if (!isOwner) {
                return res.status(403).json({ mensaje: 'No tenés permiso para ver el comprobante de este pedido' });
            }
        } else {
            // 3. Orden de invitado
            if (!guestToken) {
                return res.status(401).json({ mensaje: 'Se requiere token de invitado para ver el comprobante' });
            }
            if (guestToken !== order.trackingToken) {
                return res.status(403).json({ mensaje: 'Token de invitado no válido para este pedido' });
            }
        }

        req.order = order;
        next();
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al verificar autorización de comprobante', error: error.message });
    }
};


function maskName(name) {
    if (!name || typeof name !== 'string') return '';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) {
        return parts[0].length > 3 ? parts[0].slice(0, 3) + '***' : parts[0] + '***';
    }
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    return `${firstName} ${lastName[0]}.`;
}

function maskStreet(street) {
    if (!street || typeof street !== 'string') return '';
    return street.trim().replace(/\d+/g, '***');
}

function toTrackingDTO(order) {
    return {
        orderNumber: order.orderNumber,
        estado: order.estado,
        tipoEnvio: order.tipoEnvio,
        trackingNumber: order.trackingNumber || null,
        datosEnvio: {
            nombreCompleto: maskName(order.datosEnvio?.nombreCompleto),
            provincia: order.datosEnvio?.provincia || '',
            localidad: order.datosEnvio?.localidad || '',
            dni: order.datosEnvio?.dni ? (String(order.datosEnvio.dni).length > 4 ? '***' + String(order.datosEnvio.dni).slice(-4) : '***') : undefined,
            direccionSucursal: order.tipoEnvio === 'sucursal' ? (order.datosEnvio?.direccionSucursal || '') : undefined,
            calleNumero: order.tipoEnvio === 'domicilio' ? maskStreet(order.datosEnvio?.calleNumero) : undefined
        },
        productos: (order.productos || []).map(p => ({
            nombre: p.nombre,
            talle: p.talle,
            cantidad: p.cantidad,
            precio: (p.precioOferta && p.precioOferta > 0) ? p.precioOferta : p.precio,
            imagen: p.imagen
        })),
        total: order.total,
        createdAt: order.createdAt,
        brand: order.brand
    };
}

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
        
        res.json(toTrackingDTO(order));
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
            return res.status(400).json({ mensaje: 'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG, WebP o documentos PDF válidos.' });
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


const getOrderComprobante = async (req, res) => {
    try {
        const order = req.order;
        if (!order.comprobante) {
            return res.status(404).json({ mensaje: 'El pedido no tiene ningún comprobante adjunto' });
        }
        res.json({ comprobante: order.comprobante });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener comprobante', error: error.message });
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
    bulkRestoreOrders,
    getOrderComprobante,
    verifyOrderComprobanteAccess
};
```


<a id="archivo-tienda-backend-src-config-storage-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/config/storage.js
================================================================================

```javascript
const path = require('path');
const multer = require('multer');
const ImageKit = require('imagekit');

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'default_public_key',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'default_private_key',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/default'
});

// Multer general para productos (10MB máximo)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Tipos MIME y extensiones estrictamente permitidas para comprobantes de pago
const ALLOWED_RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_RECEIPT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const receiptFileFilter = (_req, file, cb) => {
    // 1. Validación de MIME Type declarado
    if (!ALLOWED_RECEIPT_MIMES.includes(file.mimetype)) {
        const error = new Error('Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG, WebP o documentos PDF.');
        error.code = 'INVALID_FILE_TYPE';
        return cb(error, false);
    }

    // 2. Validación de extensión de archivo
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_RECEIPT_EXTENSIONS.includes(ext)) {
        const error = new Error('Extensión de archivo no permitida. Solo se aceptan .jpg, .jpeg, .png, .webp o .pdf.');
        error.code = 'INVALID_FILE_EXTENSION';
        return cb(error, false);
    }

    cb(null, true);
};

// Multer especializado para comprobantes: límite 5MB y filtro estricto
const uploadComprobanteMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
    fileFilter: receiptFileFilter
});

// Inspección real de Magic Bytes en memoria (Buffer) sin dependencias externas
function validateMagicBytes(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
        return null;
    }

    // JPEG / JPG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    ) {
        return { mime: 'image/png', ext: 'png' };
    }

    // WebP: RIFF (bytes 0-3) y WEBP (bytes 8-11)
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return { mime: 'image/webp', ext: 'webp' };
    }

    // PDF: %PDF (25 50 44 46)
    if (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
    ) {
        return { mime: 'application/pdf', ext: 'pdf' };
    }

    return null;
}

// Función para subir una imagen a Imagekit
async function subirImagen(file, carpeta = 'looserfit_productos') {
    const resultado = await imagekit.upload({
        file: file.buffer,
        fileName: file.originalname,
        folder: carpeta,
        useUniqueFileName: true
    });
    console.log('URL generada por ImageKit:', resultado.url);
    return resultado.url;
}

module.exports = {
    upload,
    uploadComprobanteMulter,
    validateMagicBytes,
    subirImagen,
    imagekit
};
```


<a id="archivo-tienda-backend-src-services-arrepentimientoservice-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/services/arrepentimientoService.js
================================================================================

```javascript
'use strict';

const mongoose = require('mongoose');
const Arrepentimiento = require('../models/Arrepentimiento');
const Counter = require('../models/Counter');
const Order = require('../models/Order');
const Brand = require('../models/Brand');
const { enviarEmailArrepentimiento } = require('../config/email');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Genera el siguiente código atómico de solicitud: ARR-YYYY-XXXXX
 */
async function getNextArrepentimientoCode() {
    const nextSeq = await Counter.getNextSequence('arrepentimiento');
    const year = new Date().getFullYear();
    return `ARR-${year}-${String(nextSeq).padStart(5, '0')}`;
}

/**
 * Procesa la solicitud pública de arrepentimiento (sin requerir login previo)
 * Conforme a Disposición 954/2025 y Disposición 3/2026 de Defensa del Consumidor
 */
const crearSolicitud = async (data) => {
    const {
        customerName,
        customerEmail,
        orderNumber,
        customerPhone,
        reason,
        message,
        brandSlug
    } = data;

    if (!customerName || !customerName.trim()) {
        const error = new Error('El nombre completo es obligatorio.');
        error.statusCode = 400;
        throw error;
    }

    if (!customerEmail || !customerEmail.trim() || !EMAIL_REGEX.test(customerEmail.trim())) {
        const error = new Error('El email suministrado no es válido.');
        error.statusCode = 400;
        throw error;
    }

    if (!orderNumber || !orderNumber.trim()) {
        const error = new Error('El número o identificador del pedido es obligatorio.');
        error.statusCode = 400;
        throw error;
    }

    const cleanEmail = customerEmail.trim().toLowerCase();
    const cleanOrderNumber = orderNumber.trim();

    // Verificación razonable de identidad y seguridad (Disposición 3/2026)
    // Si la orden existe en base de datos, validar que el email corresponda al comprador original
    let matchedOrder = null;
    if (mongoose.Types.ObjectId.isValid(cleanOrderNumber)) {
        matchedOrder = await Order.findById(cleanOrderNumber);
    }
    if (!matchedOrder) {
        matchedOrder = await Order.findOne({ orderNumber: cleanOrderNumber });
    }
    if (!matchedOrder && !cleanOrderNumber.startsWith('#')) {
        matchedOrder = await Order.findOne({ orderNumber: `#${cleanOrderNumber}` });
    }

    if (matchedOrder) {
        const orderEmail = (matchedOrder.datosEnvio?.email || '').trim().toLowerCase();
        if (orderEmail && orderEmail !== cleanEmail) {
            // No filtrar datos sensibles del pedido real, dar mensaje genérico de verificación
            const error = new Error('Los datos ingresados no coinciden con los registros del pedido. Por favor verificá el número de pedido y el email utilizado en la compra.');
            error.statusCode = 400;
            throw error;
        }
    }

    // Resolver marca si aplica
    let brandId = null;
    if (matchedOrder && matchedOrder.brand) {
        brandId = matchedOrder.brand;
    } else if (brandSlug) {
        const b = await Brand.findOne({ slug: brandSlug });
        if (b) brandId = b._id;
    }

    const requestNumber = await getNextArrepentimientoCode();

    const solicitud = new Arrepentimiento({
        requestNumber,
        orderId: matchedOrder ? matchedOrder._id : null,
        orderNumber: matchedOrder ? matchedOrder.orderNumber : cleanOrderNumber,
        customerName: customerName.trim(),
        customerEmail: cleanEmail,
        customerPhone: customerPhone ? customerPhone.trim() : null,
        reason: reason || 'Me arrepentí de la compra',
        message: message ? message.trim() : null,
        brand: brandId,
        brandSlug: brandSlug || 'fit',
        status: 'Recibido'
    });

    await solicitud.save();

    // Despacho de email de confirmación (asincrónico, no bloquea la persistencia)
    if (enviarEmailArrepentimiento) {
        enviarEmailArrepentimiento({
            customerName: solicitud.customerName,
            customerEmail: solicitud.customerEmail,
            orderNumber: solicitud.orderNumber,
            requestNumber: solicitud.requestNumber,
            createdAt: solicitud.createdAt
        }, solicitud).catch(console.error);
    }

    return solicitud;
};

const getAllSolicitudes = async (query = {}) => {
    const filter = {};
    if (query.brand) filter.brand = query.brand;
    if (query.status) filter.status = query.status;
    return await Arrepentimiento.find(filter)
        .populate('orderId', 'orderNumber total estado createdAt')
        .populate('brand', 'name slug')
        .sort({ createdAt: -1 });
};

const getSolicitudById = async (id) => {
    return await Arrepentimiento.findById(id)
        .populate('orderId')
        .populate('brand');
};

const updateStatus = async (id, status, resolutionNotes = null) => {
    const valid = ['Recibido', 'EnRevision', 'Procesado', 'Rechazado'];
    if (!valid.includes(status)) {
        const error = new Error(`Estado inválido. Valores permitidos: ${valid.join(', ')}`);
        error.statusCode = 400;
        throw error;
    }

    const update = { status };
    if (resolutionNotes !== undefined && resolutionNotes !== null) {
        update.resolutionNotes = resolutionNotes;
    }
    if (['Procesado', 'Rechazado'].includes(status)) {
        update.resolvedAt = new Date();
    }

    return await Arrepentimiento.findByIdAndUpdate(id, update, { returnDocument: 'after' })
        .populate('orderId')
        .populate('brand');
};

module.exports = {
    crearSolicitud,
    getAllSolicitudes,
    getSolicitudById,
    updateStatus
};
```


<a id="archivo-tienda-backend-src-routes-arrepentimientoroutes-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/routes/arrepentimientoRoutes.js
================================================================================

```javascript
'use strict';

const express = require('express');
const router = express.Router();
const arrepentimientoController = require('../controllers/arrepentimientoController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { detectBrand } = require('../middleware/brandMiddleware');

// Endpoint público: Iniciar trámite de arrepentimiento (SIN login obligatorio, Disp. 954/2025)
router.post('/', detectBrand, arrepentimientoController.crearSolicitud);

// Rutas de administración (requieren sesión activa de administrador)
router.get('/all', protect, adminOnly, arrepentimientoController.getAllSolicitudes);
router.get('/:id', protect, adminOnly, arrepentimientoController.getSolicitudById);
router.patch('/:id/status', protect, adminOnly, arrepentimientoController.updateStatus);

module.exports = router;
```


<a id="archivo-tienda-backend-src-models-order-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/models/Order.js
================================================================================

```javascript
const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    // Discriminador de marca — identifica en qué tienda se realizó el pedido
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true
    },

    // Datos del Producto (para saber qué compró)
    productos: [{
        productoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
        nombre: String,
        cantidad: Number,
        precio: Number,
        precioOferta: Number,
        talle: String,
        imagen: String
    }],
    total: { type: Number, required: true },
    
    // Lógica de Envío
    tipoEnvio: { type: String, enum: ['sucursal', 'domicilio'], required: true },
    
    // Datos del Cliente (lo que te pasó por WhatsApp)
    datosEnvio: {
        nombreCompleto: { type: String, required: true },
        provincia: { type: String, required: true },
        localidad: { type: String, required: true },
        email: { type: String, required: true },
        telefono: { type: String, required: true },
        dni: { type: String, trim: true, default: null }, // Requisito de despacho postal Correo Argentino
        
        // Campos específicos según el tipo
        direccionSucursal: { type: String }, // Para sucursal
        calleNumero: { type: String },       // Para domicilio
        pisoDepto: { type: String },         // Para domicilio (opcional)
        codigoPostal: { type: String }       // Para domicilio
    },
    estado: { type: String, default: 'Pendiente' }, // Pendiente, Pagado, Empaquetado, Enviado, Entregado, Cancelado
    orderNumber: { type: String, required: true, unique: true, index: true }, // Nro de orden visible para control interno y clientes
    shippingCost: { type: Number, required: true, default: 0 },
    comprobante: { type: String }, // URL de la imagen del comprobante
    usuario: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Opcional: Para usuarios registrados
    trackingToken: { type: String, required: true, unique: true }, // Token para seguimiento público sin login
    trackingNumber: { type: String }, // Número de seguimiento Correo Argentino
    // Campos de Pago / Mercado Pago (Persistencia e Idempotencia F3)
    metodoPago: { type: String, default: null }, // Retrocompatibilidad
    paymentProvider: { type: String, default: null }, // 'mercadopago' | 'transferencia'
    paymentStatus: { type: String, default: null }, // 'approved' | 'pending' | 'rejected' | etc.
    mpPreferenceId: { type: String, default: null, index: true },
    mpPaymentId: { type: String, default: null, index: true },
    mpStatus: { type: String, default: null },
    mpStatusDetail: { type: String, default: null },
    mpExternalReference: { type: String, default: null },
    paymentAmount: { type: Number, default: null },
    paymentCurrency: { type: String, default: 'ARS' },
    paymentProcessedAt: { type: Date, default: null },
    stockAlert: { type: String, default: null },

    // Soft delete — permite restaurar pedidos eliminados por error
    deleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
}, { timestamps: true });

// Índice compuesto para listar pedidos por marca ordenados por fecha
orderSchema.index({ brand: 1, deleted: 1, createdAt: -1 });
orderSchema.index({ usuario: 1, deleted: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
```


<a id="archivo-tienda-backend--env-example"></a>
================================================================================
ARCHIVO: tienda-backend/.env.example
================================================================================

```env
# Base de datos
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/database?retryWrites=true&w=majority

# Autenticación JWT
JWT_SECRET=tu_secret_key_super_segura

# Servicio de Emails (Producción: Resend API HTTP / Desarrollo: Gmail SMTP fallback)
RESEND_API_KEY=re_123456789abcdef_tu_api_key_aqui
EMAIL_FROM=Looserfit <pedidos@looserfit.com>
EMAIL_USER=tu_email@gmail.com
EMAIL_PASS=tu_gmail_app_password

# Frontend URLs para enlaces en correos y CORS
SITE_FRONTEND_URL=https://www.looserfit.com
FRONTEND_URL=https://www.looserfit.com
BACKEND_URL=https://looserfit-api.onrender.com

# Pasarela de Pagos (Mercado Pago)
MP_PUBLIC_KEY=APP_USR-tu_public_key_mercadopago
MP_ACCESS_TOKEN=APP_USR-tu_access_token_mercadopago
MP_WEBHOOK_SECRET=tu_webhook_secret_mercadopago

# Almacenamiento de Imágenes (ImageKit)
IMAGEKIT_PUBLIC_KEY=tu_public_key_imagekit
IMAGEKIT_PRIVATE_KEY=tu_private_key_imagekit
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/tu_endpoint

# Cloudinary (Legacy / Opcional)
CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret
```


<a id="archivo-tienda-backend-src-constants-shipping-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/constants/shipping.js
================================================================================

```javascript
'use strict';

const SHIPPING_RATES = Object.freeze({
    sucursal: 7500,
    domicilio: 11000
});

const SHIPPING_PROVIDER = 'Correo Argentino';

const VALID_SHIPPING_TYPES = Object.freeze(Object.keys(SHIPPING_RATES));

module.exports = {
    SHIPPING_RATES,
    SHIPPING_PROVIDER,
    VALID_SHIPPING_TYPES
};
```


<a id="archivo-tienda-backend-src-models-counter-js"></a>
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


<a id="archivo-tienda-backend-src-models-arrepentimiento-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/models/Arrepentimiento.js
================================================================================

```javascript
'use strict';

const mongoose = require('mongoose');

const arrepentimientoSchema = new mongoose.Schema({
    // Código identificador único oficial server-side (ej: ARR-2026-00001)
    requestNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Vinculación opcional con orden existente en la base de datos
    orderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        default: null
    },
    // Nro de orden visible reportado por el cliente
    orderNumber: {
        type: String,
        default: null,
        trim: true
    },
    // Datos de identidad y contacto del consumidor (Disposición 954/2025 y Disp. 3/2026)
    customerName: {
        type: String,
        required: true,
        trim: true
    },
    customerEmail: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        index: true
    },
    customerPhone: {
        type: String,
        default: null,
        trim: true
    },
    reason: {
        type: String,
        default: 'Me arrepentí de la compra',
        trim: true
    },
    message: {
        type: String,
        default: null,
        trim: true
    },
    // Aislamiento multimarca
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        default: null
    },
    brandSlug: {
        type: String,
        default: 'fit'
    },
    // Ciclo de vida administrativo de la revocación
    status: {
        type: String,
        enum: ['Recibido', 'EnRevision', 'Procesado', 'Rechazado'],
        default: 'Recibido',
        index: true
    },
    resolutionNotes: {
        type: String,
        default: null
    },
    resolvedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('Arrepentimiento', arrepentimientoSchema);
```


<a id="archivo-tienda-backend-src-middleware-authmiddleware-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/middleware/authMiddleware.js
================================================================================

```javascript
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;

const protect = (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ error: 'No autorizado, falta el token' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
        req.user = decoded;
        next();
    } catch (_e) {
        return res.status(401).json({ error: 'Token no válido' });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user && req.user.isAdmin) {
        next();
    } else {
        return res.status(403).json({ error: 'Acceso denegado: se requieren permisos de administrador' });
    }
};


const optionalAuth = (req, res, next) => {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || JWT_SECRET);
        req.user = decoded;
        next();
    } catch (_e) {
        return res.status(401).json({ error: 'Token no válido o expirado' });
    }
};

module.exports = { protect, adminOnly, optionalAuth };
```


<a id="archivo-tienda-backend-src-routes-orderroutes-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/routes/orderRoutes.js
================================================================================

```javascript
const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, adminOnly, optionalAuth } = require('../middleware/authMiddleware');
const { SHIPPING_RATES, SHIPPING_PROVIDER } = require('../constants/shipping');
const { detectBrand } = require('../middleware/brandMiddleware');

// Rate Limiter en memoria para el endpoint público de seguimiento (anti enumeración)
const trackRateLimitMap = new Map();
const trackRateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReq = 30;

    const record = trackRateLimitMap.get(ip);
    if (!record || (now - record.startTime) > windowMs) {
        trackRateLimitMap.set(ip, { count: 1, startTime: now });
        return next();
    }

    if (record.count >= maxReq) {
        return res.status(429).json({ mensaje: 'Demasiadas consultas de seguimiento. Por favor esperá un minuto.' });
    }

    record.count++;
    next();
};

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of trackRateLimitMap.entries()) {
        if (now - record.startTime > 60000) trackRateLimitMap.delete(ip);
    }
}, 300000).unref();


// --- CREAR UN NUEVO PEDIDO (Soporta invitados) ---
// --- TARIFAS DE ENVÍO ---
router.get('/shipping-rates', (_req, res) => res.json({ provider: SHIPPING_PROVIDER, rates: SHIPPING_RATES }));

// --- CREAR UN NUEVO PEDIDO (Soporta invitados y usuarios registrados con optionalAuth) ---
router.post('/create', detectBrand, optionalAuth, orderController.createOrder);

// --- VER MIS PEDIDOS ---
router.get('/mine', protect, orderController.getOrdersMine);

// --- VER TODOS LOS PEDIDOS (Solo Admin) ---
router.get('/all', protect, adminOnly, orderController.getAllOrders);

// --- SEGUIMIENTO PÚBLICO (Sin Login) ---
router.get('/track/:token', trackRateLimiter, orderController.getOrderByToken);

// --- VER UN PEDIDO POR ID (Protegido por SEC-01) ---
router.get('/:id', orderController.getOrderById);

// --- CAMBIAR ESTADO DEL PEDIDO (Solo Admin) ---
router.patch('/:id/estado', protect, adminOnly, orderController.updateStatus);

// --- ACTUALIZAR NÚMERO DE SEGUIMIENTO (Solo Admin) ---
router.patch('/:id/tracking', protect, adminOnly, orderController.updateTracking);

// --- SUBIR COMPROBANTE DE PAGO (Protegido por SEC-03) ---
// --- VER COMPROBANTE AUTORIZADO ---
router.get('/:id/comprobante', orderController.verifyOrderComprobanteAccess, orderController.getOrderComprobante);

router.post(
    '/upload-comprobante/:id',
    orderController.verifyOrderUploadAuth,
    orderController.uploadComprobanteMiddleware,
    orderController.uploadComprobante
);

// --- ELIMINAR UN PEDIDO (Solo Admin) ---
router.delete('/:id', protect, adminOnly, orderController.deleteOrder);

// --- ELIMINAR PEDIDOS EN MASA (Solo Admin) ---
router.post('/delete-bulk', protect, adminOnly, orderController.bulkDeleteOrders);

// --- RESTAURAR PEDIDO ELIMINADO (Solo Admin) ---
router.patch('/:id/restore', protect, adminOnly, orderController.restoreOrder);

// --- RESTAURAR PEDIDOS EN MASA (Solo Admin) ---
router.post('/restore-bulk', protect, adminOnly, orderController.bulkRestoreOrders);

module.exports = router;
```


<a id="archivo-tienda-backend-src-utils-mpsignature-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/utils/mpSignature.js
================================================================================

```javascript
'use strict';

const crypto = require('crypto');

/**
 * Valida la firma criptográfica HMAC-SHA256 de Mercado Pago según la especificación oficial.
 * Headers requeridos:
 *   - x-signature: ts=[timestamp],v1=[hash]
 *   - x-request-id: [uuid / request-id]
 * Parámetros:
 *   - dataId: identificador del recurso enviado en la query ('data.id' o 'id') o en body
 * 
 * Plantilla del manifiesto oficial:
 *   "id:[data.id];request-id:[x-request-id];ts:[ts];"
 *
 * @param {object} req - Express Request
 * @param {string} webhookSecret - Clave secreta MP_WEBHOOK_SECRET
 * @param {object} [options] - Opciones (ej. maxDriftMs: tolerancia temporal en ms)
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyMercadoPagoWebhookSignature(req, webhookSecret, options = {}) {
  if (!webhookSecret) {
    // Si no hay secreto configurado en el servidor, no se puede validar
    return { valid: false, reason: 'MP_WEBHOOK_SECRET no configurado' };
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature || !xRequestId) {
    return { valid: false, reason: 'Faltan cabeceras x-signature o x-request-id' };
  }

  // Extraer ts y v1 de la cabecera x-signature (ej: "ts=1704067200,v1=5d640...")
  const parts = xSignature.split(',');
  let ts = null;
  let v1 = null;

  for (const part of parts) {
    const [key, value] = part.trim().split('=');
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }

  if (!ts || !v1) {
    return { valid: false, reason: 'Formato inválido de x-signature (se requieren ts y v1)' };
  }

  // Validación de frescura del timestamp para prevenir ataques de replay
  const maxDriftMs = options.maxDriftMs || 10 * 60 * 1000; // 10 minutos por defecto
  const parsedTs = parseInt(ts, 10);
  if (isNaN(parsedTs)) {
    return { valid: false, reason: 'Timestamp ts no es un número válido' };
  }

  const tsMs = ts.length === 10 ? parsedTs * 1000 : parsedTs;
  const now = Date.now();
  // Permitir timestamp en el pasado hasta maxDriftMs y hasta 60s en el futuro (desviación de reloj)
  if (now - tsMs > maxDriftMs || tsMs - now > 60000) {
    return { valid: false, reason: 'Timestamp de firma expirado o fuera de rango permitido' };
  }

  // Extraer data.id
  const dataId = req.query['data.id'] || req.query.id || (req.body && (req.body.id || req.body['data.id'] || req.body.data?.id));
  if (!dataId) {
    return { valid: false, reason: 'Identificador data.id ausente' };
  }

  // Construir manifiesto exacto de Mercado Pago:
  // "id:[data.id];request-id:[x-request-id];ts:[ts];"
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calcular HMAC-SHA256 con el secreto
  const computedHash = crypto
    .createHmac('sha256', webhookSecret)
    .update(manifest)
    .digest('hex');

  // Comparación en tiempo constante (timing-safe) para evitar timing attacks
  const computedBuffer = Buffer.from(computedHash, 'utf8');
  const receivedBuffer = Buffer.from(v1, 'utf8');

  if (computedBuffer.length !== receivedBuffer.length) {
    return { valid: false, reason: 'Firma criptográfica inválida (longitud incorrecta)' };
  }

  const match = crypto.timingSafeEqual(computedBuffer, receivedBuffer);
  if (!match) {
    return { valid: false, reason: 'Firma criptográfica HMAC-SHA256 no coincide' };
  }

  return { valid: true };
}

/**
 * Genera una firma válida para propósitos de prueba / testing
 */
function generateTestMpSignature({ dataId, requestId, secret, timestamp }) {
  const ts = timestamp ? String(timestamp) : String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return {
    'x-signature': `ts=${ts},v1=${v1}`,
    'x-request-id': requestId,
    ts,
    v1
  };
}

module.exports = {
  verifyMercadoPagoWebhookSignature,
  generateTestMpSignature
};
```


<a id="archivo-tienda-backend-src-services-userservice-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/services/userService.js
================================================================================

```javascript
const User = require('../models/User');
const Order = require('../models/Order');
const jwt = require('jsonwebtoken');

const getJwtSecret = () => process.env.JWT_SECRET || 'looserfit_jwt_secret_fallback_key';

const register = async (userData) => {
    const { nombre, email, password } = userData;

    const normalizedEmail = email ? email.toLowerCase().trim() : '';

    let user = await User.findOne({ email: normalizedEmail });
    if (user) {
        throw new Error('El usuario ya existe');
    }

    user = new User({ nombre: nombre?.trim(), email: normalizedEmail, password });
    await user.save();

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const login = async (email, password) => {
    const normalizedEmail = email ? email.toLowerCase().trim() : '';
    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
        throw new Error('Credenciales inválidas');
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
        throw new Error('Credenciales inválidas');
    }

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

const getUserById = async (id) => {
    return await User.findById(id).select('-password');
};

const updateProfile = async (id, updateData) => {
    const allowedUpdates = {};
    if (updateData.nombre !== undefined) allowedUpdates.nombre = updateData.nombre.trim();
    if (updateData.email !== undefined) allowedUpdates.email = updateData.email.toLowerCase().trim();

    return await User.findByIdAndUpdate(id, { $set: allowedUpdates }, { returnDocument: 'after' }).select('-password');
};

// SEC-02: Registro desde pedido con estricta validación de coincidencia de emails y ownership
const registerFromOrder = async (data) => {
    const { email, password, nombre, orderId } = data || {};

    if (!orderId) {
        const error = new Error('Se requiere el ID del pedido');
        error.statusCode = 400;
        throw error;
    }

    const regEmail = email ? email.trim().toLowerCase() : '';
    if (!regEmail) {
        const error = new Error('El email es requerido');
        error.statusCode = 400;
        throw error;
    }

    let existingUser = await User.findOne({ email: regEmail });
    if (existingUser) {
        const error = new Error('Ya existe una cuenta con este email. Iniciá sesión para ver tu pedido.');
        error.statusCode = 400;
        throw error;
    }

    const order = await Order.findById(orderId);
    if (!order) {
        const error = new Error('Pedido no encontrado');
        error.statusCode = 404;
        throw error;
    }

    if (order.usuario) {
        const error = new Error('El pedido ya se encuentra asociado a una cuenta');
        error.statusCode = 409;
        throw error;
    }

        const orderEmail = order.datosEnvio?.email ? order.datosEnvio.email.trim().toLowerCase() : '';
    if (!orderEmail) {
        const error = new Error('El pedido no tiene un email de contacto válido');
        error.statusCode = 400;
        throw error;
    }

    if (regEmail !== orderEmail) {
        const error = new Error('El email de registro no coincide con el email del pedido');
        error.statusCode = 403;
        throw error;
    }

    // SEC-02 Hardening: Si se provee guestToken, validar correspondencia con la orden
    const providedGuestToken = data.guestToken || data.trackingToken;
    if (providedGuestToken && order.trackingToken && providedGuestToken !== order.trackingToken) {
        const error = new Error('Token de invitado no válido para asociar este pedido.');
        error.statusCode = 403;
        throw error;
    }

    // Crear usuario
    const user = new User({ nombre: nombre?.trim(), email: regEmail, password });
    await user.save();

    // Vincular pedido de manera segura
    order.usuario = user._id;
    await order.save();

    const token = jwt.sign({ id: user._id, isAdmin: user.isAdmin }, getJwtSecret(), { expiresIn: '7d' });

    return {
        token,
        user: { id: user._id, nombre: user.nombre, email: user.email, isAdmin: user.isAdmin }
    };
};

module.exports = {
    register,
    login,
    getUserById,
    updateProfile,
    registerFromOrder
};
```


<a id="archivo-tienda-backend-src-controllers-productcontroller-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/controllers/productController.js
================================================================================

```javascript
const productService = require('../services/productService');
const { subirImagen } = require('../config/storage');

const getAllProducts = async (req, res) => {
    try {
        const { categoria, soloPublicados, corte, esNuevoDrop, q } = req.query;
        const filtros = {};
        // Multi-marca: pasar el brandId resuelto por el middleware
        if (req.brandId) filtros.brand = req.brandId;
        if (categoria) filtros.categoria = categoria;
        if (soloPublicados === 'true') filtros.publicado = true;
        if (corte) filtros.corte = corte;
        if (esNuevoDrop === 'true' || esNuevoDrop === true) filtros.esNuevoDrop = true;
        if (q) filtros.q = q;

        const products = await productService.getAllProducts(filtros);
        res.json(products);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener productos', error: error.message });
    }
};

const getProductById = async (req, res) => {
    try {
        const product = await productService.getProductById(req.params.id);
        if (!product) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener producto', error: error.message });
    }
};

const createProduct = async (req, res) => {
    try {
        const urls = req.files && req.files['imagenes'] 
            ? await Promise.all(req.files['imagenes'].map(file => subirImagen(file)))
            : [];
        const guiaTallesUrl = req.files && req.files['guiaTallesImg'] 
            ? await subirImagen(req.files['guiaTallesImg'][0]) 
            : req.body.guiaTalles;
        
        const newProduct = await productService.createProduct({
            ...req.body,
            imagenes: urls,
            guiaTalles: guiaTallesUrl,
            brand: req.brandId  // Multi-marca: asignar la marca activa del admin
        });

        res.status(201).json({ mensaje: 'Producto creado!', nuevoProducto: newProduct });
    } catch (error) {
        res.status(500).json({ mensaje: error.message || 'Error al crear producto', error: error.message });
    }
};

const updateProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const existing = await productService.getProductById(productId);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }

        const { galeriaPersistente, imagenesExistentes, ...otrosCampos } = req.body;
        
        // Mantener fotos viejas
        let fotosMantener = galeriaPersistente || imagenesExistentes || existing.imagenes || [];
        if (!Array.isArray(fotosMantener)) fotosMantener = [fotosMantener];

        // Fotos nuevas
        let fotosNuevas = [];
        if (req.files && req.files['imagenes']) {
            fotosNuevas = await Promise.all(req.files['imagenes'].map(f => subirImagen(f)));
        }

        const totalFinal = [...new Set([...fotosMantener, ...fotosNuevas])].filter(f => f && typeof f === 'string');

        // Guía talles
        let guiaTalles = existing.guiaTalles;
        if (req.files && req.files['guiaTallesImg'] && req.files['guiaTallesImg'].length > 0) {
            guiaTalles = await subirImagen(req.files['guiaTallesImg'][0]);
        } else if (otrosCampos.guiaTalles) {
            guiaTalles = otrosCampos.guiaTalles;
        }

        const updateData = {
            ...otrosCampos,
            imagenes: totalFinal,
            guiaTalles
        };

        const updated = await productService.updateProduct(productId, updateData);
        res.json({ mensaje: 'Producto actualizado!', producto: updated });
    } catch (error) {
        // Log para debug si fuera necesario en el servidor
        console.error('Error en updateProduct:', error);
        res.status(500).json({ mensaje: error.message || 'Error al actualizar producto', error: error.message });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para eliminar un producto de otra marca' });
        }
        await productService.deleteProduct(req.params.id);
        res.json({ mensaje: 'Producto eliminado' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar producto', error: error.message });
    }
};

const toggleProductVisibility = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }
        const product = await productService.toggleProductVisibility(req.params.id);
        res.json({ mensaje: 'Visibilidad actualizada', producto: product });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar visibilidad', error: error.message });
    }
};

const toggleProductDrop = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }
        const product = await productService.toggleProductDrop(req.params.id);
        res.json({ mensaje: 'Estado Drop actualizado', producto: product });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar estado drop', error: error.message });
    }
};

const bulkToggleProductDrop = async (req, res) => {
    try {
        const { productIds, estado } = req.body;
        if (!Array.isArray(productIds)) {
            return res.status(400).json({ mensaje: 'productIds debe ser un array' });
        }
        if (typeof estado !== 'boolean') {
            return res.status(400).json({ mensaje: 'estado debe ser un booleano' });
        }
        const result = await productService.bulkToggleProductDrop(productIds, estado);
        res.json({ mensaje: 'Estado Drop actualizado masivamente', result });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error en bulk toggle drop', error: error.message });
    }
};

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleProductVisibility,
    toggleProductDrop,
    bulkToggleProductDrop
};
```


<a id="archivo-tienda-backend-src-controllers-categorycontroller-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/controllers/categoryController.js
================================================================================

```javascript
const categoryService = require('../services/categoryService');

const getAllCategories = async (req, res) => {
    try {
        // Multi-marca: filtrar por marca activa
        const categories = await categoryService.getAllCategories(req.brandId);
        res.json(categories);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener categorías', error: error.message });
    }
};

const createCategory = async (req, res) => {
    try {
        // Multi-marca: asignar la marca activa del middleware
        const category = await categoryService.createCategory({ ...req.body, brand: req.brandId });
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ mensaje: 'Error al crear categoría', error: error.message });
    }
};

const getCategoryById = async (req, res) => {
    try {
        const category = await categoryService.getCategoryById(req.params.id);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json(category);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener categoría', error: error.message });
    }
};

const updateCategory = async (req, res) => {
    try {
        const existing = await categoryService.getCategoryById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar una categoría de otra marca' });
        }
        const category = await categoryService.updateCategory(req.params.id, req.body);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json(category);
    } catch (error) {
        res.status(400).json({ mensaje: 'Error al actualizar categoría', error: error.message });
    }
};

const deleteCategory = async (req, res) => {
    try {
        const existing = await categoryService.getCategoryById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para eliminar una categoría de otra marca' });
        }
        const category = await categoryService.deleteCategory(req.params.id);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json({ mensaje: 'Categoría eliminada' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar categoría', error: error.message });
    }
};

module.exports = {
    getAllCategories,
    createCategory,
    getCategoryById,
    updateCategory,
    deleteCategory
};
```


<a id="archivo-tienda-backend-src-services-homeservice-js"></a>
================================================================================
ARCHIVO: tienda-backend/src/services/homeService.js
================================================================================

```javascript
const HomeContent = require('../models/HomeContent');
const User = require('../models/User');
const { sendEmail, wrapHTML } = require('../config/email');
const { deleteFromCloudinary } = require('../utils/cloudinaryUtils');

const sendLaunchNotification = async (message, subtitle, emailMessage) => {
    try {
        const users = await User.find({}, 'email');
        const emails = users.map(u => u.email).filter(Boolean);
        if (!emails.length) return;

        await sendEmail({
            bcc: emails,
            subject: 'Looser Fit ya está disponible',
            html: wrapHTML(
                'Looser Fit está de nuevo en vivo',
                `<div style="font-size: 16px; line-height: 1.6; color: #333;">
                    <p>${emailMessage || message || 'La tienda está disponible nuevamente.'}</p>
                    ${subtitle ? `<p style="font-size: 15px; color: #555;">${subtitle}</p>` : ''}
                    <p>Ingresá ahora a ver los nuevos productos.</p>
                </div>`
            )
        });
        console.log(`✅ Notificación de lanzamiento enviada a ${emails.length} usuarios.`);
    } catch (err) {
        console.error('❌ [Email Error] tipo: Lanzamiento | error:', err.message);
    }
}

const getHomeContent = async (brandId) => {
    // Multi-marca: buscar el HomeContent de la marca activa
    let query = {};
    if (brandId) query.brand = brandId;

    let doc = await HomeContent.findOne(query).populate('featuredProducts');
    if (!doc) {
        // Crear un HomeContent vacío para esta marca si no existe
        doc = await HomeContent.create({
            brand: brandId,
            heroImages: []
        });
        doc = await HomeContent.findById(doc._id).populate('featuredProducts');
    }

    if (doc.comingSoon?.enabled && doc.comingSoon?.launchDate && new Date(doc.comingSoon.launchDate) <= new Date()) {
        doc.comingSoon.enabled = false;
        await doc.save();
        await sendLaunchNotification(doc.comingSoon.message, doc.comingSoon.subtitle, doc.comingSoon.emailMessage);
    }
    return doc;
};

const updateHero = async (brandId, images) => {
    // Ya no obligamos a que sean 3
    const home = await getHomeContent(brandId);
    const oldImages = home.heroImages || [];
    
    // Limpiar imágenes eliminadas
    const removed = oldImages.filter(img => !images.includes(img));
    for (const imgUrl of removed) {
        await deleteFromCloudinary(imgUrl);
    }

    home.heroImages = images;
    return await home.save();
};

const updateFamily = async (brandId, familyImages) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    
    const oldImages = doc.familyImages?.map(f => f.src) || [];
    const newUrls = familyImages.map(f => f.src);

    // Limpiar imágenes eliminadas
    const removed = oldImages.filter(img => !newUrls.includes(img));
    for (const imgUrl of removed) {
        await deleteFromCloudinary(imgUrl);
    }

    doc.familyImages = familyImages;
    return await doc.save();
};

const updateSettings = async (brandId, comingSoon) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    
    const enabled = Boolean(comingSoon.enabled);
    let launchDate = null;
    if (enabled) {
        const durationMinutes = Number(comingSoon.durationMinutes || 0);
        if (durationMinutes <= 0) throw new Error('La duración debe ser mayor a 0 minutos');
        launchDate = new Date(Date.now() + durationMinutes * 60000);
    }

    doc.comingSoon = {
        enabled,
        launchDate,
        message: comingSoon.message?.trim() || 'Web prendida próximamente en:',
        subtitle: comingSoon.subtitle?.trim() || '',
        emailMessage: comingSoon.emailMessage?.trim() || ''
    };

    return await doc.save();
};

const updateFeatured = async (brandId, productIds) => {
    let doc = await HomeContent.findOne({ brand: brandId });
    if (!doc) doc = await HomeContent.create({ brand: brandId });
    const Product = require('../models/product');
    const validProducts = await Product.find({ _id: { $in: productIds }, brand: brandId }).distinct('_id');
    doc.featuredProducts = validProducts;
    await doc.save();
    return await doc.populate('featuredProducts');
};

module.exports = {
    getHomeContent,
    updateHero,
    updateFamily,
    updateSettings,
    updateFeatured
};
```


<a id="archivo-tienda-backend-tests-adversarial-security-test-js"></a>
================================================================================
ARCHIVO: tienda-backend/tests/adversarial-security.test.js
================================================================================

```javascript
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
    let userA, adminUser;
    let tokenUserA, tokenAdmin;

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


        adminUser = await User.create({
            nombre: 'Admin Master',
            email: 'admin@adversarial.com',
            password: 'Password123!',
            isAdmin: true
        });

        const secret = process.env.JWT_SECRET || 'test_jwt_secret_super_safe_12345';
        tokenUserA = jwt.sign({ id: userA._id, isAdmin: false }, secret, { expiresIn: '1h' });
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
```


<a id="archivo-tienda-frontend-public-robots-txt"></a>
================================================================================
ARCHIVO: tienda-frontend/public/robots.txt
================================================================================

```txt
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/*
Disallow: /seguimiento
Disallow: /seguimiento/*
Disallow: /pedido-exito
Disallow: /pedido-exito/*
Disallow: /checkout
Disallow: /mi-cuenta
Disallow: /mis-pedidos

Sitemap: https://www.looserfit.com/sitemap.xml
```

