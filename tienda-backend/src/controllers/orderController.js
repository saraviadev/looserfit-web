const orderService = require('../services/orderService');
const { subirImagen } = require('../config/storage');

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
        const orders = await orderService.getAllOrders();
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

const getOrderById = async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        if (!order) return res.status(404).json({ mensaje: 'Pedido no encontrado' });
        
        // Extraer usuario del token si está presente
        let tokenUser = null;
        if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
            const token = req.headers.authorization.split(' ')[1];
            try {
                const jwt = require('jsonwebtoken');
                tokenUser = jwt.verify(token, process.env.JWT_SECRET);
            } catch (e) {
                // ignorar si el token es inválido aquí, manejamos el fallback
            }
        }

        // Si el pedido tiene un usuario registrado (no es invitado)
        if (order.usuario) {
            // Requiere que el usuario esté autenticado
            if (!tokenUser) {
                return res.status(401).json({ mensaje: 'Acceso no autorizado a este pedido' });
            }
            // Requiere que sea el dueño del pedido o un admin
            const isOwner = String(tokenUser.id || tokenUser._id) === String(order.usuario);
            if (!isOwner && !tokenUser.isAdmin) {
                return res.status(403).json({ mensaje: 'No tenés permiso para ver este pedido' });
            }
        } else {
            // Si el pedido es de invitado (usuario === null / undefined)
            // Permitimos acceso porque se necesita para ver el resumen y subir comprobante,
            // tanto para invitados sin token como para usuarios logueados que abren pedidos huérfanos.
        }

        res.json(order);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener pedido', error: error.message });
    }
};

const getOrderByToken = async (req, res) => {
    try {
        const order = await orderService.getOrderByToken(req.params.token);
        if (!order) return res.status(404).json({ mensaje: 'Link de seguimiento inválido o expirado' });
        res.json(order);
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

const uploadComprobante = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ mensaje: 'No se recibió el comprobante' });
        }
        const url = await subirImagen(req.file, 'looserfit_comprobantes');
        const order = await orderService.uploadComprobante(req.params.id, url);
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
            return res.status(400).json({ mensaje: 'No se enviaron IDs válidos' });
        }
        await orderService.bulkDeleteOrders(ids);
        res.json({ mensaje: 'Pedidos eliminados con éxito' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar pedidos en masa', error: error.message });
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
    uploadComprobante,
    deleteOrder,
    bulkDeleteOrders
};
