const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { protect, adminOnly, optionalAuth } = require('../middleware/authMiddleware');
const { SHIPPING_RATES, SHIPPING_PROVIDER } = require('../constants/shipping');
const { detectBrand } = require('../middleware/brandMiddleware');

// Rate Limiter en memoria para el endpoint público de seguimiento (anti enumeración)
const trackRateLimitMap = new Map();
const trackRateLimiter = (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowMs = 60 * 1000;
    const maxReq = 30;

    const record = trackRateLimitMap.get(ip);
    if (!record || (now - record.startTime) > windowMs) {
        trackRateLimitMap.set(ip, { count: 1, startTime: now });
        return next();
    }

    if (record.count >= maxReq) {
        return res.status(429).json({ mensaje: 'Demasiadas consultas de seguimiento. Por favor esperá un minuto.' });
    }

    record.count++;
    next();
};

setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of trackRateLimitMap.entries()) {
        if (now - record.startTime > 60000) trackRateLimitMap.delete(ip);
    }
}, 300000).unref();


// --- CREAR UN NUEVO PEDIDO (Soporta invitados) ---
// --- TARIFAS DE ENVÍO ---
router.get('/shipping-rates', (_req, res) => res.json({ provider: SHIPPING_PROVIDER, rates: SHIPPING_RATES }));

// --- CREAR UN NUEVO PEDIDO (Soporta invitados y usuarios registrados con optionalAuth) ---
router.post('/create', detectBrand, optionalAuth, orderController.createOrder);

// --- VER MIS PEDIDOS ---
router.get('/mine', protect, orderController.getOrdersMine);

// --- VER TODOS LOS PEDIDOS (Solo Admin) ---
router.get('/all', protect, adminOnly, orderController.getAllOrders);

// --- SEGUIMIENTO PÚBLICO (Sin Login) ---
router.get('/track/:token', trackRateLimiter, orderController.getOrderByToken);

// --- VER UN PEDIDO POR ID (Protegido por SEC-01) ---
router.get('/:id', orderController.getOrderById);

// --- CAMBIAR ESTADO DEL PEDIDO (Solo Admin) ---
router.patch('/:id/estado', protect, adminOnly, orderController.updateStatus);

// --- ACTUALIZAR NÚMERO DE SEGUIMIENTO (Solo Admin) ---
router.patch('/:id/tracking', protect, adminOnly, orderController.updateTracking);

// --- SUBIR COMPROBANTE DE PAGO (Protegido por SEC-03) ---
// --- VER COMPROBANTE AUTORIZADO ---
router.get('/:id/comprobante', orderController.verifyOrderComprobanteAccess, orderController.getOrderComprobante);

router.post(
    '/upload-comprobante/:id',
    orderController.verifyOrderUploadAuth,
    orderController.uploadComprobanteMiddleware,
    orderController.uploadComprobante
);

// --- ELIMINAR UN PEDIDO (Solo Admin) ---
router.delete('/:id', protect, adminOnly, orderController.deleteOrder);

// --- ELIMINAR PEDIDOS EN MASA (Solo Admin) ---
router.post('/delete-bulk', protect, adminOnly, orderController.bulkDeleteOrders);

// --- RESTAURAR PEDIDO ELIMINADO (Solo Admin) ---
router.patch('/:id/restore', protect, adminOnly, orderController.restoreOrder);

// --- RESTAURAR PEDIDOS EN MASA (Solo Admin) ---
router.post('/restore-bulk', protect, adminOnly, orderController.bulkRestoreOrders);

module.exports = router;
