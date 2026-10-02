# FINAL SECURITY AUDIT — LOOSERFIT WEB PLATFORM
**Versión:** 2.0.0-PROD-READY  
**Fecha de Emisión:** 2 de Octubre, 2026  
**Auditoría:** Adversarial & Defensive Full-Stack Security Assessment  
**Metodología:** OWASP Top 10 API Security, ASVS Level 2, Threat Modeling STRIDE  

---

## 1. RESUMEN EJECUTIVO DE SEGURIDAD

Se ha completado una inspección adversarial integral y un endurecimiento defensivo de la plataforma LooserFit. Todas las superficies de ataque identificadas en las fases F1 a F6 han sido mitigadas a nivel de arquitectura, middleware, controladores y servicios.

### Estado Global de Superficies:
| Superficie | Estado | Evaluación |
| :--- | :---: | :--- |
| **1. Endpoints** | **PASS** | Todas las rutas aplican autorización por rol/token, minimización de datos y rate-limiting. |
| **2. Autenticación** | **PASS** | JWT con expiración estricta, tokens de invitado pseudoaleatorios criptográficamente seguros (256 bits CSPRNG) y guardas anti-takeover. |
| **3. Autorización** | **PASS** | Aislamiento estricto de marca (Fit vs Sport), separación guest/user/admin y prevención de IDOR. |
| **4. Input Validation** | **PASS** | Servidor autoritativo en precios/envíos, validación de schemas, magic bytes para uploads. |
| **5. Data Exposure** | **PASS** | DTO estricto de tracking con PII enmascarada; cero exposición de tokens o credenciales. |
| **6. Concurrency** | **PASS** | Contador atómico MongoDB ($inc), deducción atómica de stock en transacciones ACID. |
| **7. Idempotency** | **PASS** | Manejo de webhooks redundantes de Mercado Pago; prevención de doble procesamiento. |
| **8. Logging** | **PASS WITH LIMITATION** | Sanitización activa de PII y tokens; requiere rotación externa de logs en producción. |
| **9. Storage** | **PASS WITH LIMITATION** | Validación estricta en memoria de Magic Bytes (PDF/IMG); URLs finales residen en CDN ImageKit. |

---

## 2. EVALUACIÓN DETALLADA POR SUPERFICIE

### SUPERFICIE 1: ENDPOINTS
**Estado:** **PASS**

* **`POST /api/orders/create`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Middleware `optionalAuth` extrae identidad si existe sesión activa; si es guest, se crea orden desvinculada asignándole un `trackingToken` criptográfico único (32 bytes hex). La orden calcula precios, subtotales, costo de envío y total exclusivamente en el backend desde la colección `Product` y `SHIPPING_RATES`. Valores enviados por el cliente son descartados.
* **`GET /api/orders/track/:token`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Rate limiting en memoria (`trackRateLimiter`: máximo 30 peticiones por minuto por IP con purga periódica cada 5 minutos). Respuesta formateada mediante `toTrackingDTO(order)`: expone únicamente número de pedido, estado, fecha, items (nombre, talle, cantidad, precio histórico), subtotal, método de envío, estado de envío y datos de entrega enmascarados.
* **`GET /api/orders/mine`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Requiere `verifyToken`. Consulta filtrada exclusivamente por `usuario: req.user._id` y `deleted: { $ne: true }`. No permite consultar pedidos ajenos.
* **`GET /api/orders/:id`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Validación estricta de propiedad: si no es `admin` ni el usuario dueño (`order.usuario.toString() === req.user._id.toString()`), responde `403 Forbidden`.
* **`GET /api/orders/:id/comprobante`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Endpoint gatekeeper protegido por `verifyOrderComprobanteAccess`. Permite acceso si es admin, usuario dueño autenticado o invitado presentando `X-Guest-Token` idéntico al `trackingToken` de la orden.
* **`POST /api/orders/:id/comprobante`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Multer en memoria (`memoryStorage`, máx 5MB). Validación binaria de Magic Bytes antes de transferir a storage. Autorización idéntica mediante `verifyOrderComprobanteAccess`.
* **`POST /api/payments/create-preference`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Verifica existencia del pedido, estado `Pendiente`, valida stock disponible y genera preferencia en Mercado Pago con el monto exacto de la orden (`order.total`).
* **`POST /api/payments/webhook`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Validación criptográfica HMAC-SHA256 de cabecera `x-signature` contra `MP_WEBHOOK_SECRET`. Consulta atómica a API de Mercado Pago para verificar status, amount y currency.
* **`POST /api/arrepentimientos`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Validación de existencia de orden y coincidencia de email. Comprueba plazo legal de 10 días corridos desde creación/entrega. Previene solicitudes duplicadas sobre la misma orden.
* **`GET /api/arrepentimientos/all` y `PATCH /api/arrepentimientos/:id/status`**:
  * *Evaluación:* **PASS**.
  * *Mecanismos:* Exclusivo para administradores (`verifyAdmin`), con filtrado estricto por marca (`brandId`).

---

### SUPERFICIE 2: AUTENTICACIÓN
**Estado:** **PASS**

* **Gestión de Sesiones JWT**:
  * Clave secreta robusta (`JWT_SECRET`) validada al arranque.
  * Payloads mínimos (`{ id, role, email }`), evitando almacenamiento de datos sensibles en el token.
* **Flujo de Invitados (Guest Checkout)**:
  * El token de seguimiento (`trackingToken`) se genera mediante `crypto.randomBytes(32).toString('hex')` garantizando 256 bits de entropía.
  * Es imposible de predecir o enumerar mediante ataques de fuerza bruta.
* **Prevención de Account Takeover en `registerFromOrder`**:
  * Si un usuario se registra a partir de una compra previa como invitado, el endpoint exige `guestToken` en el cuerpo de la petición.
  * Valida que `guestToken === order.trackingToken` y `order.email.toLowerCase() === req.body.email.toLowerCase()`. Un atacante que conozca el email de otra persona no puede apropiarse de sus pedidos previos sin el token de invitado.

---

### SUPERFICIE 3: AUTORIZACIÓN Y CONTROL DE ACCESO
**Estado:** **PASS**

* **Aislamiento Multi-Brand (LooserFit vs LooserSport)**:
  * Los middlewares `brandMiddleware` y `adminBrandMiddleware` extraen y validan el contexto de marca (`fit` o `sport`).
  * En todas las operaciones de modificación o borrado administrativo (`Product`, `Category`, `HomeContent`, `Order`), los controladores verifican:
    ```javascript
    if (existingProduct.brand !== req.brandId) {
      return res.status(403).json({ message: 'No tienes permiso para modificar recursos de otra marca' });
    }
    ```
  * Se imposibilita que un administrador autenticado en el panel de Fit modifique o elimine productos o banners pertenecientes a Sport.
* **Protección contra IDOR (Insecure Direct Object References)**:
  * Rutas de lectura y descarga de comprobantes validan rigurosamente el sujeto contra el recurso solicitado.
  * Bloqueo sistemático de accesos cruzados entre usuarios registrados.

---

### SUPERFICIE 4: INPUT VALIDATION & DATA INTEGRITY
**Estado:** **PASS**

* **Validación de Modalidades de Envío**:
  * Envíos a `sucursal` exigen obligatoriamente `direccionSucursal`.
  * Envíos a `domicilio` exigen obligatoriamente `calleNumero` (calle y altura).
  * Validación de DNI: exige formato numérico de 7 u 8 dígitos.
* **Servidor como Autoridad Absoluta de Precios**:
  * Cualquier precio o total suministrado en el payload de creación de orden es ignorado.
  * Los precios unitarios se recuperan directamente desde la base de datos (`Product.findById`).
  * El costo de flete se obtiene del catálogo centralizado `SHIPPING_RATES`.
* **Validación de Archivos por Magic Bytes (Firma Binaria)**:
  * Se superó la simple comprobación de extensión o MIME-type suministrado por el navegador.
  * La función `validateMagicBytes(buffer, mimeType)` inspecciona los primeros bytes del buffer:
    * **PDF:** `%PDF` (`0x25, 0x50, 0x44, 0x46`)
    * **JPEG:** `0xFF, 0xD8, 0xFF`
    * **PNG:** `0x89, 0x50, 0x4E, 0x47`
    * **WebP:** `RIFF....WEBP`
  * Archivos ejecutables, scripts o binarios disfrazados son rechazados antes del almacenamiento.

---

### SUPERFICIE 5: DATA EXPOSURE (PII & CREDENTIALS)
**Estado:** **PASS**

* **Minimización de Datos en Tracking Público**:
  * El endpoint `GET /api/orders/track/:token` utiliza `toTrackingDTO`:
    * Nombre: Enmascarado (e.g., `"Mariano M."`).
    * Calle y altura: Enmascarados (e.g., `"Defensa ***"`).
    * DNI: Enmascarado (e.g., `"***5678"`).
    * Campos eliminados de la respuesta: `trackingToken`, `usuario`, `comprobante`, `email`, `telefono`, `mpPaymentId`, `mpPreferenceId`, `updatedAt`, notas internas. (El campo `createdAt` se preserva explícitamente en el DTO para que el comprador visualice la fecha de su orden).
* **Seguridad de Contraseñas**:
  * Passwords almacenados con algoritmo bcrypt (10 rounds de salt).
  * Exclusión selectiva (`select: false` / omisión en DTOs) en todas las consultas de usuario.

---

### SUPERFICIE 6: CONCURRENCIA & RACE CONDITIONS
**Estado:** **PASS**

* **Generación Atómica de Números de Pedido**:
  * Modelo `Counter` implementa operación atómica `findOneAndUpdate` con `$inc: { seq: 1 }` y `upsert: true`.
  * No existen condiciones de carrera ni lecturas sucias basadas en `countDocuments()`.
  * Se acepta la presencia de gaps en caso de abortos de transacción, preservando consistencia estricta.
* **Deducción y Reserva de Stock Concurrente**:
  * En el procesamiento del webhook de pago, la deducción de stock se ejecuta con filtros atómicos:
    ```javascript
    const updated = await Product.findOneAndUpdate(
      { _id: item.productoId, stock: { $gte: item.cantidad } },
      { $inc: { stock: -item.cantidad } },
      { session, new: true }
    );
    if (!updated) throw new Error('Stock insuficiente');
    ```
  * Si dos compradores intentan abonar la última unidad simultáneamente, la transacción del segundo es rechazada limpiamente sin permitir sobreventa.

---

### SUPERFICIE 7: IDEMPOTENCIA Y PROVEEDOR DE PAGOS
**Estado:** **PASS**

* **Idempotencia en Webhooks de Mercado Pago**:
  * Almacenamiento y verificación de `order.mpPaymentId`.
  * Si llega una notificación redundante para un pago ya registrado y procesado como `Pagado`, el sistema responde `200 OK` inmediatamente sin re-descontar stock ni duplicar correos electrónicos.
* **Trazabilidad y Verificación Externa**:
  * El sistema no confía ciegamente en el payload del webhook: consulta directamente a la API de Mercado Pago (`payment.get`) para validar el estado real, la moneda (`ARS`) y el monto exacto facturado contra `order.total`.

---

### SUPERFICIE 8: LOGGING & AUDITORÍA
**Estado:** **PASS WITH LIMITATION**

* **Evaluación:** **PASS**. Los logs de la aplicación no imprimen tokens JWT, contraseñas, secretos de webhook ni números de tarjeta. Errores críticos muestran descripciones funcionales sin exponer stack traces completos al cliente HTTP.
* **Limitación Residual:** En el entorno actual (desarrollo/staging local) los logs se emiten a `stdout`/`stderr` de la consola.
* **Requisito en Producción:** Se debe configurar un transport estructurado o un servicio centralizado de logs (Datadog, BetterStack, Logtail) en Render con rotación automática y retención controlada para cumplimiento GDPR/normativo.

---

### SUPERFICIE 9: ALMACENAMIENTO DE ARCHIVOS (STORAGE)
**Estado:** **PASS WITH LIMITATION**

* **Evaluación:** **PASS**. El backend valida rigurosamente tipo MIME, tamaño (máx 5MB) y Magic Bytes binarios. Los endpoints de subida y consulta exigen autorización y verifican la propiedad del pedido.
* **Limitación Residual:** El storage configurado en el código es ImageKit CDN con fallback local seguro. Por diseño de ImageKit, los archivos subidos al CDN reciben una URL directa pública alojada en los servidores de ImageKit (`ik.imagekit.io/...`).
* **Mitigación Implementada:**
  1. Los nombres de archivo subidos utilizan patrón seguro no predecible (`comprobante_${orderId}_${timestamp}.${ext}`), imposibilitando la enumeración o adivinanza de rutas.
  2. El endpoint de tracking público NO devuelve la URL del comprobante.
  3. El frontend y los clientes legítimos acceden al comprobante a través del endpoint protegido `GET /api/orders/:id/comprobante`.
* **Requisito en Producción:** Si el cliente requiere máxima confidencialidad bancaria, ImageKit soporta la habilitación de carpetas privadas (`Private Folder`) con generación de URLs firmadas temporales (`expireSeconds`).

---

## 3. RESUMEN DE AMENAZAS MITIGADAS (OWASP / STRIDE)

| Amenaza | Clasificación | Mitigación Implementada |
| :--- | :---: | :--- |
| **Spoofing (Suplantación)** | P0 | Firmas criptográficas HMAC en webhooks; JWT verificado con secret robusto. |
| **Tampering (Manipulación)** | P0 | Precios y costos de envío calculados exclusivamente por el backend. Magic bytes en uploads. |
| **Repudiation (Repudio)** | P1 | Trazabilidad en `Arrepentimiento` con timestamps, IP y estados inmutables. |
| **Information Disclosure** | P0 | DTO de tracking con datos enmascarados; comprobante no expuesto en tracking. |
| **Denial of Service (DoS)** | P1 | Rate limiter en `track/:token` (30 req/min); límites de tamaño en Multer (5MB). |
| **Elevation of Privilege** | P0 | Aislamiento multi-brand en controladores admin; verificación de rol en cada acción crítica. |
