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

module.exports = mongoose.model('Order', orderSchema);