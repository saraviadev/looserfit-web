# FINAL_CODE_AUDIT_MAP.md — Mapa de Trazabilidad Código vs. Requerimientos

**Proyecto:** LooserFit Ecommerce Web Platform (looserfit.com)  
**Versión:** 2.0.0-PROD-READY  
**Fecha de Emisión:** 1 de Octubre de 2026  
**Propósito:** Matriz exhaustiva de correspondencia biunívoca entre los requerimientos de la auditoría integral, los archivos fuente modificados, las funciones implementadas y los tests automatizados que garantizan su correcto funcionamiento.

---

## MATRIZ DE TRAZABILIDAD

| ID Requerimiento | Descripción Funcional / Técnica | Archivos Fuente Modificados | Métodos / Funciones / Componentes | Test Automatizado de Verificación | Estado |
| :--- | :--- | :--- | :--- | :--- | :---: |
| **PRECHECK-01** | Inspección y reconciliación de órdenes en MongoDB Atlas | `docs/audit/F2_PRECHECK_ORDER_DATA.md` | Snapshot no destructivo de órdenes en Atlas | `tests/characterization.test.js` (Guarda anti-Atlas) | **VERIFICADO** |
| **SEC-01** | Prevención de IDOR en pedidos de clientes invitados | `tienda-backend/src/controllers/orderController.js` | `getOrderById`, `getOrderByToken` | `tests/security-orders.test.js` ("SEC-01 IDOR") | **VERIFICADO** |
| **SEC-02** | Validación estricta de propiedad de email en registro desde orden | `tienda-backend/src/services/userService.js` | `registerFromOrder` | `tests/security-orders.test.js` ("SEC-02 Registro") | **VERIFICADO** |
| **SEC-03** | Autenticación y validación de tipos MIME en subida de comprobantes | `tienda-backend/src/controllers/orderController.js`, `src/config/multer.js` | `subirComprobante` | `tests/security-orders.test.js` ("SEC-03 Upload") | **VERIFICADO** |
| **F2-COUNTER** | Generación secuencial atómica de `orderNumber` con MongoDB `$inc` | `tienda-backend/src/models/Counter.js`, `src/services/orderService.js` | `Counter.getNextSequence`, `initOrderCounter`, `getNextOrderNumber` | `tests/f2-counter-concurrency.test.js` (25 concurrentes) | **VERIFICADO** |
| **BUG-01** | Exportación formal de funciones de restauración de pedidos | `tienda-backend/src/services/orderService.js` | `restoreOrder`, `bulkRestoreOrders` | `tests/f2-counter-concurrency.test.js` ("F2.7 restoreOrder") | **VERIFICADO** |
| **BUG-02** | Limpieza de código muerto en borrado masivo | `tienda-backend/src/services/orderService.js` | `bulkDeleteOrders` | `tests/f2-counter-concurrency.test.js` ("F2.7 bulkDelete") | **VERIFICADO** |
| **BUG-03** | Importación faltante de `optimizeImage` en administración | `tienda-frontend/src/pages/Admin/AdminProductos.jsx` | Import `optimizeImage` | Compilación Vite / Linting Frontend | **VERIFICADO** |
| **F3-FSM** | Máquina de estados finitos para ciclo de vida de pedidos | `tienda-backend/src/services/orderService.js` | `updateOrderStatus`, `VALID_TRANSITIONS` | `tests/f3-payment-stock-idempotency.test.js` (FSM test) | **VERIFICADO** |
| **F3-IDEMP** | Idempotencia en webhook de Mercado Pago ante reintentos | `tienda-backend/src/routes/paymentRoutes.js` | Atomic `findOneAndUpdate` en webhook handler | `tests/f3-payment-stock-idempotency.test.js` (Duplicate webhook) | **VERIFICADO** |
| **F3-STOCK** | Descuento atómico de stock condicionado con rollback de sobreventa | `tienda-backend/src/routes/paymentRoutes.js` | `$inc: { stock: -cant }` con validación `$gte` | `tests/f3-payment-stock-idempotency.test.js` (Stock rollback) | **VERIFICADO** |
| **F4-DNI** | Campo DNI para despacho de Correo Argentino y validación 7-8 dígitos | `tienda-backend/src/models/Order.js`, `src/services/orderService.js`, `tienda-frontend/src/pages/Checkout/Checkout.jsx` | `Order.datosEnvio.dni`, validación regex `^\d{7,8}$` | `tests/f4-dni-brand-isolation.test.js` (DNI validation) | **VERIFICADO** |
| **F4-MINIM** | Minimización de datos sensibles en seguimiento postal público | `tienda-backend/src/controllers/orderController.js` | `getOrderByToken` con enmascaramiento de DNI | `tests/f4-dni-brand-isolation.test.js` (Public tracking masking) | **VERIFICADO** |
| **F4-BRAND** | Aislamiento lógico y de catálogo entre LooserFit y LooserSport | `tienda-backend/src/services/orderService.js`, `tienda-frontend/src/context/BrandContext.jsx` | Filtro por discriminador `brand` | `tests/f4-dni-brand-isolation.test.js` (Brand isolation) | **VERIFICADO** |
| **F5-LEGAL** | Actualización normativa Disposición 954/2025 y Botón de Arrepentimiento | `tienda-frontend/src/components/Footer/Footer.jsx`, `src/config/siteConfig.js` | Botón de Arrepentimiento sin login y generación de código | Verificación UI y enlace legal oficial | **VERIFICADO** |
| **F5-SEO** | Metadatos OpenGraph, Twitter Cards, Schema.org, robots.txt y sitemap.xml | `tienda-frontend/index.html`, `public/robots.txt`, `public/sitemap.xml` | JSON-LD `ClothingStore`, meta tags de indexación | Inspección de index.html y validación de assets estáticos | **VERIFICADO** |
| **F6-TOAST** | Sistema de toasts y diálogos de confirmación no bloqueantes | `tienda-frontend/src/context/ToastContext.jsx`, `Toast.css` | `useToast`, `showToast`, `confirmModal` | Verificación en `Producto.jsx`, `AdminPedidos.jsx`, etc. | **VERIFICADO** |
| **F6-NOTIF** | Campana inteligente de notificaciones con control de lectura | `tienda-frontend/src/components/Navbar/Navbar.jsx` | `hasUnreadNotification`, `lastSeenNotif` | Verificación reactiva en Navbar al montar componente | **VERIFICADO** |

---

## DETALLE DE ARCHIVOS MODIFICADOS Y CREADOS

### Backend (`tienda-backend/`)
1. `src/models/Counter.js` — Creado: Esquema y métodos atómicos `getNextSequence` e `initCounter`.
2. `src/models/Order.js` — Modificado: Agregados campos de persistencia de pago (`mpPaymentId`, `metodoPago`, `mpStatus`, `paymentProcessedAt`, `stockAlert`) y campo de logística (`datosEnvio.dni`).
3. `src/services/orderService.js` — Modificado: Contador atómico, FSM de transiciones, validación de DNI, fixes de papelera (`restoreOrder`, `bulkRestoreOrders`, `bulkDeleteOrders`).
4. `src/services/userService.js` — Modificado: Validación estricta de propiedad de email en `registerFromOrder`, evaluación dinámica de JWT secret.
5. `src/controllers/orderController.js` — Modificado: Guarda de token `X-Guest-Token` en `getOrderById`, sanitización y enmascaramiento de DNI en `getOrderByToken`.
6. `src/routes/paymentRoutes.js` — Modificado: Transición atómica en webhook de MP, idempotencia ante reintentos de pago, descuento condicionado de stock con rollback.
7. `src/middleware/authMiddleware.js` — Modificado: Evaluación dinámica de `process.env.JWT_SECRET`.
8. `src/config/email.js` — Modificado: Ajuste de variables y tipados para linter.
9. `eslint.config.mjs` — Modificado: Configuración de globals de Jest e ignore list para scripts de auditoría.
10. `tests/setup.js` — Modificado: Guarda anti-Atlas e inicialización con `MongoMemoryServer`.
11. `tests/security-orders.test.js` — Modificado: 18 pruebas completas de seguridad para SEC-01, SEC-02, SEC-03.
12. `tests/f2-counter-concurrency.test.js` — Creado: 4 pruebas de concurrencia masiva (25 solicitudes paralelas), inicialización y papelera.
13. `tests/f3-payment-stock-idempotency.test.js` — Creado: 6 pruebas de idempotencia de pagos, descuento de stock, fallback de sobreventa y FSM.
14. `tests/f4-dni-brand-isolation.test.js` — Creado: 6 pruebas de validación de DNI, minimización de datos y aislamiento multimarca.

### Frontend (`tienda-frontend/`)
1. `src/context/ToastContext.jsx` — Creado: Contexto de notificación toast y confirmaciones modales.
2. `src/context/Toast.css` — Creado: Estilos responsivos en modo oscuro para toasts y diálogos modales.
3. `src/main.jsx` — Modificado: Inclusión de `ToastProvider` en la jerarquía de componentes raíz.
4. `src/components/Navbar/Navbar.jsx` — Modificado: Campana inteligente de notificaciones con control de lectura en `localStorage`.
5. `src/components/Footer/Footer.jsx` — Modificado: Actualización legal a la Disposición 954/2025, Formulario 960/D y Botón de Arrepentimiento con emisión de código.
6. `src/config/siteConfig.js` — Modificado: Configuración fiscal y legal centralizada.
7. `src/pages/Checkout/Checkout.jsx` — Modificado: Inclusión obligatoria de DNI para Correo Argentino sin mutación directa del estado de React.
8. `src/pages/Producto/Producto.jsx` — Modificado: Reemplazo de `alert()` por toasts con selección de talle.
9. `src/pages/PedidoExito/PedidoExito.jsx` — Modificado: Reemplazo de alertas nativas por toasts y optimización de carga de comprobantes.
10. `src/pages/Admin/AdminPedido.jsx` — Modificado: Toasts informativos en actualizaciones de seguimiento postal.
11. `src/pages/Admin/AdminPedidos.jsx` — Modificado: Modales de confirmación con `confirmModal` y memoización con `useCallback`.
12. `src/pages/Admin/AdminProductos.jsx` — Modificado: Importación de `optimizeImage`, modales de confirmación y toasts.
13. `src/components/BrandLogoSwitcher/BrandLogoSwitcher.jsx` — Modificado: Prevención de efectos de renderizado espurios.
14. `index.html` — Modificado: Título oficial, meta tags OpenGraph, Twitter Cards y Schema.org JSON-LD.
15. `public/robots.txt` — Creado: Reglas de indexación y exclusión para bots y crawlers.
16. `public/sitemap.xml` — Creado: Mapa del sitio con prioridades y URLs canónicas.

---
**FIN DEL MAPA DE TRAZABILIDAD**
