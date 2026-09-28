const cloudinary = require('cloudinary').v2;
const { imagekit } = require('../config/storage');

/**
 * Extrae el public_id de una URL de Cloudinary.
 * Ejemplo: https://res.cloudinary.com/demo/image/upload/v1234/folder/image.jpg -> folder/image
 */
const extractPublicId = (url) => {
    try {
        if (!url || typeof url !== 'string' || !url.includes('cloudinary.com')) return null;
        
        // Dividir por '/upload/'
        const parts = url.split('/upload/');
        if (parts.length < 2) return null;
        
        // Quitar la versión (v1234567/) si existe
        let publicIdWithExt = parts[1];
        if (publicIdWithExt.startsWith('v')) {
            const firstSlash = publicIdWithExt.indexOf('/');
            publicIdWithExt = publicIdWithExt.substring(firstSlash + 1);
        }
        
        // Quitar la extensión (.jpg, .png, etc.)
        const lastDot = publicIdWithExt.lastIndexOf('.');
        if (lastDot !== -1) {
            return publicIdWithExt.substring(0, lastDot);
        }
        return publicIdWithExt;
    } catch (error) {
        console.error('Error extracting public_id:', error);
        return null;
    }
};

/**
 * Extrae el nombre de archivo de una URL de ImageKit.
 * Ejemplo: https://ik.imagekit.io/dluadqfr5/looserfit_productos/IMG_1491_lNuPnO1Xff.jpeg?updatedAt=... -> IMG_1491_lNuPnO1Xff.jpeg
 */
const extractImageKitFileName = (url) => {
    try {
        if (!url || typeof url !== 'string' || !url.includes('imagekit.io')) return null;
        const cleanUrl = url.split('?')[0].split('#')[0];
        const parts = cleanUrl.split('/');
        const fileName = parts[parts.length - 1];
        return fileName ? decodeURIComponent(fileName) : null;
    } catch (error) {
        console.error('Error extracting ImageKit fileName:', error);
        return null;
    }
};

/**
 * Elimina una imagen de ImageKit a partir de su URL o nombre de archivo.
 */
const deleteFromImageKit = async (url) => {
    try {
        const fileName = extractImageKitFileName(url);
        if (!fileName) return null;

        // Buscar el archivo en ImageKit para obtener su fileId
        const files = await imagekit.listFiles({ name: fileName });
        if (!files || files.length === 0) {
            console.warn(`[ImageKit] Archivo no encontrado para eliminar: ${fileName}`);
            return null;
        }

        // Priorizar archivos cuyo nombre coincida exactamente
        const matchingFiles = files.filter(f => f.name === fileName || (url && url.includes(f.name)));
        const filesToDelete = matchingFiles.length > 0 ? matchingFiles : files;

        const results = [];
        for (const file of filesToDelete) {
            if (file.fileId) {
                const res = await imagekit.deleteFile(file.fileId);
                console.log(`[ImageKit] Imagen eliminada con éxito: ${file.name} (fileId: ${file.fileId})`);
                results.push(res);
            }
        }
        return results;
    } catch (error) {
        console.error(`[ImageKit] Error al eliminar imagen de ImageKit (${url}):`, error.message || error);
        return null;
    }
};

/**
 * Elimina una imagen de Cloudinary a partir de su URL.
 */
const deleteFromCloudinaryOnly = async (url) => {
    const publicId = extractPublicId(url);
    if (!publicId) return null;

    try {
        const result = await cloudinary.uploader.destroy(publicId);
        console.log(`[Cloudinary] Imagen eliminada: ${publicId}`);
        return result;
    } catch (error) {
        console.error(`[Cloudinary] Error deleting ${publicId}:`, error.message || error);
        return null;
    }
};

/**
 * Función unificada para eliminar imágenes:
 * Detecta automáticamente si la imagen pertenece a ImageKit o Cloudinary y la elimina.
 * Soporta URL individual o un array de URLs.
 */
const deleteImage = async (urlOrUrls) => {
    if (!urlOrUrls) return null;

    if (Array.isArray(urlOrUrls)) {
        const results = [];
        for (const u of urlOrUrls) {
            results.push(await deleteImage(u));
        }
        return results;
    }

    const url = String(urlOrUrls).trim();
    if (!url) return null;

    if (url.includes('imagekit.io')) {
        return await deleteFromImageKit(url);
    }

    if (url.includes('cloudinary.com')) {
        return await deleteFromCloudinaryOnly(url);
    }

    return null;
};

module.exports = {
    extractPublicId,
    extractImageKitFileName,
    deleteFromCloudinaryOnly,
    deleteFromImageKit,
    deleteImage,
    // Alias para compatibilidad total con todo el código existente
    deleteFromCloudinary: deleteImage
};
