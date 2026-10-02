# FINAL PRODUCTION CHECKLIST — LOOSERFIT WEB PLATFORM
**Versión:** 2.0.0-PROD-READY  
**Fecha de Emisión:** 2 de Octubre, 2026  
**Clasificación:** Guía Operativa de Despliegue y Puesta en Producción  

---

## 1. CÓDIGO
**Estado:** **PASS**

* [x] **Backend Unit & Integration Tests**: 84 tests ejecutados y aprobados (10/10 suites). Incluye suite adversarial completa de 18 pruebas críticas (`tests/adversarial-security.test.js`).
* [x] **Backend Linter**: 0 errores, 0 advertencias (`npm run lint` limpio).
* [x] **Frontend Linter**: 0 errores, 0 advertencias (`npm run lint` limpio con reglas estrictas de hooks).
* [x] **Frontend Production Build**: Compilación exitosa con Vite en modo producción (`npm run build` genera bundle optimizado sin errores).
* [x] **Servidor como Autoridad**: Cálculo de precios, subtotales y costos de envío centralizados en el backend; frontend no puede manipular montos.
* [x] **Formatos de Comprobante**: Frontend y backend alineados para aceptar JPEG, PNG, WebP y PDF (`application/pdf`), con validación de Magic Bytes binarios.
* [x] **Aislamiento Multi-Brand**: Controladores administrativos y servicios bloquean accesos o modificaciones cruzadas entre marcas (`fit` vs `sport`).
* [x] **Protección de Datos Personales (PII)**: DTO de tracking implementado; datos del comprador enmascarados y sin exposición de tokens ni recibos.
* [x] **Control de Concurrencia**: Numeración secuencial atómica con `Counter.findOneAndUpdate` y deducción atómica de stock mediante transacciones ACID de MongoDB.

---

## 2. BASE DE DATOS
**Estado:** **PASS**

* [x] **Índices de Alto Rendimiento**:
  * Colección `Order`: Índice compuesto `{ usuario: 1, deleted: 1, createdAt: -1 }` para optimizar consultas de pedidos personales.
  * Colección `Order`: Índice único `{ orderNumber: 1 }` e índice secundario `{ trackingToken: 1 }`.
  * Colección `Product`: Índice compuesto `{ brand: 1, createdAt: -1 }` para filtrado eficiente por marca.
  * Colección `Counter`: Índice único `{ _id: 1 }` para sincronización atómica.
* [x] **Consistencia de Datos Existentes**:
  * Esquema de pedidos soporta compatibilidad hacia atrás (`productos` e `items`).
  * Los registros existentes no han sido alterados ni reseteados.
  * Colección `Arrepentimiento` configurada con relaciones inmutables a `Order`.

---

## 3. VARIABLES DE ENTORNO
**Acción requerida:** **CONFIGURAR**

Las siguientes variables deben configurarse en los entornos de producción (Render y Vercel). No utilizar valores de desarrollo ni credenciales de prueba.

### Backend (Servicio en Render)
* [ ] `NODE_ENV=production`
* [ ] `PORT=10000`
* [ ] `MONGO_URI` (URI de conexión a clúster de MongoDB Atlas con TLS/SSL habilitado).
* [ ] `JWT_SECRET` (Cadena aleatoria de alta entropía, mínimo 64 caracteres).
* [ ] `MP_ACCESS_TOKEN` (Access Token de producción obtenido de Mercado Pago Developers).
* [ ] `MP_WEBHOOK_SECRET` (Secret del webhook configurado en el panel de desarrollador de Mercado Pago).
* [ ] `IMAGEKIT_PUBLIC_KEY` (Clave pública de ImageKit.io para carga de comprobantes).
* [ ] `IMAGEKIT_PRIVATE_KEY` (Clave privada de ImageKit.io).
* [ ] `IMAGEKIT_URL_ENDPOINT` (URL endpoint asignado por ImageKit, e.g. `https://ik.imagekit.io/looserfit`).
* [ ] `RESEND_API_KEY` (Clave de API de producción de Resend, formato `re_...`).
* [ ] `RESEND_FROM_EMAIL` (Dirección remitente con dominio verificado, e.g. `LooserFit <pedidos@looserfit.com>`).
* [ ] `ADMIN_EMAIL` (Correo electrónico del administrador para notificaciones de pagos y solicitudes de arrepentimiento).
* [ ] `FRONTEND_URL_FIT` (URL pública de producción de la tienda Fit, e.g. `https://looserfit.com`).
* [ ] `FRONTEND_URL_SPORT` (URL pública de producción de la tienda Sport, e.g. `https://sport.looserfit.com`).

### Frontend (Proyecto en Vercel)
* [ ] `VITE_API_BASE_URL` (URL de la API backend en Render, e.g. `https://api.looserfit.com`).
* [ ] `VITE_MP_PUBLIC_KEY` (Public Key de producción de Mercado Pago).

---

## 4. MERCADO PAGO
**Acción requerida:** **CONFIGURAR / VERIFICAR**

* [ ] **Homologación de Cuenta**: Verificar que la cuenta de Mercado Pago tenga completada la homologación comercial para operar con cobros reales en Argentina.
* [ ] **Credenciales de Producción**: Reemplazar credenciales de sandbox por el `Access Token` y `Public Key` productivos.
* [ ] **Configuración del Webhook**:
  * Ingresar al panel de Mercado Pago Developers -> Notificaciones Webhooks.
  * Registrar la URL de producción: `https://api.looserfit.com/api/payments/webhook`.
  * Suscribir al evento: **Pagos (payment)**.
  * Copiar la clave secreta de firma de webhook y asignarla a la variable `MP_WEBHOOK_SECRET` en Render.
* [ ] **Validación de Firma**: Realizar un pago de prueba de bajo monto para verificar que la cabecera `x-signature` sea validada exitosamente por el backend.

---

## 5. RESEND (SERVICIO DE EMAILS)
**Acción requerida:** **CONFIGURAR / VERIFICAR**

* [ ] **Creación de Cuenta**: Crear cuenta corporativa en [resend.com](https://resend.com).
* [ ] **Registro de Dominio**: Agregar el dominio `looserfit.com` en el panel de dominios de Resend.
* [ ] **Registros DNS para Correo**:
  * Configurar registros DKIM (claves TXT generadas por Resend).
  * Configurar registro SPF: `v=spf1 include:resend.com ~all`.
  * Configurar registro DMARC: `v=DMARC1; p=none; rua=mailto:dmarc-reports@looserfit.com`.
* [ ] **Verificación de Dominio**: Confirmar estado "Verified" en el dashboard de Resend.
  * *Nota crítica:* Mientras el dominio no esté verificado, Resend solo enviará correos al email del titular de la cuenta, bloqueando notificaciones a clientes.
* [ ] **Generación de API Key**: Generar clave con permisos "Full Access" y configurar en variable `RESEND_API_KEY`.

---

## 6. RENDER (HOSTING DEL BACKEND)
**Acción requerida:** **CONFIGURAR / VERIFICAR**

* [ ] **Creación de Web Service**:
  * Repositorio conectado a la rama `main`.
  * Root Directory: `tienda-backend`.
  * Runtime: Node.js (Node 20 LTS o superior).
  * Build Command: `npm install`.
  * Start Command: `npm start` (o `node src/index.js`).
* [ ] **Configuración de Variables de Entorno**: Cargar las 13 variables de backend documentadas en la Sección 3.
* [ ] **Health Check Path**: Configurar `/api/orders/shipping-rates` como ruta de chequeo de salud para reinicio automático ante caídas.
* [ ] **Dominio Personalizado**: Configurar `api.looserfit.com` y validar emisión de certificado TLS Let's Encrypt automático.
* [ ] **Plan y Recursos**: Seleccionar mínimo plan "Starter" para evitar suspensiones por inactividad ("cold starts") que degraden la recepción de webhooks de Mercado Pago.

---

## 7. VERCEL (HOSTING DEL FRONTEND)
**Acción requerida:** **CONFIGURAR / VERIFICAR**

* [ ] **Creación del Proyecto**:
  * Conectar repositorio a la rama `main`.
  * Framework Preset: **Vite**.
  * Root Directory: `tienda-frontend`.
  * Build Command: `npm run build`.
  * Output Directory: `dist`.
* [ ] **Configuración de SPA Routing**:
  * Verificar presencia de archivo `vercel.json` con la regla de reescritura para rutas cliente:
    ```json
    {
      "rewrites": [
        { "source": "/(.*)", "destination": "/index.html" }
      ]
    }
    ```
* [ ] **Configuración de Variables de Entorno**: Cargar `VITE_API_BASE_URL` y `VITE_MP_PUBLIC_KEY`.
* [ ] **Asignación de Dominios**:
  * Dominio principal: `looserfit.com` (con redirección automática de `www.looserfit.com`).
  * Dominio secundario: `sport.looserfit.com` apuntando al mismo build frontend (el contexto de marca se resuelve por hostname).

---

## 8. DNS (SISTEMA DE NOMBRES DE DOMINIO)
**Acción requerida:** **CONFIGURAR / VERIFICAR**

* [ ] **Registros Frontend (Vercel)**:
  * Registro **A** para `@` (raíz): `76.76.21.21` (Vercel Anycast IP).
  * Registro **CNAME** para `www`: `cname.vercel-dns.com`.
  * Registro **CNAME** para `sport`: `cname.vercel-dns.com`.
* [ ] **Registros Backend (Render)**:
  * Registro **CNAME** para `api`: apuntando a la dirección provista por Render (e.g., `looserfit-backend.onrender.com`).
* [ ] **Registros Email (Resend)**:
  * CNAMEs para selector DKIM (`resend._domainkey.looserfit.com`).
  * TXT para SPF y DMARC.
