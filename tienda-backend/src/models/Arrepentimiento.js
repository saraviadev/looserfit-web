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
