/**
 * seed-brands.js — Script de inicialización de la colección `brands`.
 * Crea los documentos de Looser Fit y Looser Sport si no existen todavía.
 * Es idempotente: correrlo dos veces no duplica datos.
 *
 * USO: node tienda-backend/scripts/seed-brands.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Brand = require('../src/models/Brand');

// Definición de las marcas iniciales del sistema
const INITIAL_BRANDS = [
  {
    slug: 'fit',
    name: 'Looser Fit',
    enabled: true,
    order: 1,
    logo: '/logo3.0.png', // Logo actual de Fit (ya existe en public/)
    theme: {
      primaryColor: '#0d0d0d',
      secondaryColor: '#f5f3ef',
      accentColor: '#c8b89a',
      fontFamily: 'Inter',
      borderRadius: '0px',
    },
    seo: {
      title: 'Looser Fit',
      description: 'Tienda oficial de Looser Fit. Ropa urbana de calidad premium.',
      ogImage: '',
    },
    settings: {
      comingSoon: false,
      maintenanceMode: false,
    },
  },
  {
    slug: 'sport',
    name: 'Looser Sport',
    enabled: true,
    order: 2,
    logo: '/logo-sport.png', // Logo de Sport (se colocará en public/ en Sección 5)
    theme: {
      primaryColor: '#0d0d0d',
      secondaryColor: '#f5f3ef',
      accentColor: '#c8b89a',
      fontFamily: 'Inter',
      borderRadius: '0px',
    },
    seo: {
      title: 'Looser Sport — Performance & Style',
      description: 'Tienda oficial de Looser Sport. Indumentaria deportiva premium.',
      ogImage: '',
    },
    settings: {
      comingSoon: true,  // Sport arranca en modo "próximamente"
      maintenanceMode: false,
    },
  },
];

async function seedBrands() {
  try {
    // Conectar a MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Conectado a MongoDB');

    let creados = 0;
    let existentes = 0;

    for (const brandData of INITIAL_BRANDS) {
      // Buscar si ya existe por slug (idempotencia)
      const existing = await Brand.findOne({ slug: brandData.slug });

      if (existing) {
        console.log(`⏭️  Marca '${brandData.slug}' ya existe (ID: ${existing._id}) — no se modifica`);
        existentes++;
      } else {
        const newBrand = await Brand.create(brandData);
        console.log(`🆕 Marca '${brandData.slug}' creada (ID: ${newBrand._id})`);
        creados++;
      }
    }

    console.log('\n📊 Resumen:');
    console.log(`   ✅ Marcas creadas:    ${creados}`);
    console.log(`   ⏭️  Marcas existentes: ${existentes}`);
    console.log('\n🏁 Seed completado.');
  } catch (error) {
    console.error('❌ Error en seed-brands:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Desconectado de MongoDB.');
  }
}

seedBrands();
