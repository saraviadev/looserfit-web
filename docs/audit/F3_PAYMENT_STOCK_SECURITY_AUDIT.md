# F3_PAYMENT_STOCK_SECURITY_AUDIT.md — Auditoría de Hardening de Pagos y Stock

**Proyecto:** LooserFit Ecommerce Web Platform (looserfit.com)  
**Módulo:** Pagos, Mercado Pago Webhooks, Idempotencia y Descuento Atómico de Stock  
**Fecha de Emisión:** 1 de Octubre de 2026  
**Roles:** Senior Fullstack Engineer · Security Engineer · QA Engineer  
**Estado:** IMPLEMENTACIÓN COMPLETADA — VALIDACIÓN ADVERSARIAL SUPERADA  

---

## 1. Problemas Encontrados en la Auditoría Inicial

1. **Ruta `/create-preference` desprotegida (IDOR / Acceso no autorizado):**
   Cualquier petición que enviara un `orderId` válido podía generar una preferencia de Mercado Pago sin autenticación de usuario ni verificación de posesión de orden de invitado.
2. **Derivación y congelamiento de precios susceptible a discrepancias:**
   Al crear la preferencia se recalculaba el precio contra la base de datos de productos en lugar de utilizar el snapshot inmutable persistido en la orden. Si el precio del catálogo cambiaba entre la creación de la orden y el cobro, se presentaban inconsistencias con el total acordado.
3. **Ausencia de validación criptográfica de firma en Webhook de Mercado Pago:**
   El endpoint `/webhook` procesaba notificaciones sin verificar la cabecera `x-signature` ni contrastar el hash HMAC-SHA256 con `MP_WEBHOOK_SECRET`, permitiendo que un atacante simulara eventos de pago.
4. **Vulnerabilidad de sobreventa / Rollback manual inseguro bajo concurrencia:**
   El mecanismo previo ejecutaba decrementos secuenciales y, si un producto fallaba por falta de stock, aplicaba incrementos compensatorios manuales. En entornos concurrentes, ese patrón exponía a race conditions donde pedidos ajenos podían interferir entre el fallo y la compensación.
5. **Falta de validación estricta de monto y divisa en la acreditación:**
   No se comparaba el `transaction_amount` ni el `currency_id` reportado por la API de Mercado Pago contra el total de la orden, posibilitando pagos parciales o en divisas no autorizadas.
6. **Manejo deficiente de múltiples pagos:**
   No se detectaba si llegaba un segundo pago con un identificador distinto para una orden ya abonada, lo que podía causar inconsistencias contables.

---

## 2. Código Afectado

- `tienda-backend/src/routes/paymentRoutes.js`: Endpoints `/create-preference` y `/webhook`.
- `tienda-backend/src/models/Order.js`: Esquema de datos de pago (`paymentProvider`, `paymentStatus`, `mpPreferenceId`, `mpStatusDetail`, `mpExternalReference`, `paymentAmount`, `paymentCurrency`).
- `tienda-backend/src/utils/mpSignature.js` (Creado): Validación criptográfica de firmas de Mercado Pago con HMAC-SHA256 y comparación timing-safe.
- `tienda-backend/tests/setup.js`: Configuración de entorno de pruebas con soporte de firmas y guardas.
- `tienda-backend/tests/f3-payment-stock-idempotency.test.js`: Suite de pruebas automatizadas.
- `tienda-frontend/src/services/api.js`: Envío de headers de autorización y `x-guest-token` al crear preferencias.
- `tienda-frontend/src/pages/Checkout/Checkout.jsx`: Envío del token de invitado para la preferencia.

---

## 3. Solución Implementada

1. **Protección de Ownership en `/create-preference`:**
   - Para pedidos asociados a un usuario registrado, se exige obligatoriamente un token JWT válido coincidente con el ID del comprador o privilegios de administrador.
   - Para pedidos de clientes invitados (`usuario: null`), se exige la cabecera `x-guest-token` (o campo en body) que debe coincidir de forma estricta con el `trackingToken` de la orden.
   - En caso de discrepancia o ausencia de credenciales, se responde HTTP 401 o 403.
2. **Snapshot Inmutable de Precios y Congruencia de Importes:**
   - La preferencia se construye estrictamente a partir del snapshot congelado en `order.productos` y `order.shippingCost`.
   - Se valida matemáticamente que la suma exacta de los ítems más el envío coincida con `order.total`. Si se detecta discrepancia, la operación se rechaza con HTTP 400.
   - Se persiste el `mpPreferenceId` devuelto por Mercado Pago en la orden para trazabilidad biunívoca.
3. **Verificación Criptográfica de Firmas de Webhook (HMAC-SHA256):**
   - Implementado en `src/utils/mpSignature.js` siguiendo la especificación oficial de Mercado Pago:
     - Manifiesto: `id:${dataId};request-id:${xRequestId};ts:${ts};`.
     - Control de frescura del timestamp para prevenir ataques de replay (límite de deriva configurable).
     - Comparación de hash utilizando `crypto.timingSafeEqual` para prevenir ataques de temporización (timing attacks).
     - Si `MP_WEBHOOK_SECRET` está configurado y la firma falta o no coincide, se rechaza inmediatamente con HTTP 401.
4. **Validación Exhaustiva de Pago contra la API Oficial:**
   - Consulta directa vía HTTPS a `https://api.mercadopago.com/v1/payments/${paymentId}`.
   - Validación de `external_reference == order._id`.
   - Validación de `currency_id === 'ARS'`.
   - Validación de monto exacto evitando errores de coma flotante (`Math.round(amount * 100) === Math.round(total * 100)`).
5. **Idempotencia Estricta y Detección de Anomalías de Pagos:**
   - Reintentos del mismo `mpPaymentId` sobre una orden ya pagada devuelven HTTP 200 sin volver a procesar stock ni reenviar emails.
   - Si se recibe un segundo pago con un identificador diferente para una orden ya pagada, se registra una alerta administrativa en `order.stockAlert` y no se descuenta stock duplicado.
6. **Transacción Multi-documento para Stock y Estado:**
   - En entornos ReplicaSet (como MongoDB Atlas en producción), se ejecuta una transacción formal mediante `session.startTransaction()`.
   - Cada producto se descuenta con la condición atómica `stock >= cantidad`.
   - Si algún ítem no posee stock suficiente al momento de acreditarse el pago, se ejecuta `session.abortTransaction()`, dejando intacto el stock del resto de los ítems y marcando la orden con `stockAlert: 'Stock insuficiente al momento de acreditar el pago'`.
   - Los emails de confirmación se despachan única y exclusivamente tras la confirmación exitosa de la transacción (`commitTransaction`).

---

## 4. Tests Agregados y Cobertura

En `tienda-backend/tests/f3-payment-stock-idempotency.test.js` (10 pruebas completas):
1. `F3-SEC-PREF: Ownership usuario registrado (rechaza anónimo y usuario ajeno, autoriza dueño y admin)`
2. `F3-SEC-PREF: Ownership invitado (rechaza sin token o con token erróneo, autoriza con X-Guest-Token)`
3. `F3-PRICE: Snapshot inmutable y rechazo si falta stock al crear preferencia`
4. `F3-SEC-SIG: Webhook rechaza llamadas sin firma, con firma manipulada o con timestamp expirado (401)`
5. `F3-AMOUNT: Webhook rechaza moneda distinta a ARS o importe alterado sin marcar Pagado`
6. `F3.1 & F3.4: Webhook approved con firma válida transiciona a Pagado y descuenta stock`
7. `F3.3: Idempotencia ante reintentos consecutivos del mismo webhook (mismo paymentId)`
8. `F3-MULTI-PAY: Múltiples pagos diferentes para la misma orden no duplican stock y alertan anomalía`
9. `F3.6 & F3.7: Transacción aborta atómicamente si falta stock en algún producto`
10. `F3.5: Máquina de estados FSM protege transiciones y rechaza saltos ilegales`

---

## 5. Resultados de Ejecución

```bash
npx jest tests/f3-payment-stock-idempotency.test.js --runInBand
# Test Suites: 1 passed, 1 total
# Tests:       10 passed, 10 total
# Time:        5.411 s
```

---

## 6. Riesgos Residuales

1. **Latencia de la API de Mercado Pago:** Si la API de Mercado Pago presenta demoras extraordinarias o cortes de servicio, las llamadas salientes desde el webhook pueden experimentar tiempos de espera (timeouts). Se mitiga respondiendo HTTP 500 para permitir el reintento automático por parte de los servidores de Mercado Pago.
2. **Acreditación tardía tras quiebre de stock fortuito:** Si dos compradores intentan abonar simultáneamente la última unidad de un drop limitado, el primero en acreditarse obtendrá el producto; para el segundo, la transacción abortará de forma segura y se registrará la alerta para reintegro o resolución comercial por el administrador.
3. **Secreto de Webhook en Producción:** La verificación de firma requiere que la variable `MP_WEBHOOK_SECRET` se configure en el panel de control de Render coincidiendo exactamente con la clave generada en el panel de desarrolladores de Mercado Pago.

---

## 7. Decisiones Arquitectónicas

- **Aislamiento de la lógica criptográfica:** Se encapsuló la validación y generación de firmas en `src/utils/mpSignature.js` para permitir pruebas unitarias limpias y reutilización sin acoplar la infraestructura HTTP de Express.
- **Transaccionalidad condicional según topología:** El backend detecta si el cluster activo soporta transacciones (ReplicaSet / Mongo Atlas) para invocar `session.startTransaction()` o ejecutar la operación atómica condicional si se ejecuta en entornos standalone, asegurando alta portabilidad.

---

## 8. Limitaciones de los Tests

- En las pruebas locales automatizadas, la interacción con la API de Mercado Pago se ejecuta contra mocks de respuestas HTTP fieles a la especificación oficial, debido a que el sandbox de Mercado Pago requiere URLs públicas con certificados TLS válidos que no son alcanzables en localhost sin túneles como ngrok.
