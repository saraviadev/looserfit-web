const categoryService = require('../services/categoryService');

const getAllCategories = async (req, res) => {
    try {
        // Multi-marca: filtrar por marca activa
        const categories = await categoryService.getAllCategories(req.brandId);
        res.json(categories);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener categorías', error: error.message });
    }
};

const createCategory = async (req, res) => {
    try {
        // Multi-marca: asignar la marca activa del middleware
        const category = await categoryService.createCategory({ ...req.body, brand: req.brandId });
        res.status(201).json(category);
    } catch (error) {
        res.status(400).json({ mensaje: 'Error al crear categoría', error: error.message });
    }
};

const getCategoryById = async (req, res) => {
    try {
        const category = await categoryService.getCategoryById(req.params.id);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json(category);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener categoría', error: error.message });
    }
};

const updateCategory = async (req, res) => {
    try {
        const existing = await categoryService.getCategoryById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar una categoría de otra marca' });
        }
        const category = await categoryService.updateCategory(req.params.id, req.body);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json(category);
    } catch (error) {
        res.status(400).json({ mensaje: 'Error al actualizar categoría', error: error.message });
    }
};

const deleteCategory = async (req, res) => {
    try {
        const existing = await categoryService.getCategoryById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para eliminar una categoría de otra marca' });
        }
        const category = await categoryService.deleteCategory(req.params.id);
        if (!category) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
        res.json({ mensaje: 'Categoría eliminada' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar categoría', error: error.message });
    }
};

module.exports = {
    getAllCategories,
    createCategory,
    getCategoryById,
    updateCategory,
    deleteCategory
};
