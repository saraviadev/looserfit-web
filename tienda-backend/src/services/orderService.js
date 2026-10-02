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
    Cancelado: [],
    ConflictoStock: ['Pagado', 'Cancelado']
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
