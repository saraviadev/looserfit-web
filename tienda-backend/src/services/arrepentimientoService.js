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

        // Validación estricta del plazo legal de 10 días corridos (Ley 24.240 Art. 34, Disp. 954/2025 y Disp. 3/2026)
        const orderDate = matchedOrder.createdAt ? new Date(matchedOrder.createdAt) : null;
        if (orderDate) {
            const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
            const elapsedMs = Date.now() - orderDate.getTime();
            if (elapsedMs > tenDaysMs) {
                const error = new Error('El plazo legal de 10 días corridos para ejercer el derecho de arrepentimiento ha expirado.');
                error.statusCode = 400;
                throw error;
            }
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
