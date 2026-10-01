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
        
        const orderObj = order.toObject ? order.toObject() : { ...order };
        // Minimización de datos: enmascarar DNI en respuesta pública de tracking
        if (orderObj.datosEnvio && orderObj.datosEnvio.dni) {
            const rawDni = String(orderObj.datosEnvio.dni);
            orderObj.datosEnvio.dni = rawDni.length > 4 ? '***' + rawDni.slice(-4) : '***';
        }
        res.json(orderObj);
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
            return res.status(400).json({ mensaje: 'Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG o WebP válidas.' });
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
    bulkRestoreOrders
};
