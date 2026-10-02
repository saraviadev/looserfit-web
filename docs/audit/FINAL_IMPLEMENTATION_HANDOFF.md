# LOOSERFIT — FINAL IMPLEMENTATION HANDOFF (DOCUMENTO MAESTRO V3.0.0-FINAL)

**Fecha de Cierre:** 2 de Octubre de 2026  
**Estado General:** PROD-READY (Código, Seguridad, Concurrencia y Tests Aprobados al 100%)  
**Rama de Git:** `main`  
**Suites de Test:** 10/10 PASSING (84/84 Tests Unitarios, de Integración y Adversariales)  
**Linters:** Backend (0 errors, 0 warnings) | Frontend (0 errors, 0 warnings)  
**Frontend Production Build:** PASS (Vite v8.0.2 compilado limpiamente en < 1s)

---

## 1. RESUMEN EJECUTIVO Y ESTADO FINAL

El proyecto **LooserFit** ha sido sometido a una auditoría adversarial integral, remediación profunda de vulnerabilidades, hardening criptográfico y cierre de todas sus fases funcionales (F1 a F6), incluyendo la pasarela de pagos oficial Mercado Pago (F3) y el sistema legal de revocación de compra/arrepentimiento (F5).

El sistema cuenta con:
1. **Aislamiento Multi-Marca Absoluto:** Separación estricta entre **Looser Fit** (streetwear) y **Looser Sport** (deportivo). Ningún administrador o comprador puede filtrar o mutar recursos de la otra marca.
2. **Checkout Blindado e Inmutable:** Precios calculados exclusivamente en backend desde la base de datos MongoDB; tarifas de Correo Argentino ($7.500 sucursal / $11.000 domicilio) autoritativas; prevención de inyección o manipulación de subtotales, envíos o identificadores de usuario.
3. **Mercado Pago Oficial & Transacciones Atómicas:** Preferencias creadas a partir de snapshots congelados de orden; webhooks firmados con HMAC-SHA256 (con tolerancia anti-replay de timestamp y comparación timing-safe); validación de moneda (ARS) y monto; transacciones multi-documento nativas en MongoDB ReplicaSet (producción Atlas) y operaciones atómicas con guarda condicional en entornos standalone.
4. **Almacenamiento de Comprobantes:** Soporte validado para imágenes (JPEG, PNG, WebP) y documentos bancarios en PDF con inspección real de Magic Bytes en memoria; endpoint seguro con control de acceso (`GET /api/orders/:id/comprobante`) y no exposición en links públicos.
5. **Seguridad y Minimización de Datos en Tracking:** DTO dedicado para el endpoint público de seguimiento (`GET /api/orders/track/:token`), enmascarando nombre ("Juan P."), ocultando altura de calle ("Defensa ***"), enmascarando DNI ("***5678"), suprimiendo email, teléfono, comprobantes privados, IDs internos y tokens; rate-limiting anti-fuerza bruta en memoria.
6. **Derecho de Arrepentimiento:** Persistencia legal completa (modelo `Arrepentimiento`), numeración secuencial atómica (`ARR-YYYY-XXXXX`), validación de identidad sin fuga de PII conforme a la **Disposición 954/2025** y **Disposición 3/2026** de Defensa del Consumidor, erradicando toda referencia a la derogada Resolución 424/2020.
7. **Emails Transaccionales con Resend & SMTP:** Resend API HTTP (puerto 443 sin bloqueos en Render) con fallback a Nodemailer SMTP. Despacho post-commit, no bloqueante ante contingencias de red.

---

## 2. ARQUITECTURA TÉCNICA FINAL

```
┌────────────────────────────────────────────────────────────────────────┐
│                        TIENDA FRONTEND (Vite / React 19)              │
│  - Multi-brand Context (Looser Fit / Looser Sport)                    │
│  - SPA SEO Meta Tags + robots.txt restrictivo                         │
│  - Checkout Seguro + Botón de Arrepentimiento (Disp. 954/2025)        │
│  - Visualizador de Comprobantes (Imágenes + PDF)                      │
│  - Panel Admin (/admin) con aislamiento de marca                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTPS (JSON / Multipart)
┌───────────────────────────────────▼────────────────────────────────────┐
│                    TIENDA BACKEND (Node.js v24 / Express 5)           │
│  ├── Middleware:                                                       │
│  │   ├── brandMiddleware (resolución obligatoria ?brand=fit|sport)    │
│  │   ├── authMiddleware (protect, adminOnly, optionalAuth)             │
│  │   └── trackRateLimiter (30 req/min por IP anti-enumeración)        │
│  ├── Controllers & Services:                                          │
│  │   ├── orderService (congelación snapshot, shipping rates fijos)   │
│  │   ├── paymentRoutes (HMAC-SHA256, MP API fetch, idempotencia)       │
│  │   ├── arrepentimientoService (código ARR-YYYY-XXXXX, Disp 3/2026)  │
│  │   ├── productService / categoryService (control mutación cruzada)  │
│  │   └── userService (registerFromOrder con validación de guestToken) │
│  └── Storage & Crypto:                                                 │
│      ├── storage.js (Magic Bytes: JPEG, PNG, WebP, PDF / ImageKit)    │
│      └── mpSignature.js (crypto.timingSafeEqual, anti-replay)         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Mongoose ODM v9
┌───────────────────────────────────▼────────────────────────────────────┐
│                      MONGODB DATABASE (Atlas / Memory)                │
│  ├── Transacciones nativas multi-documento (isReplicaSetDeployment)   │
│  ├── Counter (secuencias atómicas $inc para Order y Arrepentimiento) │
│  └── Índices compuestos: brand+deleted+createdAt, usuario+deleted     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. DETALLE DE MÓDULOS Y GARANTÍAS IMPLEMENTADAS

### 3.1. Mercado Pago & Procesamiento de Pagos (F3)
- **`POST /api/payments/create-preference`:**
  - Requiere propiedad legítima: valida que el solicitante sea el dueño de la orden (`req.user.id === order.usuario`), un administrador o un invitado con `X-Guest-Token === order.trackingToken`.
  - Los ítems de la preferencia se generan **únicamente desde el snapshot de la orden** en la base de datos (`order.productos` + `order.shippingCost`), validando que la suma de centavos sea idéntica a `order.total`.
  - Verifica stock disponible en catálogo antes de emitir la preferencia.
  - Almacena `mpPreferenceId` en la orden para trazabilidad.
- **`POST /api/payments/webhook`:**
  - **Firma criptográfica:** Si `MP_WEBHOOK_SECRET` está configurado, valida obligatoriamente `x-signature` y `x-request-id` usando HMAC-SHA256 con `crypto.timingSafeEqual`. Rechaza con 401 si la firma no coincide o si el timestamp difiere por más de 300 segundos (defensa anti-replay).
  - **Consulta Autorizada:** Consulta a la API oficial de Mercado Pago (`GET /v1/payments/:id`) con `MP_ACCESS_TOKEN`.
  - **Validación de Identidad y Moneda:** Comprueba que `external_reference == order._id`, que `currency_id === 'ARS'` y que el monto abonado coincida exactamente con `order.total`. En caso de discrepancia, registra la alerta en `order.stockAlert` sin acreditar la orden.
  - **Idempotencia:** Si un webhook llega duplicado para un pago ya procesado (`order.mpPaymentId === paymentId`), responde `200 OK` de inmediato sin decrementar stock adicional. Si un segundo pago distinto intenta pagar una orden ya saldada, se marca anomalía en `order.stockAlert`.
  - **Transacción Atómica de Stock:** En producción (MongoDB Atlas ReplicaSet), ejecuta una sesión transaccional nativa (`session.startTransaction()`). Si cualquier producto no cuenta con stock suficiente, se aborta la transacción limpiamente (`abortTransaction()`), se marca alerta en la orden y no se corrompe el inventario. En entornos standalone, aplica decremento atómico condicional `$inc` con rollback seguro.
  - **Emails Post-Commit:** Los correos de confirmación de pago (`enviarEmailPagoAprobado` y notificación al administrador) se despachan estrictamente después del commit exitoso de la transacción.

### 3.2. Gestión de Pedidos, Checkout y Envíos (F1, F2, F4)
- **Separación Estricta Guest vs Usuario vs Admin:**
  - `POST /api/orders/create`: Protegido con `optionalAuth`. Si el usuario tiene una sesión iniciada (Bearer token válido), la orden se asocia automáticamente a su cuenta (`order.usuario = req.user.id`). Si no está autenticado, la orden queda como invitado (`usuario: null`). El parámetro `usuario` enviado en el body es ignorado para evitar spoofing.
  - `GET /api/orders/:id`: Administradores tienen acceso irrestricto; usuarios registrados solo pueden ver sus propias órdenes; invitados deben suministrar el header `x-guest-token` coincidente con `order.trackingToken`.
- **Precios e Inmutabilidad:**
  - Los precios de los productos se extraen del catálogo de la base de datos al momento de crear la orden (incluyendo `precioOferta` si existe). La orden guarda un snapshot histórico de los productos y precios.
- **Tarifas de Envío Autoritativas:**
  - Definidas centralizadamente en `src/constants/shipping.js`: `$7.500` (sucursal) y `$11.000` (domicilio). Expuestas públicamente en `GET /api/orders/shipping-rates`.
  - El backend rechaza modalidades de envío ajenas a `sucursal` o `domicilio`.
  - Validaciones específicas por modalidad: envío a domicilio exige `calleNumero` y `localidad`; retiro en sucursal exige `direccionSucursal`. DNI para Correo Argentino normalizado a 7 u 8 dígitos numéricos.
- **Contador Secuencial Atómico:**
  - Generación de números de orden `#001`, `#002` mediante `Counter.findOneAndUpdate` con `$inc: { seq: 1 }` y `upsert: true`. Cero riesgo de race conditions o colisiones; no depende de `countDocuments()`.
- **Registro Post-Compra Seguro (`registerFromOrder`):**
  - Exige que el email de registro coincida con `order.datosEnvio.email`.
  - Si la orden es de invitado y tiene `trackingToken`, valida que el cliente posea el token para prevenir apropiaciones maliciosas de pedidos.

### 3.3. Seguimiento Público (DTO Mínimo)
- **`GET /api/orders/track/:token`:**
  - Diseñado conforme al principio de mínima exposición de datos privados.
  - **DTO público:** Devuelve únicamente `orderNumber`, `estado`, `tipoEnvio`, `trackingNumber`, `productos`, `total`, `createdAt` y datos de envío sanitizados (`nombreCompleto: "Juan P."`, `dni: "***5678"`, `calleNumero: "Av. Corrientes ***"`, `localidad`, `provincia`).
  - **Supresión total:** No expone `trackingToken`, `usuario`, `comprobante`, `email`, `telefono`, `mpPaymentId`, `mpPreferenceId`, notas internas ni alertas administrativas.
  - **Rate Limiting:** Middleware en memoria limitando a 30 consultas por minuto por dirección IP para impedir ataques de fuerza bruta o escaneo de tokens.

### 3.4. Almacenamiento y Protección de Comprobantes
- **Formatos y Magic Bytes:**
  - Acepta imágenes (`image/jpeg`, `image/png`, `image/webp`) y documentos bancarios (`application/pdf`).
  - Validación física de cabecera de archivo en memoria:
    - JPEG: `FF D8 FF`
    - PNG: `89 50 4E 47 0D 0A 1A 0A`
    - WebP: `RIFF` ... `WEBP`
    - PDF: `%PDF` (`25 50 44 46`)
  - Archivos con extensión manipulada o payloads maliciosos son rechazados inmediatamente con 400.
  - Nombres seguros generados en backend: `comprobante_<orderId>_<timestamp>.<ext>`.
- **Acceso Protegido:**
  - Nuevo endpoint `GET /api/orders/:id/comprobante` con middleware `verifyOrderComprobanteAccess`: solo accesible por administradores, por el usuario dueño de la cuenta, o por el invitado con `X-Guest-Token`.
  - La URL del comprobante no se entrega en el endpoint público de seguimiento.
  - Interfaz de frontend (`PedidoExito` y `AdminPedido`) adaptada para previsualizar imágenes o renderizar enlaces directos de descarga para comprobantes PDF.

### 3.5. Aislamiento Multi-Marca (Fit vs Sport)
- **Resolución de Marca:** Middleware `detectBrand` en todas las rutas públicas (`/api/products`, `/api/categories`, `/api/home`). Fallback seguro a `'fit'`.
- **Protección de Mutaciones Cruzadas:**
  - En `productController` (`updateProduct`, `deleteProduct`, `toggleProductVisibility`, `toggleProductDrop`): si el producto pertenece a una marca distinta a la del administrador activo, se bloquea la operación con `403 Forbidden`.
  - En `categoryController` (`updateCategory`, `deleteCategory`): validación análoga.
  - En `homeService` (`updateFeatured`): los productos destacados se filtran para garantizar que pertenezcan a la marca correspondiente.
  - En `orderService` (`getAllOrders`): soporte de filtrado server-side por `query.brand`.

### 3.6. Derecho de Arrepentimiento Legal (F5)
- **Marco Normativo Vigente:** Adaptado estrictamente a la **Disposición 954/2025** y **Disposición 3/2026** de la Subsecretaría de Defensa del Consumidor y Lealtad Comercial (erradicando la derogada Res. 424/2020).
- **Persistencia y Trazabilidad:**
  - Modelo `Arrepentimiento` en MongoDB.
  - Identificador único generado por Counter: `ARR-YYYY-XXXXX`.
  - Endpoint público `POST /api/arrepentimientos`: no requiere autenticación previa.
  - Verificación razonable de identidad (Disp. 3/2026): si la orden existe en base de datos, valida coincidencia con el email original de compra sin revelar información sensible.
  - Envío automático de constancia oficial por correo al consumidor (`enviarEmailArrepentimiento`).
  - Panel administrativo dedicado en `/admin/arrepentimientos` para auditoría, notas de resolución y cambio de estados (`Recibido`, `EnRevision`, `Procesado`, `Rechazado`).

### 3.7. SEO y Rutas Privadas
- `robots.txt`: Reglas explícitas `Disallow` para `/admin`, `/admin/*`, `/seguimiento`, `/seguimiento/*`, `/pedido-exito`, `/pedido-exito/*`, `/checkout`, `/mi-cuenta`, `/mis-pedidos`.
- Metadatos dinámicos por marca administrados a través de `BrandContext` (título del documento y `meta[name="description"]`).

---

## 4. SUITE DE PRUEBAS AUTOMATIZADAS (84/84 PASSING)

| Suite de Test | Archivo | Casos | Estado |
| :--- | :--- | :---: | :---: |
| **F3: Pagos, Stock e Idempotencia** | `f3-payment-stock-idempotency.test.js` | 9 | **PASS** |
| **F5: Arrepentimiento Legal** | `f5-arrepentimiento.test.js` | 8 | **PASS** |
| **F2: Concurrencia y Counter** | `f2-counter-concurrency.test.js` | 7 | **PASS** |
| **F4: DNI Postal y Multi-Marca** | `f4-dni-brand-isolation.test.js` | 6 | **PASS** |
| **F1: Seguridad de Pedidos y Uploads** | `security-orders.test.js` | 16 | **PASS** |
| **Auth y Propiedad de Órdenes** | `h11-order-auth.test.js` | 3 | **PASS** |
| **URLs y Enlaces en Emails** | `h12-email-url.test.js` | 3 | **PASS** |
| **Plantillas y Resend API** | `resend-templates.test.js` | 8 | **PASS** |
| **Caracterización y Guarda Base** | `characterization.test.js` | 6 | **PASS** |
| **Penetración y Ataques Adversariales** | `adversarial-security.test.js` | 18 | **PASS** |
| **TOTAL GENERAL** | **10 Suites** | **84 Tests** | **100% PASS** |

---

## 5. VARIABLES DE ENTORNO Y REQUISITOS EXTERNOS

### Variables de Entorno del Backend (`tienda-backend/.env`):
```ini
# Base de datos (MongoDB Atlas)
MONGO_URI=mongodb+srv://<usuario>:<password>@<cluster>.mongodb.net/<dbname>?retryWrites=true&w=majority

# Seguridad JWT
JWT_SECRET=<clave_secreta_aleatoria_minimo_32_caracteres>

# Mercado Pago
MP_PUBLIC_KEY=APP_USR-<public-key>
MP_ACCESS_TOKEN=APP_USR-<access-token>
MP_WEBHOOK_SECRET=<webhook-secret-generado-en-dashboard-mp>

# Almacenamiento (ImageKit)
IMAGEKIT_PUBLIC_KEY=<imagekit-public-key>
IMAGEKIT_PRIVATE_KEY=<imagekit-private-key>
IMAGEKIT_URL_ENDPOINT=https://ik.imagekit.io/<tu-endpoint>

# Emails Transaccionales (Resend)
RESEND_API_KEY=re_<resend-api-key>
EMAIL_FROM="Looser Fit" <pedidos@looserfit.com>
EMAIL_USER=looserfit2004@gmail.com
EMAIL_PASS=<app-password-gmail-fallback>

# URLs de Despliegue
SITE_FRONTEND_URL=https://www.looserfit.com
FRONTEND_URL=https://www.looserfit.com
BACKEND_URL=https://api.looserfit.com
```

### Configuración Externa Pendiente (Pre-Lanzamiento Producción):
1. **Mercado Pago Producción:**
   - Crear una aplicación productiva en el panel de desarrolladores de Mercado Pago.
   - Configurar la URL del webhook: `https://<backend-url>/api/payments/webhook`.
   - Obtener y configurar el `MP_WEBHOOK_SECRET` para validación HMAC-SHA256.
   - Activar credenciales de producción (`APP_USR-...`).
2. **Resend (Verificación de Dominio):**
   - En `resend.com/domains`, registrar `looserfit.com` y configurar los registros DNS (DKIM, SPF y MX) provistos.
   - Hasta que el dominio esté verificado, Resend en modo de prueba solo permite enviar correos a la dirección del titular de la cuenta.
3. **Plataformas de Hospedaje (Render / Vercel):**
   - Cargar las variables de entorno correspondientes en los dashboards de Render (backend) y Vercel (frontend).
   - Configurar los dominios personalizados (`looserfit.com` y `api.looserfit.com`) con sus respectivos registros DNS tipo A y CNAME.

---

## 6. RIESGOS RESIDUALES EXPLÍCITOS

1. **Gaps en la Numeración Secuencial de Pedidos:** Por diseño de alta concurrencia, si una orden falla durante la validación de stock o si se aborta, el número reservado en `Counter` no se reutiliza para evitar condiciones de carrera. Esto es un estándar operativo seguro en e-commerce.
2. **CDN de Comprobantes:** Los comprobantes almacenados en ImageKit utilizan nombres aleatorios irreproducibles con hashes únicos (`comprobante_<orderId>_<timestamp>_<hash>.<ext>`), y el backend no expone estas URLs públicamente. Para una privacidad absoluta a nivel de infraestructura, se recomienda configurar la carpeta `looserfit_comprobantes` como privada en la consola de ImageKit.
3. **Persistencia Standalone vs ReplicaSet en Tests:** En producción con MongoDB Atlas (ReplicaSet), las transacciones son nativas multi-documento ACID. En entornos de test locales en memoria (MongoDB standalone), el motor conmuta automáticamente a operaciones atómicas con guarda condicional.
