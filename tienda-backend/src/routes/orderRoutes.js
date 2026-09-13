const express = require('express');
const router = express.Router();
const { upload } = require('../config/storage');
const orderController = require('../controllers/orderController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { detectBrand } = require('../middleware/brandMiddleware');

// --- CREAR UN NUEVO PEDIDO (Soporta invitados) ---
router.post('/create', detectBrand, orderController.createOrder);

// --- VER MIS PEDIDOS ---
router.get('/mine', protect, orderController.getOrdersMine);

// --- VER TODOS LOS PEDIDOS (Solo Admin) ---
router.get('/all', protect, adminOnly, orderController.getAllOrders);

// --- VER UN PEDIDO POR ID ---
router.get('/:id', orderController.getOrderById);

// --- SEGUIMIENTO PÚBLICO (Sin Login) ---
router.get('/track/:token', orderController.getOrderByToken);

// --- CAMBIAR ESTADO DEL PEDIDO (Solo Admin) ---
router.patch('/:id/estado', protect, adminOnly, orderController.updateStatus);

// --- ACTUALIZAR NÚMERO DE SEGUIMIENTO (Solo Admin) ---
router.patch('/:id/tracking', protect, adminOnly, orderController.updateTracking);

// --- SUBIR COMPROBANTE DE PAGO ---
router.post('/upload-comprobante/:id', upload.single('comprobante'), orderController.uploadComprobante);

// --- ELIMINAR UN PEDIDO (Solo Admin) ---
router.delete('/:id', protect, adminOnly, orderController.deleteOrder);

// --- ELIMINAR PEDIDOS EN MASA (Solo Admin) ---
router.post('/delete-bulk', protect, adminOnly, orderController.bulkDeleteOrders);

module.exports = router;