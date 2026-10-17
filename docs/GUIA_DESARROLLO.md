# Guía de Desarrollo, Operación y Pruebas — Cobrix

Esta guía práctica explica cómo instalar, compilar, ejecutar, probar y diagnosticar el proyecto Cobrix en entornos locales.

---

## 1. Requisitos previos

- **Node.js:** Versión `>= 24.0.0` (requerido para el soporte nativo de `node:sqlite`).
- **Gestor de paquetes:** `npm` (incluido con Node.js).
- **Sistema operativo:** Linux, macOS o Windows (con soporte para Node 24).
- **Navegador web moderno:** Chrome, Firefox, Edge o Safari con soporte ECMAScript moderno.

---

## 2. Instalación y arranque rápido

### 2.1 Clonación e instalación limpia
```bash
# 1. Instalar dependencias declaradas
npm install

# 2. Compilar el cliente web React para producción
npm run build

# 3. Iniciar el servidor unificado
npm start
```

### 2.2 Servicios y puertos predeterminados
Al ejecutar `npm start`, el proceso inicia dos servidores en paralelo:

| Servicio | URL Local | Descripción |
|---|---|---|
| **Panel Cobrix (React SPA)** | `http://127.0.0.1:4300` | Interfaz de usuario para operar Cobrix. |
| **API del ISP Simulado** | `http://127.0.0.1:4310/api/v1` | Administrador de facturas simulado. |
| **Swagger de la API del ISP** | `http://127.0.0.1:4310/docs` | Interfaz interactiva de prueba y caja del ISP. |

---

## 3. Modos de ejecución: Producción vs. Desarrollo

### 3.1 Modo Producción (Recomendado para evaluación)
En este modo, el servidor Node.js en el puerto `4300` sirve tanto la API REST interna (`/api/*`) como los archivos estáticos precompilados de React desde `dist/client/`.

```bash
npm run build
npm start
```
*Ventaja:* Proceso único, sin proxy intermedio, idéntico a un despliegue en servidor real.

### 3.2 Modo Desarrollo Frontend (Con Hot Reload)
Si deseas realizar cambios visuales en la interfaz con recarga rápida de módulos (HMR):

1. **Terminal 1:** Inicia el backend y la API del ISP:
   ```bash
   npm start
   ```
2. **Terminal 2:** Inicia el servidor de desarrollo Vite:
   ```bash
   npm run dev
   ```
3. **Acceso:** Abre `http://localhost:5173`.
   - Vite atiende en el puerto `5173` y reenvía automáticamente todas las peticiones dirigidas a `/api/*` hacia el backend en `http://localhost:4300` mediante el proxy configurado en `vite.config.ts`.

---

## 4. Comandos de validación y pruebas

Todos los comandos están configurados en `package.json`:

### 4.1 Batería completa de pruebas
```bash
npm test
```
- Ejecuta las 181 pruebas del proyecto utilizando el test runner nativo de Node.js (`--test`).
- Las pruebas se ejecutan con concurrencia 1 (`--test-concurrency=1`) para garantizar aislamiento absoluto en bases de datos SQLite en memoria.

### 4.2 Ejecutar pruebas de un módulo específico
Puedes ejecutar suites individuales pasando la ruta del archivo a Node:

```bash
# Probar el planificador diario y control horario en Caracas
node --test test/cobrix/sync-scheduler.test.ts

# Probar el ciclo completo de aceptación (reglas de la sección 5 del enunciado)
node --test test/cobrix/system-coherence.test.ts

# Probar normalización de cédulas/RIFs y cálculos de dinero en centavos
node --test test/cobrix/domain.test.ts

# Probar importación, simulación y topes por corrida
node --test test/cobrix/import.test.ts

# Probar conciliación de pagos, abonos parciales y libro del ISP
node --test test/cobrix/payment.test.ts

# Probar la API REST de configuración
node --test test/server/config-api.test.ts

# Probar la API REST de clientes y expedientes
node --test test/server/customers-api.test.ts
```

### 4.3 Comprobación estricta de tipos
```bash
npm run typecheck
```
- Valida los tres contextos de TypeScript (`tsconfig.server.json`, `tsconfig.app.json`, `tsconfig.node.json`) sin emitir archivos (`--noEmit`).
- Asegura que no existan usos de `any`, `unknown` o aserciones inseguras `as`.

### 4.4 Compilación de producción
```bash
npm run build
```
- Compila la aplicación cliente en `dist/client/`.

---

## 5. Procedimiento de prueba y validación del ciclo completo de pagos

Esta sección describe el procedimiento paso a paso para reproducir de punta a punta el escenario de aceptación del enunciado (§5), aclarando la interacción entre la caja del ISP simulado y el motor de conciliación de Cobrix.

---

### 5.1 Principio fundamental: Separación de responsabilidades

Es indispensable distinguir entre los dos sistemas independientes que interactúan en la prueba:

1. **El Administrador ISP (Simulador en puerto `4310`):**
   - Es el sistema externo de facturación y cobranza del proveedor de internet.
   - **La caja registradora reside en este sistema:** es aquí donde los clientes pagan sus cuotas en efectivo o transferencias, mediante los endpoints de caja `POST /__sim/pagar` y `POST /__sim/anular`.
2. **Cobrix (Gestor de Cobranzas en puerto `4300`):**
   - Es el sistema de cobranzas y conciliación contable.
   - **Cobrix no registra cobros en el ISP ni crea pagos en la caja.** Su función es importar cuotas pendientes, consultar el libro de pagos del ISP y conciliar cuáles facturas ya fueron pagadas o abonadas.
   - Si un operador pulsa «Actualizar pagos» en Cobrix antes de que se hayan registrado cobros en la caja del ISP, Cobrix reportará fielmente: **`0 facturas pagadas · 42 permanecen abiertas · Saldo USD 1.235,00`**, reflejando la realidad contable de que el dinero aún no ha ingresado al ISP.

---

### 5.2 Precondiciones y comprobación de salud

Con el servidor corriendo (`npm start`), comprueba en una terminal que ambos servicios respondan correctamente:

```bash
# 1. Comprobar salud y fecha activa del simulador ISP
curl -s http://127.0.0.1:4310/__sim/salud
# Respuesta esperada: {"ok":true,"hoy":"2026-10-13","periodo":"2026-10"}

# 2. Comprobar disponibilidad de la API de Cobrix
curl -s http://127.0.0.1:4300/api/dashboard | head -c 120
# Respuesta esperada: JSON con el objeto "metrics" y "company"
```

---

### 5.3 Paso 1: Importación inicial de facturas en Cobrix

Si la base de Cobrix está recién inicializada:
1. Abre el panel web en `http://127.0.0.1:4300/sincronizacion`.
2. Pulsa el botón azul **«Importar»** (o ejecuta `POST http://127.0.0.1:4300/api/sync/import` con `{ "isSimulation": false }`).
3. Confirma la operación en el modal de advertencia.
4. **Resultado esperado en el Dashboard (`/`):**
   - **Clientes importados:** 20.
   - **Total contratos:** 21 (Luis Gómez posee 2 contratos).
   - **Facturas abiertas:** 42.
   - **Saldo por cobrar:** USD 1.235,00 (`123.500` centavos).
   - **Facturas pagadas:** 0.

---

### 5.4 Paso 2: Registrar cobros en la caja del ISP simulado

Para simular la recaudación del día en la caja del ISP requerida por la sección 5 del enunciado, se deben utilizar los endpoints oficiales del simulador. Puedes ejecutarlos desde Swagger UI (`http://127.0.0.1:4310/docs` bajo la etiqueta **Simulador**) o ejecutando estos comandos `curl` en terminal:

```bash
# 1. Ana Pérez (contrato 900101): liquida toda su deuda (3 cuotas por USD 70,00)
curl -s -X POST http://127.0.0.1:4310/__sim/pagar \
  -H "Content-Type: application/json" \
  -d '{"id_contrato": 900101}'
# Respuesta esperada: HTTP 200 con {"id_factura": 8800118, "cuotas": [3 cuotas por $20, $25, $25]}

# 2. Luis Gómez (contrato 900103): abona USD 25,00 sobre cuotas mensuales de $20,00
curl -s -X POST http://127.0.0.1:4310/__sim/pagar \
  -H "Content-Type: application/json" \
  -d '{"id_contrato": 900103, "monto": 25}'
# Respuesta esperada: HTTP 200 con {"id_factura": 8800119, "cuotas": [cuota 1 por $20, cuota 2 por $5]}

# 3. Comercial El Faro, C.A. (contrato 900104): liquida toda su deuda (2 cuotas por USD 120,00)
curl -s -X POST http://127.0.0.1:4310/__sim/pagar \
  -H "Content-Type: application/json" \
  -d '{"id_contrato": 900104}'
# Respuesta esperada: HTTP 200 con {"id_factura": 8800120, "cuotas": [2 cuotas por $60 cada una]}

# 4. Miguel Ángel Soto (contrato 900114): abona USD 70,00 para sus 2 cuotas más antiguas de $35,00
curl -s -X POST http://127.0.0.1:4310/__sim/pagar \
  -H "Content-Type: application/json" \
  -d '{"id_contrato": 900114, "monto": 70}'
# Respuesta esperada: HTTP 200 con {"id_factura": 8800121, "cuotas": [2 cuotas por $35 cada una]}

# 5. Elena Ruiz (contrato 900113): registra cobro y lo anula inmediatamente
# (Requiere `jq` o alternativamente `python3` para parsear la respuesta JSON de forma segura)

# Paso 5a: Cobrar en caja y parsear el id_factura de forma robusta
RESPUESTA=$(curl -s -X POST http://127.0.0.1:4310/__sim/pagar \
  -H "Content-Type: application/json" \
  -d '{"id_contrato": 900113}')

# Extracción mediante jq (o alternativamente con python3: python3 -c "import sys, json; print(json.load(sys.stdin).get('id_factura', ''))")
RECIBO=$(echo "$RESPUESTA" | jq -r '.id_factura // empty')

# Paso 5b: Validar que el identificador no esté vacío y contenga exclusivamente dígitos
if [ -n "$RECIBO" ] && [[ "$RECIBO" =~ ^[0-9]+$ ]]; then
  curl -s -X POST http://127.0.0.1:4310/__sim/anular \
    -H "Content-Type: application/json" \
    -d "{\"id_factura\": $RECIBO}"
  # Respuesta esperada: HTTP 200 con {"id_factura": 8800122, "detalle_anulacion": "ANULACION EXITOSA..."}
else
  echo "Error: el identificador de factura recibido ('$RECIBO') no es válido (debe contener solo dígitos). Respuesta original: $RESPUESTA"
fi
```

---

### 5.5 Paso 3: Simular conciliación («Simular actualización»)

Antes de modificar el libro mayor de Cobrix, un operador puede previsualizar el impacto de los cobros:

1. En el panel web (`http://127.0.0.1:4300/sincronizacion`), pulsa **«Simular actualización»** (o ejecuta `POST /api/sync/payments` con `{ "isSimulation": true }`).
2. **Qué realiza el motor internamente:**
   - **Sí consulta el libro de pagos del ISP:** Llama a `GET /api/v1/isp/pago_informacion` para leer los comprobantes emitidos.
   - **No modifica registros de negocio en SQLite:** Las 42 facturas continúan en estado `OPEN`, los balances no se alteran y no se generan eventos en `customer_event`.
   - **Registra auditoría:** Persiste una corrida en `sync_run` con `is_simulation = 1` y almacena el desglose cuota a cuota en `sync_run_detail`.
3. **Qué observa el operador en la UI:**
   - Aparece un banner de feedback: *«Simulación de actualización finalizada con éxito: 8 facturas pagadas • $280.00 • 1 abono parcial ($5.00) • 34 permanecen abiertas»*.
   - Se agrega una fila en el Historial con badge ámbar **Simulación**.
   - Al pulsar **«Ver detalle»**, se accede a `/sincronizacion/corridas/:id` donde se aprecia qué facturas cambiarían de estado sin haber alterado todavía la contabilidad real.

---

### 5.6 Paso 4: Conciliación real («Actualizar pagos»)

Para asentar formalmente los pagos en Cobrix:

1. En `/sincronizacion`, pulsa el botón verde **«Actualizar pagos»** (o ejecuta `POST /api/sync/payments` con `{ "isSimulation": false }`).
2. Confirma la acción en el modal accesible de confirmación.
3. **Acciones ejecutadas en base de datos bajo transacción atómica:**
   - Las 8 facturas con pago completo pasan a `status = 'PAID'`, `balance_cents = 0`, registrando fecha de pago y número de recibo del ISP.
   - La segunda cuota de Luis Gómez aplica el abono parcial: permanece `status = 'OPEN'`, pero su saldo disminuye de $20,00 a **$15,00**.
   - Las facturas de Elena Ruiz permanecen en estado `OPEN` con su saldo original (comprobando que la anulación fue respetada).
   - Se registran los eventos correspondientes en `customer_event`.
   - Se inserta la corrida real en `sync_run` con `is_simulation = 0`.

---

### 5.7 Paso 5: Verificación de resultados e idempotencia

1. **Revisar métricas en el Dashboard (`http://127.0.0.1:4300`):**
   - **Facturas pagadas:** **8** (Ana Pérez 3, Comercial El Faro 2, Miguel Ángel Soto 2, Luis Gómez 1).
   - **Facturas abiertas:** **34**.
   - **Saldo por cobrar:** **USD 950,00** (ver detalle contable en §5.8).
2. **Revisar expedientes de clientes (`/clientes`):**
   - **Luis Gómez (`/clientes/V11223344`):** Presenta 1 factura pagada ($20,00) y su siguiente factura con saldo pendiente de **$15,00** y badge de abono parcial.
   - **Elena Ruiz (`/clientes/9000123`):** Mantiene sus 2 facturas en estado abierto por USD 50,00.
3. **Comprobar idempotencia:**
   - Vuelve a `/sincronizacion` y pulsa nuevamente **«Actualizar pagos»**.
   - El resultado será: **0 facturas pagadas, 0 abonos nuevos y 34 permanecen abiertas**. Los saldos y métricas se mantienen estrictamente intactos.

---

### 5.8 Nota técnica sobre la discrepancia de saldo (USD 955,00 frente a USD 950,00)

Existe una diferencia aritmética documentada entre la redacción original de la sección 5 del enunciado y el saldo real calculado por el motor contable de Cobrix y verificado por las pruebas automatizadas:

- **Cálculo literal del enunciado (§5):**
  El enunciado afirma: *«8 facturas pagadas y 34 abiertas por USD 955,00»*.
  El autor del enunciado calculó este valor deduciendo únicamente las 8 facturas que quedaron en estado `PAID`:
  $$\text{Saldo inicial (\$1.235,00)} - \text{8 facturas canceladas (\$280,00)} = \mathbf{\$955,00}$$
- **Cálculo contable real del sistema y pruebas:**
  En el Caso 2, Luis Gómez abonó **$25,00** sobre cuotas de $20,00. El simulador y Cobrix aplican $20,00 para liquidar la primera factura y los **$5,00 restantes** como abono parcial a la siguiente cuota de $20,00, cuyo saldo pendiente real se reduce a **$15,00**.
  Por consiguiente, el balance real exigible en el libro mayor de Cobrix es:
  $$\text{\$1.235,00} - \text{\$280,00} - \text{\$5,00 (abono parcial)} = \mathbf{\$950,00}$$

Esta exactitud contable al centavo está respaldada y validada en [`test/cobrix/system-coherence.test.ts`](../test/cobrix/system-coherence.test.ts) (`assert.equal(openBalanceAfterRealPay, 95000)`). Para el análisis técnico completo de esta discrepancia y la decisión técnica adoptada, consulta [Discrepancias Identificadas en el Enunciado (`docs/DISCREPANCIAS_ENUNCIADO.md`)](DISCREPANCIAS_ENUNCIADO.md).

---


### 5.9 Procedimiento de reinicio y consideraciones de base de datos

Si necesitas repetir las pruebas desde un estado inicial, es fundamental distinguir los dos componentes de persistencia:

#### A. Reinicio del Administrador ISP (Simulador en puerto 4310)
El simulador del ISP incluye un endpoint oficial para restaurar su base de datos (`data/billing-api.sqlite`) al estado original de semilla sin necesidad de reiniciar el proceso:

```bash
curl -s -X POST http://127.0.0.1:4310/__sim/reiniciar
# Respuesta esperada: {"ok":true,"mensaje":"Base de datos reiniciada a semilla"}
```

Este comando restablece los contratos, facturas y saldos de cuotas del ISP a sus valores iniciales entregados.

#### B. Estado y consideraciones sobre la persistencia de Cobrix (`data/cobrix.sqlite`)
- **Comportamiento de `npm test`:** La ejecución de `npm test` **no limpia ni reinicia** la base de datos de desarrollo (`data/cobrix.sqlite`). Cada suite de pruebas automatizadas crea sus propias bases de datos aisladas en directorios temporales (`/tmp` vía `mkdtempSync`), las cuales se destruyen al finalizar el test para garantizar que no existan efectos colaterales sobre los datos de desarrollo.
- **Sin procedimiento de reinicio establecido:** A diferencia del simulador externo, Cobrix no expone un endpoint HTTP de reinicio ni se ha establecido en el proyecto un procedimiento seguro y verificado para restablecer o vaciar su base de datos de desarrollo.
- **Riesgos de manipulación manual:**
  1. **Bloqueos del motor:** La base de datos SQLite es gestionada por Cobrix mediante `node:sqlite` (`DatabaseSync`). Manipular el archivo `data/cobrix.sqlite` mientras el servidor está en ejecución puede provocar bloqueos (`EBUSY` / `SQLITE_BUSY`) o inconsistencias de lectura.
  2. **Pérdida irreversible de auditoría:** `data/cobrix.sqlite` almacena la configuración operativa, las corridas de sincronización (`sync_run`, `sync_run_detail`) y la traza de eventos de clientes (`customer_event`), por lo que no debe alterarse ni suprimirse de forma indiscriminada.


---

## 6. Variables de entorno y semántica de fechas

| Variable | Valor por defecto | Explicación y advertencias |
|---|---|---|
| `PORT` | `4300` | Puerto HTTP del panel y API de Cobrix. |
| `BILLING_API_PORT` | `4310` | Puerto HTTP del simulador del ISP. |
| `HOST` | `127.0.0.1` | Interfaz de enlace de red. |
| `SANDBOX_TODAY` | `2026-10-13` | **Fecha fija para el simulador del ISP.** La base de datos entregada en `data/billing-api.sqlite` fue generada con cuotas relativas a octubre de 2026. Fijar esta variable asegura que los números de prueba coincidan exactamente con el enunciado. |

> **ADVERTENCIA TÉCNICA SOBRE RELOJES:**
> No se debe confundir `SANDBOX_TODAY` con el reloj del planificador automático (`SyncScheduler`). El simulador del ISP consulta `SANDBOX_TODAY` para saber qué cuotas considerar vencidas, mientras que el `SyncScheduler` calcula siempre la **fecha y hora civil real de `America/Caracas`** (`Intl.DateTimeFormat`) para no quedar congelado en el año 2026 en un entorno de producción.

---

## 7. Diagnóstico de problemas frecuentes (Troubleshooting)

### A. Puerto ocupado (`EADDRINUSE: address already in use :::4300` o `:::4310`)
- **Causa:** Hay otra instancia del servidor o un proceso anterior corriendo en segundo plano.
- **Diagnóstico:** Ejecuta en la terminal:
  ```bash
  lsof -i :4300
  lsof -i :4310
  ```
- **Solución:** Finaliza el proceso anterior (`kill -9 <PID>`) o arranca en puertos alternativos:
  ```bash
  PORT=4400 BILLING_API_PORT=4410 npm start
  ```

### B. El navegador muestra pantalla en blanco o interfaz básica
- **Causa:** La aplicación React no ha sido construida y no existe `dist/client/index.html`.
- **Solución:** Ejecuta `npm run build` y refresca la página en el navegador.

### C. Conflicto de sincronización (`409 Conflict`)
- **Causa:** Se intentó disparar una sincronización manual mientras el cerrojo estaba tomado por otra operación o por el scheduler automático.
- **Solución:** Espera unos segundos a que termine la corrida actual. El cerrojo se libera automáticamente en el bloque `finally`.

### D. El planificador diario no ejecuta la corrida
- **Causa:**
  1. `autoRunActive` está desactivado en `/configuracion`.
  2. La hora civil actual en Caracas es anterior a `autoRunHour`.
  3. El ciclo ya fue ejecutado hoy con resultado `COMPLETED` o `FAILED`.
- **Procedimiento seguro:** Revisa el estado consultando `GET /api/config`. Si deseas probar otra corrida en el mismo día, cambia la hora en `/configuracion`; **nunca borres la base de datos `data/cobrix.sqlite`**.

### E. Error de conexión con el ISP en `/configuracion`
- **Causa:** URL incorrecta o credenciales cambiadas.
- **Solución:** Verifica que la URL sea `http://127.0.0.1:4310/api/v1`, usuario `cobrix` y contraseña `cobrix-sandbox`.
