/**
 * siteConfig.js — Configuración estática de cada marca para el frontend.
 * getBrandConfig(slug) devuelve la config de la marca solicitada.
 * siteConfig mantiene el valor de Fit para compatibilidad con código legacy.
 */

const BRAND_CONFIGS = {
  fit: {
    name: 'Looser Fit',
    tagline: 'High Quality Aesthetic Wear',
    socials: {
      instagram: '@looser.fit',
      twitter: '@looserfit',
    },
    contact: {
      email: 'hola@looserfit.com',
      address: 'Buenos Aires, Argentina',
      cuit: '[CUIT EN TRÁMITE - RESPONSABLE A DESIGNAR]',
      razonSocial: 'Looser Fit Indumentaria',
      defensaConsumidorUrl: 'https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario',
    },
    assets: {
      logo: '/logo3.0.png',
      favicon: '/favicon.ico',
      adminAvatar: '/logo3.0.png',
    },
    settings: {
      showNewsletter: true,
      showTracking: true,
    },
  },
  sport: {
    name: 'Looser Sport',
    tagline: 'Performance & Style',
    socials: {
      instagram: '@looser.sport',
      twitter: '@loosersport',
    },
    contact: {
      email: 'hola@loosersport.com',
      address: 'Buenos Aires, Argentina',
    },
    assets: {
      logo: '/logo-sport.png',
      favicon: '/favicon.ico',
      adminAvatar: '/logo-sport.png',
    },
    settings: {
      showNewsletter: true,
      showTracking: true,
    },
  },
}

// Helper: obtener config por slug de marca
export const getBrandConfig = (slug = 'fit') => BRAND_CONFIGS[slug] || BRAND_CONFIGS.fit

// Compatibilidad legacy: código que importa siteConfig directamente sigue usando Fit
export const siteConfig = BRAND_CONFIGS.fit
