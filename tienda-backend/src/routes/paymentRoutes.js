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

        console.log('Enviando body a Mercado Pago:', JSON.stringify(body, null, 2));

        const result = await preference.create({ body });

        res.json({ id: result.id, init_point: result.init_point });
    } catch (error) {
        console.error('Error al crear preferencia:', error);
        res.status(500).json({ mensaje: 'Error al crear la preferencia de pago', error: error.message });
    }
});

// Webhook para recibir notificaciones de Mercado Pago
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
                const pedido = await Order.findById(orderId);
                if (!pedido) {
                    console.error(`[Webhook MP] ❌ Orden ${orderId} no encontrada en la DB`);
                    return res.sendStatus(200);
                }

                if (pedido.estado !== 'Pagado') {
                    // --- DESCONTAR STOCK AL CONFIRMAR PAGO ---
                    for (const item of pedido.productos) {
                        const updated = await Product.findOneAndUpdate(
                            { _id: item.productoId, stock: { $gte: item.cantidad } },
                            { $inc: { stock: -item.cantidad } },
                            { new: true }
                        );
                        
                        if (!updated) {
                           console.error(`❌ [Webhook MP] Error critico: No hay stock suficiente para ${item.nombre} al confirmar pago de orden ${orderId}`);
                        }
                    }

                    const orderService = require('../services/orderService');
                    await orderService.updateOrderStatus(orderId, 'Pagado');
                    console.log(`✅ [Webhook MP] Pedido ${orderId} marcado como Pagado y stock descontado.`);
                } else {
                    console.log(`[Webhook MP] Pedido ${orderId} ya estaba en estado Pagado, ignorando duplicado.`);
                }
            } else if (['pending', 'in_process'].includes(paymentData.status)) {
                console.log(`⏳ [Webhook MP] Pedido ${orderId} está pendiente de acreditación (${paymentData.status_detail})`);
            } else {
                console.log(`❌ [Webhook MP] Pedido ${orderId} falló o fue rechazado: ${paymentData.status}`);
            }
        } else {
            // MP envía otros tipos de notificaciones (merchant_order, etc) que no necesitamos procesar
            console.log(`[Webhook MP] Notificación ignorada: topic=${topic}, id=${paymentId}`);
        }

        res.sendStatus(200);
    } catch (error) {
        console.error(`[Webhook MP] ❌ Error procesando webhook:`, error.message);
        // Devolver 500 para que Mercado Pago REINTENTE el webhook
        res.sendStatus(500);
    }
});

module.exports = router;
