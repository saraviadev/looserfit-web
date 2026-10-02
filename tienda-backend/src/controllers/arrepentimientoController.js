'use strict';

const arrepentimientoService = require('../services/arrepentimientoService');

const crearSolicitud = async (req, res) => {
    try {
        const brandSlug = req.query.brand || req.body.brand || (req.brand ? req.brand.slug : 'fit');
        const solicitud = await arrepentimientoService.crearSolicitud({
            ...req.body,
            brandSlug
        });

        res.status(201).json({
            mensaje: 'Solicitud de arrepentimiento registrada con éxito',
            solicitud: {
                requestNumber: solicitud.requestNumber,
                orderNumber: solicitud.orderNumber,
                customerEmail: solicitud.customerEmail,
                customerName: solicitud.customerName,
                status: solicitud.status,
                createdAt: solicitud.createdAt
            }
        });
    } catch (error) {
        const status = error.statusCode || 400;
        res.status(status).json({ mensaje: error.message });
    }
};

const getAllSolicitudes = async (req, res) => {
    try {
        const solicitudes = await arrepentimientoService.getAllSolicitudes(req.query);
        res.json(solicitudes);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener solicitudes de arrepentimiento', error: error.message });
    }
};

const getSolicitudById = async (req, res) => {
    try {
        const solicitud = await arrepentimientoService.getSolicitudById(req.params.id);
        if (!solicitud) return res.status(404).json({ mensaje: 'Solicitud no encontrada' });
        res.json(solicitud);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al consultar solicitud', error: error.message });
    }
};

const updateStatus = async (req, res) => {
    try {
        const { status, resolutionNotes } = req.body;
        const actualizada = await arrepentimientoService.updateStatus(req.params.id, status, resolutionNotes);
        if (!actualizada) return res.status(404).json({ mensaje: 'Solicitud no encontrada' });
        res.json({ mensaje: 'Estado de la solicitud actualizado', solicitud: actualizada });
    } catch (error) {
        const code = error.statusCode || 500;
        res.status(code).json({ mensaje: error.message });
    }
};

module.exports = {
    crearSolicitud,
    getAllSolicitudes,
    getSolicitudById,
    updateStatus
};
