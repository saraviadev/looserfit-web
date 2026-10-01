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
