const productService = require('../services/productService');
const { subirImagen } = require('../config/storage');

const getAllProducts = async (req, res) => {
    try {
        const { categoria, soloPublicados, corte, esNuevoDrop, q } = req.query;
        const filtros = {};
        // Multi-marca: pasar el brandId resuelto por el middleware
        if (req.brandId) filtros.brand = req.brandId;
        if (categoria) filtros.categoria = categoria;
        if (soloPublicados === 'true') filtros.publicado = true;
        if (corte) filtros.corte = corte;
        if (esNuevoDrop === 'true' || esNuevoDrop === true) filtros.esNuevoDrop = true;
        if (q) filtros.q = q;

        const products = await productService.getAllProducts(filtros);
        res.json(products);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener productos', error: error.message });
    }
};

const getProductById = async (req, res) => {
    try {
        const product = await productService.getProductById(req.params.id);
        if (!product) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        res.json(product);
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al obtener producto', error: error.message });
    }
};

const createProduct = async (req, res) => {
    try {
        const urls = req.files && req.files['imagenes'] 
            ? await Promise.all(req.files['imagenes'].map(file => subirImagen(file)))
            : [];
        const guiaTallesUrl = req.files && req.files['guiaTallesImg'] 
            ? await subirImagen(req.files['guiaTallesImg'][0]) 
            : req.body.guiaTalles;
        
        const newProduct = await productService.createProduct({
            ...req.body,
            imagenes: urls,
            guiaTalles: guiaTallesUrl,
            brand: req.brandId  // Multi-marca: asignar la marca activa del admin
        });

        res.status(201).json({ mensaje: 'Producto creado!', nuevoProducto: newProduct });
    } catch (error) {
        res.status(500).json({ mensaje: error.message || 'Error al crear producto', error: error.message });
    }
};

const updateProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const existing = await productService.getProductById(productId);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }

        const { galeriaPersistente, imagenesExistentes, ...otrosCampos } = req.body;
        
        // Mantener fotos viejas
        let fotosMantener = galeriaPersistente || imagenesExistentes || existing.imagenes || [];
        if (!Array.isArray(fotosMantener)) fotosMantener = [fotosMantener];

        // Fotos nuevas
        let fotosNuevas = [];
        if (req.files && req.files['imagenes']) {
            fotosNuevas = await Promise.all(req.files['imagenes'].map(f => subirImagen(f)));
        }

        const totalFinal = [...new Set([...fotosMantener, ...fotosNuevas])].filter(f => f && typeof f === 'string');

        // Guía talles
        let guiaTalles = existing.guiaTalles;
        if (req.files && req.files['guiaTallesImg'] && req.files['guiaTallesImg'].length > 0) {
            guiaTalles = await subirImagen(req.files['guiaTallesImg'][0]);
        } else if (otrosCampos.guiaTalles) {
            guiaTalles = otrosCampos.guiaTalles;
        }

        const updateData = {
            ...otrosCampos,
            imagenes: totalFinal,
            guiaTalles
        };

        const updated = await productService.updateProduct(productId, updateData);
        res.json({ mensaje: 'Producto actualizado!', producto: updated });
    } catch (error) {
        // Log para debug si fuera necesario en el servidor
        console.error('Error en updateProduct:', error);
        res.status(500).json({ mensaje: error.message || 'Error al actualizar producto', error: error.message });
    }
};

const deleteProduct = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para eliminar un producto de otra marca' });
        }
        await productService.deleteProduct(req.params.id);
        res.json({ mensaje: 'Producto eliminado' });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al eliminar producto', error: error.message });
    }
};

const toggleProductVisibility = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }
        const product = await productService.toggleProductVisibility(req.params.id);
        res.json({ mensaje: 'Visibilidad actualizada', producto: product });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar visibilidad', error: error.message });
    }
};

const toggleProductDrop = async (req, res) => {
    try {
        const existing = await productService.getProductById(req.params.id);
        if (!existing) return res.status(404).json({ mensaje: 'Producto no encontrado' });
        if (req.brandId && existing.brand && String(existing.brand._id || existing.brand) !== String(req.brandId)) {
            return res.status(403).json({ mensaje: 'No tenés permiso para modificar un producto de otra marca' });
        }
        const product = await productService.toggleProductDrop(req.params.id);
        res.json({ mensaje: 'Estado Drop actualizado', producto: product });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error al actualizar estado drop', error: error.message });
    }
};

const bulkToggleProductDrop = async (req, res) => {
    try {
        const { productIds, estado } = req.body;
        if (!Array.isArray(productIds)) {
            return res.status(400).json({ mensaje: 'productIds debe ser un array' });
        }
        if (typeof estado !== 'boolean') {
            return res.status(400).json({ mensaje: 'estado debe ser un booleano' });
        }
        const result = await productService.bulkToggleProductDrop(productIds, estado);
        res.json({ mensaje: 'Estado Drop actualizado masivamente', result });
    } catch (error) {
        res.status(500).json({ mensaje: 'Error en bulk toggle drop', error: error.message });
    }
};

module.exports = {
    getAllProducts,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
    toggleProductVisibility,
    toggleProductDrop,
    bulkToggleProductDrop
};
