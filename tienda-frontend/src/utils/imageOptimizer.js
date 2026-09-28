/**
 * Optimiza las URLs de imágenes (ImageKit y Cloudinary) para reducir drásticamente el consumo de ancho de banda.
 * Aplica compresión inteligente, cambio a formato moderno (WebP/AVIF auto) y redimensión al tamaño requerido.
 */
export function optimizeImage(url, width = 600, quality = 80) {
  if (!url || typeof url !== 'string') return url || '/placeholder.jpg';
  if (url.startsWith('/') || url.startsWith('data:')) return url;

  // ImageKit
  if (url.includes('imagekit.io')) {
    if (url.includes('tr=')) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}tr=w-${width},q-${quality},f-auto`;
  }

  // Cloudinary
  if (url.includes('cloudinary.com') && url.includes('/upload/')) {
    if (url.includes('/upload/w_') || url.includes('/upload/c_')) return url;
    return url.replace('/upload/', `/upload/w_${width},q_${quality},f_auto/`);
  }

  return url;
}
