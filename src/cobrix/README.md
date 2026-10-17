# Núcleo de Integración y Dominio — Cobrix (`src/cobrix`)

Este directorio contiene el núcleo de negocio, persistencia, sincronización, integración y planificación automática de Cobrix.

---

## Estructura de submódulos

```text
src/cobrix/
├── client/        # Cliente HTTP contra la API del administrador del ISP
├── db/            # Base de datos SQLite nativa, esquemas, repositorios y migraciones
├── domain/        # Modelos y reglas puras de negocio (identificación, dinero, cuotas)
├── history/       # Servicios de auditoría, parseo tipado y consulta de historial
├── scheduler/     # Planificador diario periódico en America/Caracas
└── sync/          # Servicios de importación de contratos y conciliación de pagos
```

### 1. `client/` — Integración HTTP con el ISP
- Implementa `BillingApiClient` para comunicarse con la API de facturación externa (`POST /api/v1/usuario/login`, `GET /api/v1/isp/lista_ids_contratos`, `GET /api/v1/isp/contrato/individual`, `GET /api/v1/isp/pago_informacion`).
- Administra el ciclo de vida de los tokens JWT de 2 horas con renovación automática proactiva antes de expirar.
- Valida de forma defensiva las respuestas JSON mediante guardas de tipos estrictas (`validators.ts`) sin utilizar `any` ni `unknown`.

### 2. `db/` — Persistencia y Repositorios SQLite
- Gestiona la base de datos `data/cobrix.sqlite` mediante el módulo nativo `node:sqlite` de Node.js 24 (`database.ts`).
- Define el esquema relacional canónico (`schema.ts`) con claves primarias, foráneas, índices de alto rendimiento y restricciones CHECK.
- Implementa repositorios tipados (`configRepository`, `customerRepository`, `contractRepository`, `invoiceRepository`, `syncRunRepository`, `customerEventRepository`).
- Ejecuta migraciones idempotentes y no destructivas (`migrateConfigSchemaIfNeeded`, `migrateSyncRunSchemaIfNeeded`) para compatibilidad retroactiva.

### 3. `domain/` — Lógica pura de dominio
- **Identificación (`identification.ts`):** Normalización de cédulas y RIFs venezolanos (V, E, J, G, P), clasificación en persona natural o jurídica, y descarte de documentos inválidos.
- **Moneda (`money.ts`):** Manejo estricto de montos en centavos enteros (`cents`), formateo a dólares USD y operaciones aritméticas inmunes a errores de coma flotante.
- **Cuotas (`installment.ts`):** Parseo de periodos y vencimientos a partir de descriptores textuales del ISP (`'PLAN - 2026 Agosto'`).

### 4. `sync/` — Servicios de Sincronización
- **`ImportService`:** Recorre los contratos del ISP, aplica filtros de negocio (estados permitidos, moneda coherente, ventana de meses, cuotas recientes, topes por corrida), agrupa por titular y persiste atómicamente clientes y facturas abiertas.
- **`PaymentSyncService`:** Lee facturas abiertas, consulta el libro de pagos del ISP y clasifica conservadoramente pagos totales, abonos parciales, exoneraciones o ausencia de evidencia.
- Ambos servicios admiten el modo simulación (`isSimulation: true`) y el registro explícito del origen del disparador (`triggerType: 'MANUAL' | 'SCHEDULED'`).

### 5. `history/` — Historial y Auditoría
- Provee `HistoryService` para consultar corridas de sincronización agregadas y desgloses detallados fila a fila (`sync_run_detail`).
- Mapea de forma segura los resúmenes serializados en JSON mediante validadores estrictos (`parsers.ts`).

### 6. `scheduler/` — Planificador Diario Automático
- `SyncScheduler`: Temporizador de sondeo de 30 segundos desacoplado (`.unref()`).
- Calcula determinísticamente la fecha y hora civil de `America/Caracas` (`UTC-4`).
- Orquesta la secuencia `Importar → Actualizar pagadas` bajo el cerrojo global en memoria (`SyncLock`).
- Previene ticks simultáneos y duplicados en el mismo día civil.

---

## Documentación complementaria
Para más detalles sobre los flujos y la arquitectura, consulta:
- Arquitectura general: [`docs/ARQUITECTURA.md`](../../docs/ARQUITECTURA.md)
- Flujos de negocio: [`docs/FLUJOS_DE_NEGOCIO.md`](../../docs/FLUJOS_DE_NEGOCIO.md)
- Decisiones técnicas: [`docs/DECISIONES_TECNICAS.md`](../../docs/DECISIONES_TECNICAS.md)
