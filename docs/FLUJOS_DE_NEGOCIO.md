# Flujos de Negocio y Reglas de Integración — Cobrix

Este documento describe con detalle las reglas de negocio, los procesos de importación, la conciliación de pagos, las modalidades de simulación frente a ejecución real y el funcionamiento del planificador diario (`SyncScheduler`).

---

## 1. El ciclo completo de aceptación

El enunciado (`docs/ENUNCIADO.md` §5) define un ciclo completo de aceptación basado en cuatro etapas consecutivas:

```text
 1. IMPORTACIÓN INICIAL           2. VERIFICACIÓN Y CAJA           3. ACTUALIZACIÓN DE PAGOS        4. IDEMPOTENCIA FINAL
 ┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
 │ ImportService           │      │ Simulador ISP (Swagger) │      │ PaymentSyncService      │      │ Reintentos de ambas     │
 │ Consulta cuotas ISP     │ ───► │ POST /__sim/pagar       │ ───► │ Consulta libro de pagos │ ───► │ 0 facturas nuevas       │
 │ Crea 20 clientes y      │      │ Registra cobros en      │      │ Marca 8 facturas pagadas│      │ 0 cambios adicionales   │
 │ 42 facturas (USD 1.235) │      │ contratos de prueba     │      │ 34 abiertas (USD 955,00)│      │ Estado intacto          │
 └─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

### Tabla de resultados del ciclo de aceptación

| Etapa | Acción | Entidades y montos resultantes | Dónde se verifica |
|---|---|---|---|
| **1. Simular importación** | Botón «Simular importación» o `POST /api/sync/import` con `isSimulation: true`. | 42 cuotas evaluadas como importables; **0 clientes y 0 facturas creadas** en base de datos. Se crea 1 registro en `sync_run` (simulación). | `/sincronizacion` e historial de corridas. |
| **2. Importar real** | Botón «Importar cuotas» o `POST /api/sync/import` con `isSimulation: false`. | **20 clientes creados**, **42 facturas abiertas** por un monto total de **USD 1.235,00**. Exclusiones: 9 cuotas por estado del contrato, 1 contrato por moneda incoherente (Jorge Castillo), 1 cuota por saldo residual. | `/` (Dashboard), `/clientes` y `/sincronizacion`. |
| **3. Reimportar** | Segunda importación real. | **0 facturas nuevas**, 42 facturas marcadas como `ALREADY_IMPORTED`. | Detalle de corrida (`/sincronizacion/corridas/:id`). |
| **4. Pagar en caja ISP** | Operaciones en el simulador del ISP (`http://127.0.0.1:4310/docs`):<br>• Ana Pérez (900101): paga toda la deuda.<br>• Luis Gómez (900103): abono de $25 (cuotas de 20).<br>• Comercial El Faro (900104): paga toda la deuda.<br>• Miguel Ángel Soto (900114): abono de $70.<br>• Elena Ruiz (900113): pagar y luego anular cobro. | El simulador del ISP registra facturas de cobro en su libro de cuotas y pagos. Cobrix permanece sin cambios hasta sincronizar. | `data/billing-api.sqlite` / Swagger. |
| **5. Actualizar pagadas** | Botón «Actualizar pagadas» o `POST /api/sync/payments`. | **8 facturas marcadas como pagadas**, quedando **34 facturas abiertas por USD 955,00**.<br>• Ana Pérez: 3 pagadas.<br>• Luis Gómez: 1 pagada, 1 abierta como abono parcial.<br>• Comercial El Faro: 2 pagadas.<br>• Miguel Ángel Soto: 2 cuotas más viejas pagadas.<br>• Elena Ruiz: facturas siguen abiertas (anulación). | Dashboard, `/clientes` y `/sincronizacion`. |
| **6. Reintentar pagos** | Segunda actualización de pagos. | 0 cambios adicionales; las 8 facturas continúan pagadas y las 34 abiertas. | Historial de sincronización. |

*Verificado en código y pruebas:* Todo este flujo está automatizado de punta a punta en `test/cobrix/system-coherence.test.ts`.

---

## 2. Reglas de normalización de clientes e identificación

Ubicado en `src/cobrix/domain/identification.ts`:

1. **Agrupación por titular:**
   - Un cliente por identificación única del titular (`identificacion_contrato`). Si un titular posee múltiples contratos (por ejemplo, Luis Gómez con dos contratos en distintas sucursales), todos los contratos y facturas se agrupan en el mismo cliente en Cobrix.
2. **Formato normalizado:**
   - La identificación se limpia eliminando guiones, espacios, puntos y ceros a la izquierda en el número.
   - Letra de tipo de documento opcional: `V`, `E`, `J`, `G`, `P`.
   - Longitud numérica válida: entre 6 y 12 dígitos.
   - Ejemplos de normalización:
     - `V-12345678` → `V12345678`
     - `09000123` → `9000123`
     - `j-00123456-7` → `J1234567`
3. **Clasificación de persona:**
   - Si la letra es `J` o `G` → `JURIDICA`.
   - Si la letra es `V`, `E`, `P` o carece de letra → `NATURAL`.
4. **Descarte defensivo:**
   - Contratos con números de menos de 6 dígitos, más de 12 dígitos o caracteres no válidos se descartan (`INVALID_IDENTIFICATION`).

---

## 3. Reglas de importación de facturas

Ubicado en `src/cobrix/sync/import-service.ts`:

1. **Descarte de cuotas sin deuda (`deuda_id: "0"`):**
   - La API del ISP emite una fila ficticia con `deuda_id: "0"` y `deuda: 0` cuando el contrato no debe nada. Esta fila se descarta siempre (`NO_DEBT_ROW`).
2. **Saldo residual:**
   - Cuotas con saldo menor o igual a 0 (`deuda <= 0`, menos de un centavo de dólar) no se importan (`ZERO_DEBT_ROW`).
3. **Estados de contrato importables:**
   - Se validan contra la lista configurada en `config.importable_statuses` (por defecto: `ACTIVO,CORTADO`). Cuotas de contratos en estado `CORTESIA`, `RETIRADO`, `RECHAZADO` o `ANULADO` se excluyen (`EXCLUDED_STATUS`).
4. **Validación de moneda coherente:**
   - Si la API del ISP reporta la cuota en `moneda_sigla: "USD"`, pero el monto de la cuota frente al precio del plan contratado es inferior al 1% (por ejemplo, reporta $0,15 para un plan de $25,00), se descarta el contrato completo por inconsistencia monetaria (`INCOHERENT_CURRENCY`).
5. **Periodo y fecha de vencimiento:**
   - Se extraen de la cadena descriptiva `detalle_deuda` (ej. `'PLAN15MB25 - 2026 Agosto'` → periodo `2026-08`, fecha de vencimiento `2026-08-01`).
   - La fecha de corte se calcula como: `corte = vencimiento + grace_days`.
6. **Ventana de importación (`window_months`):**
   - Si está configurada (3, 6, 9 o 12 meses), solo se admiten cuotas cuyo periodo sea mayor o igual al periodo actual menos N meses. Las cuotas más antiguas quedan excluidas (`OUTSIDE_WINDOW`).
7. **Límite de cuotas recientes (`max_recent_installments`):**
   - Si está configurado (1 a 60), por cada contrato se conservan únicamente las N cuotas más recientes según su periodo cronológico. Las excedentes quedan excluidas (`EXCEEDS_RECENT_LIMIT`).
8. **Topes por corrida (`run_invoice_limit` y `run_amount_limit_cents`):**
   - Si una corrida alcanza el número máximo de facturas nuevas o el monto acumulado en USD configurado, la corrida se frena (`runHalted = true`) y las cuotas restantes quedan catalogadas como `HALTED_BY_LIMIT` sin escribirse en base de datos.
9. **Idempotencia estructural:**
   - Cada cuota posee un ID externo único en el ISP (`deuda_id`). Si ya existe en la tabla `invoice`, se clasifica como `ALREADY_IMPORTED` y no se duplica.

---

## 4. Reglas de conciliación de facturas pagadas

Ubicado en `src/cobrix/sync/payment-sync-service.ts`:

1. **Selección de facturas a conciliar:**
   - Se consultan todas las facturas de Cobrix con `status = 'OPEN'`.
   - Se agrupan por `contract_id` y se determina el rango de fechas entre la cuota más antigua abierta y la fecha actual del sistema.
2. **Consulta al libro de pagos del ISP (`pago_informacion`):**
   - Se consulta el libro del ISP con `tipo_busqueda=CUOTA`.
3. **Criterios de clasificación:**
   - **Pago completo (`PAID`):**
     - Todas las filas del libro vinculadas a esa cuota son coherentes entre sí.
     - El saldo reportado en el ISP es exactamente cero (`saldo_cuota === 0`).
     - Existe evidencia real de pago (`valor_pago > 0` o cobro asociado).
     - *Acción en Cobrix:* La factura pasa a `status = 'PAID'`, `balance_cents = 0`, se registra la fecha de pago y el número de factura con que el ISP cobró (`isp_payment_invoice`). Se genera un evento `INVOICE_PAID` en el expediente del cliente.
   - **Abono parcial (`PARTIAL_PAYMENT`):**
     - La cuota tiene saldo reportado mayor a cero, pero dicho saldo es estrictamente menor al balance registrado en Cobrix (`saldoISP < balanceCobrix`).
     - *Acción en Cobrix:* La factura **continúa abierta** (`status = 'OPEN'`) para exigir el cobro del saldo restante. Se registra un evento `PARTIAL_PAYMENT` en el expediente y se detalla en la auditoría de la corrida.
   - **Exoneración (`EXONERATED`):**
     - La cuota reporta saldo cero pero sin ningún monto pagado (`valor_pago === 0`).
     - *Acción en Cobrix:* **No se marca pagada**. Una exoneración no equivale a un cobro financiero.
   - **Ausencia de evidencia (`NO_EVIDENCE`):**
     - La cuota no aparece en el libro de pagos ni en la lista de pendientes del contrato.
     - *Acción en Cobrix:* La factura **continúa abierta** (`status = 'OPEN'`). Por política de seguridad contable, nunca se asume un pago sin evidencia positiva.
   - **Cuota del mes corriente:**
     - Si la cuota pertenece al mes en curso y no figura en el libro de pagos (comportamiento documentado de la API del ISP), el servicio consulta las cuotas pendientes del contrato como mecanismo de respaldo antes de catalogarla.

---

## 5. Simulación frente a operación real

| Comportamiento | Simulación (`isSimulation: true`) | Operación Real (`isSimulation: false`) |
|---|---|---|
| **Llamadas HTTP a la API del ISP** | Realiza las consultas completas a la API del ISP (`/lista_ids_contratos`, `/contrato/individual`, `/pago_informacion`). | Realiza las consultas completas a la API del ISP. |
| **Evaluación de reglas de negocio** | Aplica el 100% de los filtros, validaciones, normalizaciones y cálculos de balance. | Aplica el 100% de los filtros, validaciones, normalizaciones y cálculos de balance. |
| **Mutaciones en tablas de clientes y contratos** | **Ninguna**. No se insertan ni modifican registros en `customer` ni `contract`. | Se insertan clientes nuevos y contratos actualizados. |
| **Mutaciones en facturas** | **Ninguna**. No se insertan facturas abiertas ni se marcan facturas como pagadas. | Se insertan facturas abiertas o se marcan como `PAID`. |
| **Eventos de auditoría de clientes** | **Ninguno**. No se crean eventos en `customer_event`. | Se registran eventos de factura creada o factura pagada. |
| **Persistencia de la corrida** | **Sí se persiste** en `sync_run` (`is_simulation = 1`) y en `sync_run_detail`. | **Sí se persiste** en `sync_run` (`is_simulation = 0`) y en `sync_run_detail`. |
| **Visualización en interfaz** | Se lista en el historial con badge ámbar «Simulación». | Se lista en el historial con badge esmeralda «Real». Modifica los contadores del Dashboard. |

---

## 6. Planificador diario (`SyncScheduler`) y trazabilidad

Ubicado en `src/cobrix/scheduler/sync-scheduler.ts`:

### 6.1 Parámetros de ejecución
- **Intervalo de sondeo (Tick):** 30 segundos.
- **Zona horaria civil:** `America/Caracas` (UTC-4), calculada de manera independiente al reloj estático de pruebas `SANDBOX_TODAY`.
- **Hora configurada:** Leída en caliente desde la persistencia (`config.auto_run_hour`, por defecto `04:00`).
- **Activación:** Controlada por `config.auto_run_active` (booleano).

### 6.2 Condiciones para ejecutar el ciclo
El planificador dispara la sincronización automática si y solo si se cumplen todas estas condiciones:
1. `config.auto_run_active === true`.
2. La hora civil actual en Caracas es mayor o igual a `config.auto_run_hour` (`currentTime >= autoRunHour`).
3. El ciclo no ha sido completado ni ha fallado en la fecha civil de hoy (`last_auto_run_date !== todayDate` o estado previo en `RUNNING` que amerita recuperación).
4. No existe una sincronización manual activa (`!isSyncRunning()`).
5. No hay otro tick del scheduler en progreso (`!this.isTickRunning`).

### 6.3 Secuencia automática y fallos parciales
La función `executeScheduledFullSync` ejecuta de forma indivisible:
1. **Fase 1: Importar cuotas** con `triggerType: 'SCHEDULED'`.
2. Si la importación finaliza con `status !== 'COMPLETED'` (fallida):
   - Se registra `config.last_auto_run_status = 'FAILED'`.
   - **Se aborta el ciclo** y no se ejecuta la conciliación de pagos.
3. Si la importación culmina con `COMPLETED`:
   - **Fase 2: Conciliación de pagos** con `triggerType: 'SCHEDULED'`.
   - Si la conciliación culmina con éxito, se registra `config.last_auto_run_status = 'COMPLETED'`.
   - Si la conciliación falla, se registra `config.last_auto_run_status = 'FAILED'`.
4. El cerrojo `SyncLock` permanece tomado durante ambas fases para garantizar que ninguna sincronización manual se interponga entre la importación y los pagos.

### 6.4 Trazabilidad de ejecuciones
- **Origen explícito:** Todas las corridas registran en la columna `trigger_type` de la tabla `sync_run` si fueron disparadas manualmente (`MANUAL`) o por el planificador (`SCHEDULED`).
- **Historial:** En la interfaz web (`/sincronizacion`), la tabla de historial incluye la columna **Origen** con badges distintivos:
  - `Automática`: Badge color índigo.
  - `Manual`: Badge color pizarra (slate).
- **Dashboard:** La tarjeta de empresa en el Dashboard muestra en todo momento la fecha y el estado de la última corrida automática:
  - *Ejemplo:* `Última ejecución: 16/10/2026 · Completada` (o `Fallida` / `En ejecución` / `Nunca ejecutada`).
