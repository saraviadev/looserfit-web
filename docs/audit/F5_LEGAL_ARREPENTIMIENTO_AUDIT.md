# F5_LEGAL_ARREPENTIMIENTO_AUDIT.md — Auditoría de Derecho de Arrepentimiento y Cumplimiento Normativo

**Proyecto:** LooserFit Ecommerce Web Platform (looserfit.com)  
**Módulo:** Botón de Arrepentimiento, Disposición 954/2025, Disposición 3/2026 y Ley N° 24.240  
**Fecha de Emisión:** 1 de Octubre de 2026  
**Roles:** Senior Fullstack Engineer · Compliance Engineer · QA Engineer  
**Estado:** IMPLEMENTACIÓN COMPLETADA — VALIDACIÓN ADVERSARIAL SUPERADA  

---

## 1. Problemas Encontrados en la Auditoría Inicial

1. **Persistencia local no oficial (`localStorage`):**
   La implementación previa almacenaba las solicitudes de arrepentimiento en el `localStorage` del navegador del cliente, sin base de datos en el backend, sin visibilidad en el panel de administración y sin garantías de preservación de datos.
2. **Generación aleatoria de código en el cliente:**
   El código identificador `ARR-2026-XXXXX` se generaba mediante `Math.random()` en JavaScript del frontend, sin unicidad demostrable ni persistencia centralizada.
3. **Citas a normativa derogada (Resolución 424/2020):**
   El pie de página y los modales citaban la Resolución 424/2020 de la Secretaría de Comercio Interior, la cual fue expresamente derogada y reemplazada por la **Disposición 954/2025** de la Subsecretaría de Defensa del Consumidor y Lealtad Comercial.
4. **Falta de endpoint público sin autenticación obligatoria:**
   La ley argentina exige que el botón de arrepentimiento sea de fácil acceso y que no se requiera registración previa ni inicio de sesión para ejercer el derecho de revocación.
5. **Ausencia de notificación por correo electrónico:**
   No se remitía al consumidor un correo de confirmación oficial con el código de trámite y las condiciones de revocación.
6. **Inexistencia de vista administrativa para seguimiento y resolución:**
   El panel de administración carecía de un módulo para auditar las solicitudes recibidas, gestionar su estado y dejar constancia de la resolución.

---

## 2. Código Afectado

- `tienda-backend/src/models/Arrepentimiento.js` (Creado): Modelo de datos para solicitudes de arrepentimiento.
- `tienda-backend/src/services/arrepentimientoService.js` (Creado): Lógica de negocio, validación y numeración secuencial.
- `tienda-backend/src/controllers/arrepentimientoController.js` (Creado): Controladores REST.
- `tienda-backend/src/routes/arrepentimientoRoutes.js` (Creado): Rutas públicas y administrativas.
- `tienda-backend/src/config/email.js`: Plantilla de correo oficial `enviarEmailArrepentimiento`.
- `tienda-backend/index.js`: Registro de la ruta `/api/arrepentimientos`.
- `tienda-backend/tests/f5-arrepentimiento.test.js` (Creado): Suite de pruebas automatizadas.
- `tienda-frontend/src/services/api.js`: Métodos de cliente para el botón de arrepentimiento.
- `tienda-frontend/src/components/Footer/Footer.jsx`: Eliminación de `localStorage`, submit real hacia el backend, actualización a Disposición 954/2025 y Disp. 3/2026.
- `tienda-frontend/src/pages/Admin/AdminArrepentimientos.jsx` (Creado): Vista administrativa en panel admin.
- `tienda-frontend/src/pages/Admin/AdminLayout.jsx`: Enlace e icono en barra de navegación de administración.
- `tienda-frontend/src/App.jsx`: Ruta protegida `/admin/arrepentimientos`.

---

## 3. Solución Implementada

1. **Modelo de Persistencia Oficial en MongoDB:**
   - Se creó la colección `arrepentimientos` en MongoDB con los campos:
     - `requestNumber`: Código secuencial atómico (ej: `ARR-2026-00001`), indexado y único.
     - `orderId`: Referencia a la orden si fue localizada.
     - `orderNumber`: Número visible del pedido.
     - `customerName`, `customerEmail`, `customerPhone`: Datos de contacto del solicitante.
     - `reason`, `message`: Motivo y comentarios de la solicitud.
     - `brand`, `brandSlug`: Aislamiento multimarca (`fit` o `sport`).
     - `status`: Ciclo de vida (`Recibido`, `EnRevision`, `Procesado`, `Rechazado`).
     - `resolutionNotes`, `resolvedAt`: Trazabilidad administrativa de la resolución.
2. **Generación Secuencial Atómica con `Counter.js`:**
   - La numeración oficial del trámite utiliza el modelo de contador atómico de MongoDB mediante `$inc` sobre el contador `arrepentimiento`.
   - Formato normativo: `ARR-YYYY-XXXXX` (ej: `ARR-2026-00001`), garantizando unicidad y orden cronológico estricto sin colisiones.
3. **Acceso Público Irrestricto y Validación Razonable de Identidad (Disp. 3/2026):**
   - El endpoint `POST /api/arrepentimientos` es accesible **sin necesidad de crear cuenta ni iniciar sesión**, en estricto cumplimiento del principio de facilidad de acceso.
   - Conforme a la **Disposición 3/2026**, se aplica una verificación razonable de identidad y seguridad:
     - Si el número de pedido ingresado existe en la base de datos, se valida que el correo electrónico ingresado coincida con el correo del pedido original.
     - Si hay discrepancia de correos, se rechaza la solicitud con HTTP 400 mediante un mensaje genérico que no filtra información personal ni detalles del pedido ajeno.
     - Si el pedido no se encuentra en la base de datos (por ejemplo, pedidos históricos previos o compras asistidas), la solicitud se registra igualmente con `orderId: null` para no menoscabar el derecho del consumidor a obtener su número de constancia.
4. **Despacho Automático de Correo Electrónico:**
   - Tras persistir exitosamente en la base de datos, se despacha un correo de confirmación al consumidor.
   - El correo detalla el código de identificación asignado, la fecha y hora de emisión, y cita la Disposición 954/2025, informando que el comercio tomará contacto dentro de las 24 horas hábiles.
   - El envío es asincrónico: si el servicio de correo experimenta demoras o fallos, la solicitud ya se encuentra firme y persistida en base de datos.
5. **Panel Administrativo Dedicado (`AdminArrepentimientos.jsx`):**
   - Vista protegida para administradores autenticados que permite auditar solicitudes, filtrar por estado (`Recibido`, `EnRevision`, `Procesado`, `Rechazado`) y marca, visualizar los datos de contacto y pedido, y actualizar el estado de resolución con notas internas.
6. **Actualización del Marco Normativo y Diferenciación Comercial:**
   - Se erradicaron todas las referencias a la derogada Resolución 424/2020 en el frontend.
   - Se actualizaron las referencias normativas a la **Disposición 954/2025** y **Disposición 3/2026** (Art. 34 de la Ley N° 24.240).
   - Se separó nítidamente el **derecho legal de revocación** (10 días corridos sin costo a partir de la entrega) de la **política voluntaria de cambios de talle/modelo** (15 días corridos).

---

## 4. Tests Agregados y Cobertura

En `tienda-backend/tests/f5-arrepentimiento.test.js` (5 pruebas exhaustivas):
1. `F5.1: Solicitud pública sin login obligatorio y persistencia en MongoDB (Disp. 954/2025)`
2. `F5.2: Generación atómica secuencial del código ARR-YYYY-XXXXX sin colisiones`
3. `F5.3: Validación razonable de identidad y seguridad sin fuga de PII (Disp. 3/2026)`
4. `F5.4: Validación de campos obligatorios (nombre, email válido, orden)`
5. `F5.5: Panel Administrativo, permisos de acceso y actualización de estados`

---

## 5. Resultados de Ejecución

```bash
npx jest tests/f5-arrepentimiento.test.js --runInBand
# Test Suites: 1 passed, 1 total
# Tests:       5 passed, 5 total
# Time:        2.744 s
```

---

## 6. Riesgos Residuales

1. **Gestión Operativa de los Reintegros:** El sistema registra, certifica y notifica la revocación de la compra emitiendo el código oficial. La posterior devolución física del producto y la reversión de fondos mediante Mercado Pago o transferencia bancaria deben ser gestionadas por el equipo de operaciones dentro de los plazos reglamentarios.
2. **Entregas de Correo a Dominios Sandbox:** Durante pruebas sin dominio propio verificado en el proveedor de email transaccional (Resend), los correos pueden ser restringidos a la cuenta de onboarding de prueba. En producción se debe verificar el dominio `looserfit.com` en Resend.

---

## 7. Decisiones Arquitectónicas

- **Persistencia en Modelo Dedicado vs. Campo en Order:** Se optó por una colección independiente `Arrepentimiento` para permitir registrar solicitudes incluso en casos donde el consumidor ingresa un identificador de pedido en revisión o con discrepancia tipográfica menor, sin alterar destructivamente el estado de la orden de compra antes de la intervención administrativa.
- **Numeración Secuencial Reutilizando Counter:** Se empleó la colección `counters` ya existente y validada en la Fase 2, garantizando coherencia en el diseño de persistencia de identificadores incrementales.
