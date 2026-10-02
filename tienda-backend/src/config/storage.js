const path = require('path');
const multer = require('multer');
const ImageKit = require('imagekit');

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY || 'default_public_key',
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY || 'default_private_key',
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || 'https://ik.imagekit.io/default'
});

// Multer general para productos (10MB máximo)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
});

// Tipos MIME y extensiones estrictamente permitidas para comprobantes de pago
const ALLOWED_RECEIPT_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ALLOWED_RECEIPT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

const receiptFileFilter = (_req, file, cb) => {
    // 1. Validación de MIME Type declarado
    if (!ALLOWED_RECEIPT_MIMES.includes(file.mimetype)) {
        const error = new Error('Tipo de archivo no permitido. Solo se aceptan imágenes JPEG, PNG, WebP o documentos PDF.');
        error.code = 'INVALID_FILE_TYPE';
        return cb(error, false);
    }

    // 2. Validación de extensión de archivo
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_RECEIPT_EXTENSIONS.includes(ext)) {
        const error = new Error('Extensión de archivo no permitida. Solo se aceptan .jpg, .jpeg, .png, .webp o .pdf.');
        error.code = 'INVALID_FILE_EXTENSION';
        return cb(error, false);
    }

    cb(null, true);
};

// Multer especializado para comprobantes: límite 5MB y filtro estricto
const uploadComprobanteMulter = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB máximo
    fileFilter: receiptFileFilter
});

// Inspección real de Magic Bytes en memoria (Buffer) sin dependencias externas
function validateMagicBytes(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 12) {
        return null;
    }

    // JPEG / JPG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    ) {
        return { mime: 'image/png', ext: 'png' };
    }

    // WebP: RIFF (bytes 0-3) y WEBP (bytes 8-11)
    if (
        buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
        return { mime: 'image/webp', ext: 'webp' };
    }

    // PDF: %PDF (25 50 44 46)
    if (
        buffer[0] === 0x25 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x44 &&
        buffer[3] === 0x46
    ) {
        return { mime: 'application/pdf', ext: 'pdf' };
    }

    return null;
}

// Función para subir una imagen a Imagekit
async function subirImagen(file, carpeta = 'looserfit_productos') {
    const resultado = await imagekit.upload({
        file: file.buffer,
        fileName: file.originalname,
        folder: carpeta,
        useUniqueFileName: true
    });
    console.log('URL generada por ImageKit:', resultado.url);
    return resultado.url;
}

module.exports = {
    upload,
    uploadComprobanteMulter,
    validateMagicBytes,
    subirImagen,
    imagekit
};
