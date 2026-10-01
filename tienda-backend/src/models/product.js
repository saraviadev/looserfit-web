const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    // Discriminador de marca — identifica a qué marca pertenece este producto
    brand: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Brand',
        required: true
    },
    nombre: { type: String, required: true },
    descripcion: { type: String },
    precio: { type: Number, required: true },
    precioOferta: { type: Number },
    categoria: { 
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true 
    },
    tipo: { 
        type: String, 
        default: 'regular'
    },
    talles: [{ type: String }], // Ejemplo: ["S", "M", "L"]
    imagenes: [{ type: String }],
    stock: { type: Number, default: 0 },
    publicado: { type: Boolean, default: false }, // "Ocultar o poner visible"
    esNuevoDrop: { type: Boolean, default: false }, // Para la sección de "Últimas novedades"
    guiaTalles: { type: String } // Guía de medidas (texto o URL)
}, { timestamps: true });

// Índices compuestos para búsquedas multi-marca eficientes
productSchema.index({ brand: 1, categoria: 1 });
productSchema.index({ brand: 1, esNuevoDrop: 1 });
productSchema.index({ brand: 1, publicado: 1 });

module.exports = mongoose.models.Product || mongoose.model('Product', productSchema);