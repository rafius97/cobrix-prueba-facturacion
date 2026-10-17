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

## 5. Recorrido manual del flujo de negocio

Para reproducir visualmente los criterios de aceptación de la prueba técnica:

### Paso 1: Estado inicial
1. Inicia la aplicación con `npm start`.
2. Ingresa al panel en `http://127.0.0.1:4300`.
3. Ve a **Configuración** (`/configuracion`). Verifica que las credenciales del ISP estén configuradas (`http://127.0.0.1:4310/api/v1`, usuario `cobrix`, contraseña `cobrix-sandbox`). Pulsa **«Probar conexión»**; debe responder que la conexión es exitosa con 27 contratos disponibles.

### Paso 2: Simulación de importación
1. Ve a **Sincronización** (`/sincronizacion`).
2. Pulsa **«Simular importación»**.
3. En el historial aparecerá una corrida con badge ámbar **Simulación** y origen **Manual**.
4. Haz clic en la corrida: comprobarás que se evaluarían 42 cuotas, pero los contadores globales de clientes en el Dashboard permanecen en cero.

### Paso 3: Importación real
1. En **Sincronización**, pulsa **«Importar cuotas»**.
2. Al finalizar, ve al **Dashboard** (`/`):
   - **Clientes importados:** 20.
   - **Facturas abiertas:** 42.
   - **Monto por cobrar:** USD 1.235,00.
3. Ve a **Clientes** (`/clientes`):
   - Comprueba que Luis Gómez figura con 2 contratos agrupados.
   - Comprueba que Elena Ruiz (`09000123`) tiene ID normalizado `9000123`.
   - Comprueba que titulares excluidos (Carlos Rojas, Rosa Díaz, Pedro León, Andrés Vargas, Laura Méndez, Jorge Castillo) no aparecen en la lista.

### Paso 4: Registrar cobros en la caja del ISP
Abre el Swagger del ISP en `http://127.0.0.1:4310/docs` y ve a la sección **Simulador**:
1. `POST /__sim/pagar` con cuerpo `{"id_contrato": 900101}` (Ana Pérez: paga toda la deuda).
2. `POST /__sim/pagar` con cuerpo `{"id_contrato": 900103, "monto": 25}` (Luis Gómez: abono parcial de $25 en cuota de $20).
3. `POST /__sim/pagar` con cuerpo `{"id_contrato": 900104}` (Comercial El Faro: paga toda la deuda).
4. `POST /__sim/pagar` con cuerpo `{"id_contrato": 900114, "monto": 70}` (Miguel Ángel Soto: abono para 2 cuotas).
5. `POST /__sim/pagar` con cuerpo `{"id_contrato": 900113}` (Elena Ruiz: cobro temporal).
6. `POST /__sim/anular` con el `id_factura` retornado en el paso anterior (Elena Ruiz: anulación del cobro).

### Paso 5: Actualizar facturas pagadas
1. Regresa a Cobrix en `http://127.0.0.1:4300/sincronizacion`.
2. Pulsa **«Actualizar pagadas»**.
3. Revisa los resultados finales en el **Dashboard**:
   - **Facturas pagadas:** 8.
   - **Facturas abiertas:** 34.
   - **Monto por cobrar:** USD 955,00.
4. Abre el expediente de Luis Gómez (`/clientes/V11223344`):
   - Verás su factura del periodo más antiguo pagada y la siguiente abierta como **Abono parcial** con su respectivo evento en el historial.

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
