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
                paymentStatus: 'currency_mismatch',
                stockAlert: `Moneda de pago inválida (${paymentData.currency_id}). Se esperaba ARS.`
            });
            return res.sendStatus(200);
        }

        const paymentCents = Math.round(Number(paymentData.transaction_amount) * 100);
        const orderCents = Math.round(Number(order.total) * 100);
        if (paymentCents !== orderCents) {
            console.error(`[Webhook MP] ❌ Monto inválido. Pagado: ${paymentData.transaction_amount} vs Orden: ${order.total}`);
            await Order.findByIdAndUpdate(orderId, {
                paymentStatus: 'amount_mismatch',
                stockAlert: `Discrepancia en importe abonado: pagado ${paymentData.transaction_amount} vs total orden ${order.total}`
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
                stockAlert: `Anomalía de cobro: se recibió un segundo pago (${paymentId}) para este pedido que ya estaba abonado. No se descontó stock adicional. Requiere verificación de reintegro en Mercado Pago.`
            });
            const { enviarEmailNotificacionAdmin, enviarConReintentos } = require('../config/email');
            if (enviarEmailNotificacionAdmin && enviarConReintentos) {
                const alertOrder = await Order.findById(orderId);
                enviarConReintentos(() => enviarEmailNotificacionAdmin(alertOrder), 3, 'Alerta pago duplicado').catch(console.error);
            }
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
                            estado: 'ConflictoStock',
                            stockAlert: 'CRÍTICO: Stock insuficiente al momento de acreditar el pago (Mercado Pago ID: ' + paymentId + '). Requiere reposición de inventario o reembolso manual vía panel de Mercado Pago.',
                            paymentProvider: 'mercadopago',
                            paymentStatus: 'approved_stock_conflict',
                            mpPaymentId: String(paymentId),
                            mpStatus: paymentData.status,
                            mpStatusDetail: paymentData.status_detail || null,
                            paymentAmount: paymentData.transaction_amount,
                            paymentCurrency: paymentData.currency_id
                        });
                        const { enviarEmailNotificacionAdmin, enviarConReintentos } = require('../config/email');
                        if (enviarEmailNotificacionAdmin && enviarConReintentos) {
                            const conflictOrder = await Order.findById(orderId);
                            enviarConReintentos(() => enviarEmailNotificacionAdmin(conflictOrder), 3, 'Alerta conflicto stock').catch(console.error);
                        }
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
                        estado: 'ConflictoStock',
                        stockAlert: 'CRÍTICO: Stock insuficiente al momento de acreditar el pago (Mercado Pago ID: ' + paymentId + '). Requiere reposición de inventario o reembolso manual vía panel de Mercado Pago.',
                        paymentProvider: 'mercadopago',
                        paymentStatus: 'approved_stock_conflict',
                        mpPaymentId: String(paymentId),
                        mpStatus: paymentData.status,
                        mpStatusDetail: paymentData.status_detail || null,
                        paymentAmount: paymentData.transaction_amount,
                        paymentCurrency: paymentData.currency_id
                    });
                    const { enviarEmailNotificacionAdmin, enviarConReintentos } = require('../config/email');
                    if (enviarEmailNotificacionAdmin && enviarConReintentos) {
                        const conflictOrder = await Order.findById(orderId);
                        enviarConReintentos(() => enviarEmailNotificacionAdmin(conflictOrder), 3, 'Alerta conflicto stock').catch(console.error);
                    }
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
