'use strict';

const crypto = require('crypto');

/**
 * Valida la firma criptográfica HMAC-SHA256 de Mercado Pago según la especificación oficial.
 * Headers requeridos:
 *   - x-signature: ts=[timestamp],v1=[hash]
 *   - x-request-id: [uuid / request-id]
 * Parámetros:
 *   - dataId: identificador del recurso enviado en la query ('data.id' o 'id') o en body
 * 
 * Plantilla del manifiesto oficial:
 *   "id:[data.id];request-id:[x-request-id];ts:[ts];"
 *
 * @param {object} req - Express Request
 * @param {string} webhookSecret - Clave secreta MP_WEBHOOK_SECRET
 * @param {object} [options] - Opciones (ej. maxDriftMs: tolerancia temporal en ms)
 * @returns {{ valid: boolean, reason?: string }}
 */
function verifyMercadoPagoWebhookSignature(req, webhookSecret, options = {}) {
  if (!webhookSecret) {
    // Si no hay secreto configurado en el servidor, no se puede validar
    return { valid: false, reason: 'MP_WEBHOOK_SECRET no configurado' };
  }

  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];

  if (!xSignature || !xRequestId) {
    return { valid: false, reason: 'Faltan cabeceras x-signature o x-request-id' };
  }

  // Extraer ts y v1 de la cabecera x-signature (ej: "ts=1704067200,v1=5d640...")
  const parts = xSignature.split(',');
  let ts = null;
  let v1 = null;

  for (const part of parts) {
    const [key, value] = part.trim().split('=');
    if (key === 'ts') ts = value;
    if (key === 'v1') v1 = value;
  }

  if (!ts || !v1) {
    return { valid: false, reason: 'Formato inválido de x-signature (se requieren ts y v1)' };
  }

  // Validación de frescura del timestamp para prevenir ataques de replay
  const maxDriftMs = options.maxDriftMs || 10 * 60 * 1000; // 10 minutos por defecto
  const parsedTs = parseInt(ts, 10);
  if (isNaN(parsedTs)) {
    return { valid: false, reason: 'Timestamp ts no es un número válido' };
  }

  const tsMs = ts.length === 10 ? parsedTs * 1000 : parsedTs;
  const now = Date.now();
  // Permitir timestamp en el pasado hasta maxDriftMs y hasta 60s en el futuro (desviación de reloj)
  if (now - tsMs > maxDriftMs || tsMs - now > 60000) {
    return { valid: false, reason: 'Timestamp de firma expirado o fuera de rango permitido' };
  }

  // Extraer data.id
  const dataId = req.query['data.id'] || req.query.id || (req.body && (req.body.id || req.body['data.id'] || req.body.data?.id));
  if (!dataId) {
    return { valid: false, reason: 'Identificador data.id ausente' };
  }

  // Construir manifiesto exacto de Mercado Pago:
  // "id:[data.id];request-id:[x-request-id];ts:[ts];"
  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;

  // Calcular HMAC-SHA256 con el secreto
  const computedHash = crypto
    .createHmac('sha256', webhookSecret)
    .update(manifest)
    .digest('hex');

  // Comparación en tiempo constante (timing-safe) para evitar timing attacks
  const computedBuffer = Buffer.from(computedHash, 'utf8');
  const receivedBuffer = Buffer.from(v1, 'utf8');

  if (computedBuffer.length !== receivedBuffer.length) {
    return { valid: false, reason: 'Firma criptográfica inválida (longitud incorrecta)' };
  }

  const match = crypto.timingSafeEqual(computedBuffer, receivedBuffer);
  if (!match) {
    return { valid: false, reason: 'Firma criptográfica HMAC-SHA256 no coincide' };
  }

  return { valid: true };
}

/**
 * Genera una firma válida para propósitos de prueba / testing
 */
function generateTestMpSignature({ dataId, requestId, secret, timestamp }) {
  const ts = timestamp ? String(timestamp) : String(Math.floor(Date.now() / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  return {
    'x-signature': `ts=${ts},v1=${v1}`,
    'x-request-id': requestId,
    ts,
    v1
  };
}

module.exports = {
  verifyMercadoPagoWebhookSignature,
  generateTestMpSignature
};
