# Arquitectura del Sistema — Cobrix

Este documento detalla la arquitectura de software, el modelo de datos, los contratos de la API REST interna y los componentes técnicos del proyecto Cobrix.

---

## 1. Visión general de la arquitectura

Cobrix opera como un sistema integrado que se comunica por HTTP con la API externa del administrador de facturas de un ISP para mantener al día clientes, contratos, facturas y pagos.

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React 19 SPA)                         │
│  Pages: Dashboard, Clientes, Expediente, Sincronización, Configuración │
│  Componentes UI (Tailwind CSS v4, Lucide Icons, React Router v7)       │
│  Cliente HTTP tipado: src/client/lib/api.ts                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / JSON (/api/*)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    BACKEND HTTP REST (Node.js 24)                      │
│  src/server/server-app.ts (Enrutamiento, Deserialización y Seguridad)  │
│  Controladores: config, customers, dashboard, sync, enunciado          │
│  Despachador de estáticos compilados: src/server/static-handler.ts     │
└───────┬───────────────────────────┬────────────────────────────┬───────┘
        │                           │                            │
        │ Cerrojo y orquestación    │ Consultas y DTOs           │
        ▼                           ▼                            │
┌───────────────────────────────┐ ┌──────────────────────────┐   │
│       PLANIFICADOR DIARIO     │ │   SERVICIOS DE LECTURA   │   │
│  - SyncScheduler (tick 30s)   │ │  - HistoryService        │   │
│  - Cerrojo en memoria (Lock)  │ │  - Dashboard / Dossier   │   │
│  - executeScheduledFullSync   │ └────────────┬─────────────┘   │
└───────┬───────────────────────┘              │                 │
        │                                      │                 │
        ▼                                      │                 │
┌──────────────────────────────────────────────┴─────────────┐   │
│                   SERVICIOS DE SINCRONIZACIÓN              │   │
│  - ImportService (importación de contratos y cuotas)       │   │
│  - PaymentSyncService (conciliación de facturas pagadas)   │   │
│  - Reglas de dominio: identification, money, installment   │   │
└───────┬──────────────────────────────────────────────┬─────┘   │
        │ HTTP / Bearer JWT (puerto 4310)              │         │
        ▼                                              ▼         ▼
┌───────────────────────────────┐              ┌─────────────────────────┐
│       BillingApiClient        │              │   REPOSITORIOS SQLITE   │
│  (API del ISP - Puerto 4310)  │              │   (node:sqlite nativo)  │
│  - POST /usuario/login        │              │  config, customer,      │
│  - GET /isp/lista_ids...      │              │  contract, invoice,     │
│  - GET /isp/contrato/...      │              │  sync_run, detail,      │
│  - GET /isp/pago_informacion  │              │  customer_event         │
└───────────────────────────────┘              └───────────┬─────────────┘
                                                           │
                                                           ▼
                                               ┌─────────────────────────┐
                                               │   data/cobrix.sqlite    │
                                               └─────────────────────────┘
```

---

## 2. Estructura modular del proyecto

- `src/main.ts`: Orquestador del proceso. Inicializa SQLite, levanta la API del ISP (puerto 4310), instancia e inicia el `SyncScheduler`, arranca la aplicación web (puerto 4300) y registra el apagado limpio (`SIGINT`, `SIGTERM`).
- `src/client/`: Aplicación cliente Single Page Application (SPA).
  - `pages/`: Vistas de negocio (`DashboardPage`, `CustomersPage`, `CustomerDossierPage`, `SyncPage`, `SyncRunDetailPage`, `ConfigPage`).
  - `components/`: Componentes modulares de interfaz y maquetación (`AppLayout`, `Sidebar`, `Header`, tarjetas, badges, modales).
  - `lib/api.ts`: Cliente HTTP para consumir los endpoints internos `/api/*` con validación estricta.
- `src/server/`: Servidor HTTP nativo de Cobrix y controladores de la API REST interna.
  - `server-app.ts`: Despachador de peticiones, parseo seguro de cuerpos JSON y códigos de estado HTTP.
  - `api/`: Controladores (`config-controller.ts`, `customers-controller.ts`, `dashboard-controller.ts`, `sync-controller.ts`, `enunciado-controller.ts`).
  - `static-handler.ts`: Servidor de estáticos optimizado con validación contra Path Traversal.
- `src/cobrix/`: Núcleo de la integración y lógica de negocio.
  - `client/`: Cliente HTTP `BillingApiClient` (autenticación JWT de 2 horas con renovación proactiva y parseo defensivo).
  - `db/`: Conexión de base de datos (`database.ts`), DDL canónico (`schema.ts`), repositorios de entidades (`repositories.ts`), migraciones y tipos (`types.ts`).
  - `domain/`: Reglas puras: normalización de RIFs/cédulas (`identification.ts`), dinero en centavos (`money.ts`) y cuotas (`installment.ts`).
  - `sync/`: Lógica orquestadora de sincronización (`import-service.ts`, `payment-sync-service.ts`).
  - `history/`: Servicios de consulta forense del historial y desgloses fila a fila (`history-service.ts`, `parsers.ts`).
  - `scheduler/`: Planificador periódico automático en `America/Caracas` (`sync-scheduler.ts`).
- `src/shared/`: Contratos de datos (DTOs) en `api-types.ts` y utilidades de fechas civiles en `dates.ts`.
- `src/billing-api/`: [Componente protegido] Simulador de la API del administrador del ISP, base de datos de prueba y Swagger en puerto 4310.

---

## 3. Base de datos y persistencia SQLite

La persistencia de Cobrix se implementa con el módulo nativo `node:sqlite` (`DatabaseSync`), almacenando los datos en `data/cobrix.sqlite` (separada por completo de `data/billing-api.sqlite`).

### Pragmas activos
- `PRAGMA foreign_keys = ON;`: Integridad referencial habilitada de forma obligatoria.
- `PRAGMA busy_timeout = 5000;`: Espera defensiva ante bloqueos concurrentes.

### Tablas y responsabilidades
1. **`config` (Configuración de empresa y proveedor):**
   - Fila única forzada por restricción `id INTEGER PRIMARY KEY CHECK (id = 1)`.
   - Almacena datos corporativos, credenciales del ISP (`api_url`, `api_username`, `api_password`), filtros de importación (`importable_statuses`, `window_months`, `max_recent_installments`, `grace_days`), topes (`run_invoice_limit`, `run_amount_limit_cents`), tipos excluidos (`excluded_document_types`) y estado del planificador (`auto_run_hour`, `auto_run_active`, `last_auto_run_date`, `last_auto_run_status`).
2. **`customer` (Directorio de clientes):**
   - `id TEXT PRIMARY KEY`: Identificador único normalizado (ej. `'V12345678'`, `'9000123'`).
   - `original_document`: Documento original recibido del ISP.
   - `document_type`: Letra de identificación (`V`, `E`, `J`, `G`, `P`) o `null`.
   - `person_type`: `NATURAL` o `JURIDICA`.
   - `name`, `phone`, `email`, `address`, `created_at`, `updated_at`.
3. **`contract` (Contratos del ISP asociados al cliente):**
   - `id INTEGER PRIMARY KEY`: ID numérico del contrato en el ISP.
   - `customer_id TEXT NOT NULL REFERENCES customer(id) ON UPDATE CASCADE ON DELETE RESTRICT`.
   - `code`, `status`, `plan`, `plan_price_cents`, `currency`, `billing_day`, `cutoff_day`, fechas.
4. **`invoice` (Facturas de Cobrix):**
   - `id INTEGER PRIMARY KEY AUTOINCREMENT`: ID secuencial interno.
   - `invoice_number TEXT NOT NULL UNIQUE`: Código legible Cobrix (`COB-000001`).
   - `external_debt_id TEXT NOT NULL UNIQUE`: ID de la cuota en el ISP (`deuda_id`). La restricción de unicidad garantiza idempotencia e impide duplicar facturas.
   - `contract_id` y `customer_id` con claves foráneas obligatorias.
   - `total_amount_cents INTEGER NOT NULL`, `balance_cents INTEGER NOT NULL`.
   - `status TEXT NOT NULL CHECK (status IN ('OPEN', 'PAID'))`.
   - `paid_at TEXT`, `isp_payment_invoice TEXT` (número de factura con que el ISP cobró).
5. **`sync_run` (Cabecera de ejecuciones de sincronización):**
   - `id TEXT PRIMARY KEY`: UUID de la corrida.
   - `type TEXT NOT NULL CHECK (type IN ('IMPORT', 'PAYMENT_UPDATE'))`.
   - `trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'SCHEDULED'))`.
   - `is_simulation INTEGER NOT NULL CHECK (is_simulation IN (0, 1))`.
   - `status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED'))`.
   - `started_at`, `finished_at`, `error_message`, `summary_json`.
6. **`sync_run_detail` (Detalle cuota a cuota de cada corrida):**
   - `run_id TEXT NOT NULL REFERENCES sync_run(id) ON DELETE CASCADE`.
   - `contract_id`, `debt_id`, `period`, `amount_cents`, `result` (`IMPORTED`, `EXCLUDED_STATUS`, `PAID`, `PARTIAL_PAYMENT`, etc.) y `reason` explicativo.
7. **`customer_event` (Línea de tiempo del expediente):**
   - Auditoría de hitos del cliente: `CUSTOMER_CREATED`, `INVOICE_IMPORTED`, `INVOICE_PAID`, `PARTIAL_PAYMENT`.

### Transacciones e idempotencia
Las mutaciones se ejecutan atómicamente mediante `withTransaction(db, callback)`:
- Si una operación falla en el paso N, se ejecuta automáticamente `ROLLBACK`, preservando la consistencia de la base de datos.
- La inserción de facturas verifica la existencia previa de `external_debt_id`. Reintentar una importación marca las cuotas como `ALREADY_IMPORTED` sin crear registros duplicados.

### Migraciones automáticas no destructivas
Al invocar `createCobrixDatabase()`, se ejecutan de manera síncrona:
- `migrateConfigSchemaIfNeeded(db)`: Añade las columnas `last_auto_run_date` y `last_auto_run_status` a `config` si no existen.
- `migrateSyncRunSchemaIfNeeded(db)`: Añade la columna `trigger_type` a `sync_run` con `DEFAULT 'MANUAL'` si no existe.
Ambas funciones inspeccionan primero `PRAGMA table_info` para garantizar idempotencia total y conservar intactos los registros históricos.

---

## 4. Catálogo de la API REST interna de Cobrix

> **Aclaración importante:** La API interna de Cobrix (`/api/*`) sirve al panel web y a clientes autorizados. No debe confundirse con la API simulada del ISP (puerto 4310, documentada en `docs/API.md`). Cobrix no dispone de una interfaz Swagger/OpenAPI embebida para su propia API; su contrato formal está tipado en `src/shared/api-types.ts`.

### 4.1 Dashboard
- **`GET /api/dashboard`**
  - **Propósito:** Provee métricas globales agregadas, datos del proveedor y las 5 corridas más recientes.
  - **Respuesta `200 OK`:** `DashboardResponseDto` conteniendo `metrics` (clientes, contratos, facturas abiertas/pagadas, monto por cobrar en centavos), `company` (incluyendo `lastAutoRunDate` y `lastAutoRunStatus`) y `recentRuns` (con `triggerType: 'MANUAL' | 'SCHEDULED'`).
  - **Errores:** `500 Internal Server Error`.

### 4.2 Configuración
- **`GET /api/config`**
  - **Propósito:** Devuelve la configuración vigente de la empresa y del ISP.
  - **Seguridad:** Oprime o no expone el campo sensible `apiPassword`.
  - **Respuesta `200 OK`:** `ConfigResponseDto`.
- **`PUT /api/config`**
  - **Propósito:** Actualiza parámetros de configuración.
  - **Cuerpo JSON:** `UpdateConfigRequestDto` (campos opcionales). Si `apiPassword` se envía vacía o con solo espacios, se conserva la contraseña existente.
  - **Respuesta `200 OK`:** `ConfigResponseDto` actualizado.
  - **Errores:** `400 Bad Request` (validación de rangos, formatos de hora o JSON inválido), `409 Conflict` (si hay una sincronización en curso).
- **`POST /api/config/test-connection`**
  - **Propósito:** Prueba la autenticación y conectividad con la API del ISP sin persistir las credenciales.
  - **Cuerpo JSON:** `{ apiUrl?: string, apiUsername?: string, apiPassword?: string }`.
  - **Respuesta `200 OK`:** `{ success: boolean, totalContracts?: number, message: string }`.

### 4.3 Directorio y expediente de clientes
- **`GET /api/customers`**
  - **Propósito:** Lista los clientes importados con métricas consolidadas por cliente.
  - **Parámetros Query:** `?search=texto` (opcional, filtra insensible a mayúsculas por nombre, documento original o RIF normalizado).
  - **Respuesta `200 OK`:** `CustomerListResponseDto` (`totalCount`, arreglo de `CustomerListItemDto` ordenados alfabéticamente por nombre).
- **`GET /api/customers/:id`**
  - **Propósito:** Expediente completo de un cliente específico.
  - **Parámetros Path:** `:id` (identificador normalizado, ej. `V12345678`).
  - **Respuesta `200 OK`:** `CustomerDossierResponseDto` conteniendo `customer`, `metrics`, `contracts`, `invoices` y `events`.
  - **Errores:** `404 Not Found` (cliente inexistente).

### 4.4 Sincronización e Historial
- **`POST /api/sync/import`**
  - **Propósito:** Dispara una importación manual de contratos y cuotas pendientes.
  - **Cuerpo JSON:** `{"isSimulation": boolean}`.
  - **Respuesta `200 OK`:** `SyncRunItemDto` (`id`, `type: 'IMPORT'`, `triggerType: 'MANUAL'`, `status: 'COMPLETED'`, `summary`).
  - **Errores:** `400 Bad Request` (payload inválido), `409 Conflict` (bloqueo en memoria activo).
- **`POST /api/sync/payments`**
  - **Propósito:** Dispara una actualización manual de facturas pagadas contra el ISP.
  - **Cuerpo JSON:** `{"isSimulation": boolean}`.
  - **Respuesta `200 OK`:** `SyncRunItemDto` (`id`, `type: 'PAYMENT_UPDATE'`, `triggerType: 'MANUAL'`, `status: 'COMPLETED'`, `summary`).
  - **Errores:** `400 Bad Request`, `409 Conflict`.
- **`GET /api/sync/runs`**
  - **Propósito:** Historial cronológico inverso de ejecuciones.
  - **Parámetros Query:** `?limit=N` (número entre 1 y 100, defecto 20).
  - **Respuesta `200 OK`:** `SyncRunListResponseDto` (cada ítem incluye `triggerType: 'MANUAL' | 'SCHEDULED'`).
- **`GET /api/sync/runs/:id`**
  - **Propósito:** Detalle forense de una corrida con desglose fila a fila.
  - **Parámetros Path:** `:id` (UUID de la corrida).
  - **Respuesta `200 OK`:** `SyncRunDetailResponseDto` (`run` con resumen y `details` con cada cuota inspeccionada).
  - **Errores:** `404 Not Found`.

---

## 5. Integración con la API externa del ISP

El módulo `BillingApiClient` (`src/cobrix/client/billing-api-client.ts`) gestiona la comunicación con la API del ISP:

### 5.1 Autenticación y ciclo de tokens
- Realiza `POST /api/v1/usuario/login` con credenciales configuradas.
- La API del ISP emite un JWT con duración estricta de 2 horas (7.200 s) y sin mecanismo de refresh token.
- `BillingApiClient` almacena el token en memoria y monitorea su expiración. Si faltan menos de 60 segundos para vencer, solicita automáticamente un nuevo token antes de ejecutar peticiones de negocio.

### 5.2 Manejo de rarezas y respuestas del ISP
- **Paginación ficticia:** En `/isp/lista_ids_contratos`, la API del ISP ignora los parámetros de paginación y filtra contratos activos si se envía el campo `estado`. `BillingApiClient` no envía el parámetro `estado` para recibir todos los contratos existentes.
- **Fila centinela sin deuda:** En `/isp/contrato/individual`, si el cliente no debe nada, el ISP devuelve una fila con `deuda_id: "0"` y `deuda: 0`. Se descarta inmediatamente.
- **`success: false` con datos:** En `/isp/pago_informacion`, la API del ISP responde con `success: false` incluso cuando entrega registros válidos en `data`. El cliente evalúa la presencia de datos y no el flag booleano.
- **Fechas ingenuas (Naive UTC):** Las marcas temporales del ISP vienen sin indicación de zona (`2026-10-13T10:00:00`). Se interpretan de forma determinista para evitar desfases horarios locales.

---

## 6. Concurrencia y límites del sistema

### 6.1 Cerrojo en memoria (`SyncLock`)
- Las funciones `acquireSyncLock()` y `releaseSyncLock()` en `src/server/api/sync-controller.ts` implementan exclusión mutua mediante una bandera en memoria (`isSyncLocked`).
- **Límites reales:** Es una solución de alta eficiencia para un único proceso de Node.js. Si la aplicación se desplegara en múltiples réplicas o pods simultáneos sobre la misma base SQLite, se requeriría un cerrojo distribuido (ej. Redis/Redlock o locks mediante tablas de control transaccionales en base de datos).

### 6.2 Planificador periódico (`SyncScheduler`)
- El scheduler evalúa cada 30 segundos si corresponde ejecutar el ciclo diario automático basándose en la fecha civil de Caracas (`America/Caracas`).
- La bandera `isTickRunning` previene reentrancia si un tick se extiende en el tiempo.
- Garantiza prevención de duplicados diarios (`ALREADY_COMPLETED_TODAY`), pero no constituye una garantía de entrega exactly-once distribuida.

---

## 7. Gestión de credenciales y seguridad

- **Contraseñas del ISP:** Se almacenan en la tabla `config` de SQLite. Nunca se imprimen en logs del sistema ni se devuelven en peticiones HTTP públicas (`GET /api/config` las omite).
- **Protección contra Path Traversal:** El despachador de archivos estáticos (`src/server/static-handler.ts`) normaliza las rutas y rechaza cualquier solicitud que intente escapar de `dist/client/`.
- **Inyección SQL:** Todas las consultas en repositorios utilizan sentencias preparadas parametrizadas de SQLite (`db.prepare('... WHERE id = ?').run(val)`), imposibilitando ataques de inyección SQL.
