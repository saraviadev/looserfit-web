# F2_PRECHECK_ORDER_DATA.md — Snapshot y Reconciliación de MongoDB Atlas

**Fecha:** 1 de Octubre de 2026
**Objetivo:** Reconciliación real de la base de datos de producción (MongoDB Atlas) antes de inicializar `Counter.js` e índice UNIQUE para la Fase 2.
**Entorno auditado:** MongoDB Atlas (`cluster0.zjz5osn.mongodb.net`)
**Base de datos:** `losserfit`
**Colección auditada:** `orders`

---

## 1. Métricas Cuantitativas de la Colección `orders`

| Métrica | Valor Confirmado | Notas de Auditoría |
| :--- | :--- | :--- |
| **Total de Documentos** | **22** | Coincide con la auditoría de Fase 0.5. |
| **Órdenes Activas** | **22** | `deleted: false` o `deleted: { $ne: true }`. |
| **Órdenes Eliminadas (Soft-Delete)** | **0** | Ningún documento tiene `deleted: true`. |
| **Órdenes Restauradas** | **0** | No se registraron eventos previos de restauración. |
| **Órdenes sin `orderNumber`** | **0** | Todos los 22 documentos poseen el campo presente y con valor. |
| **Duplicados Reales** | **0** | Ningún `orderNumber` se encuentra repetido. |
| **Formatos Inválidos** | **0** | Todos los 22 valores cumplen estrictamente con la máscara `#\d{3}`. |
| **Mínimo Numérico** | **1** (`#001`) | Primera orden registrada en la plataforma. |
| **Máximo Numérico Real** | **27** (`#027`) | Calculado numéricamente parseando `#\d+` a entero (evitando sesgo lexicográfico). |
| **Huecos Detectados (Gaps)** | **5** | `#003`, `#005`, `#006`, `#021`, `#024`. |

---

## 2. Detalle Exhaustivo de Identificadores Existentes

Los 22 números de orden persistidos actualmente son:
```text
#001, #002, #004, #007, #008, #009, #010, #011, #012, #013, #014,
#015, #016, #017, #018, #019, #020, #022, #023, #025, #026, #027
```

Valores numéricos ordenados de forma ascendente:
`[1, 2, 4, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 25, 26, 27]`

---

## 3. Estado de la Colección `counters`

* **Documentos existentes:** 0 (colección vacía o aún no instanciada).
* **Documento a instanciar:** `{ _id: 'orderNumber', seq: 27 }`.
* **Próxima orden generada:** `#028` (`seq + 1`).

---

## 4. Estado de Índices en la Colección `orders`

Inspección realizada con `db.collection('orders').indexes()`:

1. `_id_` (`_id: 1`)
2. `orderNumber_1` (`orderNumber: 1`, `unique: true`) — **Confirmado activo**.
3. `trackingToken_1` (`trackingToken: 1`, `unique: true`) — **Confirmado activo**.
4. `brand_1_createdAt_-1` (`brand: 1, createdAt: -1`)
5. `deleted_1` (`deleted: 1`)
6. `brand_1_deleted_1_createdAt_-1` (`brand: 1, deleted: 1, createdAt: -1`)

---

## 5. Conclusiones y Autorización para Fase 2

1. **Riesgo de colisión:** Nulo. Al estar confirmado el máximo numérico real en `27`, inicializar el contador atómico con `seq = 27` garantiza que las subsecuentes creaciones concurrentes operen desde `#028` sin colisionar con órdenes históricas.
2. **Índice UNIQUE:** Ya se encuentra establecido y activo en Atlas. Dado que no existen duplicados ni órdenes huérfanas sin `orderNumber`, el índice opera de manera segura como red de contención ante cualquier intento anómalo.
