'use strict';

const express = require('express');
const router = express.Router();
const arrepentimientoController = require('../controllers/arrepentimientoController');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { detectBrand } = require('../middleware/brandMiddleware');

// Endpoint público: Iniciar trámite de arrepentimiento (SIN login obligatorio, Disp. 954/2025)
router.post('/', detectBrand, arrepentimientoController.crearSolicitud);

// Rutas de administración (requieren sesión activa de administrador)
router.get('/all', protect, adminOnly, arrepentimientoController.getAllSolicitudes);
router.get('/:id', protect, adminOnly, arrepentimientoController.getSolicitudById);
router.patch('/:id/status', protect, adminOnly, arrepentimientoController.updateStatus);

module.exports = router;
