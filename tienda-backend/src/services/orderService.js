const Order = require('../models/Order');
const Product = require('../models/product');
const crypto = require('crypto');
const { enviarEmailPedido, enviarEmailSeguimiento, enviarEmailNotificacionAdmin } = require('../config/email');
const { deleteFromCloudinary } = require('../utils/cloudinaryUtils');

// Helper: reintenta una función async hasta N veces con espera creciente
const enviarConReintentos = async (fn, maxIntentos, label = 'Email') => {
    for (let intento = 1; intento <= maxIntentos; intento++) {
        try {
            const result = await fn();
            if (result) return true;
            throw new Error('La función retornó false');
        } catch (err) {
            console.warn(`⚠️ [${label}] Intento ${intento}/${maxIntentos} falló: ${err.message}`);
            if (intento < maxIntentos) {
                const espera = intento * 5000; // 5s, 10s, 15s
                console.log(`   ↻ Reintentando en ${espera / 1000}s...`);
                await new Promise(r => setTimeout(r, espera));
            } else {
                console.error(`❌ [${label}] Todos los intentos fallaron.`);
            }
        }
    }
    return false;
};

const createOrder = async (orderData) => {
    const { productos = [], tipoEnvio, datosEnvio, usuario, brand } = orderData;
    
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

    let nextNum = (await Order.countDocuments()) + 1;
    let orderNumber = `#${String(nextNum).padStart(3, '0')}`;
    
    // Verificación de unicidad para evitar colisiones si se borraron pedidos
    while (await Order.findOne({ orderNumber })) {
        nextNum++;
        orderNumber = `#${String(nextNum).padStart(3, '0')}`;
    }
    const shippingCost = tipoEnvio === 'domicilio' ? 9500 : 7500;
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

const getAllOrders = async () => {
    return await Order.find().sort({ createdAt: -1 });
};

const getOrdersByUser = async (usuarioId) => {
    return await Order.find({ usuario: usuarioId }).sort({ createdAt: -1 });
};

const getOrderById = async (id) => {
    return await Order.findById(id);
};

const getOrderByToken = async (token) => {
    return await Order.findOne({ trackingToken: token });
};

const updateOrderStatus = async (id, estado) => {
    const pedido = await Order.findByIdAndUpdate(id, { estado }, { new: true });
    
    if (pedido) {
        const { datosEnvio } = pedido;
        if (estado === 'Empaquetado') {
            const { enviarEmailEmpaquetado } = require('../config/email');
            enviarEmailEmpaquetado(datosEnvio, pedido).catch(console.error);
        } else if (estado === 'Pagado') {
            const { enviarEmailPagoAprobado } = require('../config/email');
            enviarEmailPagoAprobado(datosEnvio, pedido).catch(console.error);
            // Notificar al admin con reintentos — si falla no se pierde la notificación
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

const deleteOrder = async (id) => {
    const pedido = await Order.findById(id);
    if (pedido && pedido.comprobante) {
        await deleteFromCloudinary(pedido.comprobante);
    }
    return await Order.findByIdAndDelete(id);
};

const bulkDeleteOrders = async (ids) => {
    const pedidos = await Order.find({ _id: { $in: ids } });
    for (const pedido of pedidos) {
        if (pedido.comprobante) {
            await deleteFromCloudinary(pedido.comprobante);
        }
    }
    return await Order.deleteMany({ _id: { $in: ids } });
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
    bulkDeleteOrders
};
