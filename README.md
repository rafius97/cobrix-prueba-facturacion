# Cobrix — Integración y Gestión de Cobranzas para ISPs

Cobrix es una solución integral desarrollada en TypeScript para conectar con el administrador de facturas de un proveedor de servicios de internet (ISP). Permite **importar clientes y cuotas pendientes**, conciliar y **actualizar facturas pagadas**, auditar cada operación fila a fila, programar un **ciclo diario automático** bajo la zona horaria `America/Caracas` y operar la cobranza mediante un panel de control web moderno.

> **Aclaración sobre pagos:** Cobrix registra, importa y concilia los cobros que el ISP realiza a través de su propia caja o canales bancarios. Cobrix **no es una pasarela de pagos** ni procesa transferencias directas; su función es mantener sincronizada la cartera de cobranza y los expedientes de los clientes con base en los datos oficiales del ISP.

---

## 1. Funcionalidades implementadas

- **Directorio y expediente de clientes:** Agrupación automática de múltiples contratos por titular normalizado (V, E, J, G, P), cálculo de métricas financieras consolidadas y auditoría histórica de eventos.
- **Importación inteligente de facturas:** Filtrado defensivo de cuotas sin deuda (`deuda_id: "0"`), saldos residuales, validación de coherencia monetaria en USD, ventanas móviles de tiempo, topes por corrida y cuotas recientes.
- **Conciliación conservadora de pagos:** Clasificación rigurosa entre pagos completos (factura pasa a `PAID`), abonos parciales (la factura sigue abierta pero se audita el abono), exoneraciones y cuotas sin evidencia en el ISP.
- **Modos Real y Simulación:** Capacidad de simular importaciones o pagos evaluando todas las reglas contra la API externa sin alterar la base de datos de negocio.
- **Scheduler diario en `America/Caracas`:** Planificador periódico autónomo que orquesta el ciclo diario `Importar → Actualizar pagadas`, respeta el cerrojo de sincronización, evita duplicados en el mismo día civil y soporta arranques tardíos.
- **Trazabilidad completa:** Registro del origen de cada corrida (`MANUAL` o `SCHEDULED`), reflejado en base de datos, API REST, logs estructurados y badges visuales en la interfaz.
- **Panel Web SPA moderno:** Interfaz reactiva construida con React 19, Tailwind CSS v4, Lucide Icons y React Router DOM v7.
- **Migraciones no destructivas:** Esquema SQLite (`node:sqlite`) autogestionado e idempotente que actualiza bases existentes sin pérdida de registros históricos.

---

## 2. Stack tecnológico

- **Entorno de ejecución:** Node.js `>= 24.0.0` (utilizando `node:sqlite` nativo).
- **Lenguaje:** TypeScript 5.9 con tipado estricto sin concesiones (cero `any`, cero `unknown` y cero aserciones `as` inseguras).
- **Frontend:** React 19, React Router DOM v7, Tailwind CSS v4, Lucide React.
- **Herramienta de compilación:** Vite 6 (`@vitejs/plugin-react`, `@tailwindcss/vite`).
- **Pruebas:** Test Runner nativo de Node.js (`node --test`).
- **Persistencia:** SQLite (`data/cobrix.sqlite`) independiente del simulador del ISP (`data/billing-api.sqlite`).

---

## 3. Requisitos previos e instalación rápida

Requiere **Node.js 24 o superior** y `npm`.

```bash
# 1. Instalar dependencias
npm install

# 2. Compilar el cliente web de producción
npm run build

# 3. Iniciar el entorno completo
npm start
```

---

## 4. URLs y puertos locales

Al ejecutar `npm start`, el sistema levanta ambos servidores en paralelo en el mismo proceso:

| Servicio | URL Local | Descripción |
|---|---|---|
| **Panel Cobrix (React SPA)** | [http://127.0.0.1:4300](http://127.0.0.1:4300) | Panel de control web para operar Cobrix. |
| **API del Administrador ISP** | [http://127.0.0.1:4310/api/v1](http://127.0.0.1:4310/api/v1) | API simulada de facturación del ISP. |
| **Swagger de la API del ISP** | [http://127.0.0.1:4310/docs](http://127.0.0.1:4310/docs) | Documentación interactiva y caja simulada (`/__sim/*`). |

*Credenciales de acceso a la API del ISP:* Usuario `cobrix`, Contraseña `cobrix-sandbox`.

---

## 5. Comandos disponibles

Todos los comandos están configurados en `package.json`:

```bash
# Compilar la aplicación React para producción
npm run build

# Iniciar la aplicación en producción (Panel en :4300 y API ISP en :4310)
npm start

# Iniciar el servidor de desarrollo Vite con Hot Reload (en :5173 hacia backend en :4300)
npm run dev

# Ejecutar la suite completa de 181 pruebas automatizadas
npm test

# Validación estricta de tipos en los 3 contextos de TypeScript
npm run typecheck

# Regenerar la base de datos simulada del ISP (vuelve al mes actual)
npm run seed
```

---

## 6. Resumen de criterios de aceptación (§5 del Enunciado)

Con la base de datos entregada y la fecha de prueba (`2026-10-13` fijada por defecto en `npm start`), el sistema cumple con total exactitud los resultados documentados:

| Escenario | Resultado esperado | Resultado en Cobrix | Verificación en tests |
|---|---|---|---|
| **Simular importación** | 42 cuotas importables; 0 escrituras en negocio. | 42 cuotas evaluadas; 0 clientes y 0 facturas creadas. | `test/cobrix/import.test.ts` |
| **Importar (Cobrix vacío)** | **20 clientes**, **42 facturas abiertas** por **USD 1.235,00**. | **20 clientes**, **42 facturas abiertas** por **USD 1.235,00**. | `test/cobrix/system-coherence.test.ts` |
| **Exclusiones de importación** | 9 cuotas por estado, 1 contrato por moneda incoherente, 1 saldo residual. | 9 excluidas por estado, 1 contrato excluido (Jorge Castillo), 1 saldo residual descartado. | `test/cobrix/import.test.ts` |
| **Reimportar (Idempotencia)** | 0 facturas nuevas. | 0 facturas creadas, 42 marcadas `ALREADY_IMPORTED`. | `test/cobrix/persistence.test.ts` |
| **Agrupación de clientes** | Luis Gómez con 2 contratos; Elena Ruiz con ID `9000123`. | 1 cliente Luis Gómez con 2 contratos; ID `9000123`. | `test/cobrix/domain.test.ts` |
| **Titulares excluidos** | Carlos Rojas, Rosa Díaz, Pedro León, Andrés Vargas, Laura Méndez y Jorge Castillo fuera. | Ninguno de estos titulares aparece en el directorio de clientes. | `test/cobrix/system-coherence.test.ts` |
| **Actualizar pagadas tras cobros** | **8 facturas pagadas**, **34 abiertas por USD 955,00** (enunciado). | **8 facturas pagadas**, **34 abiertas por USD 950,00** ($5 de abono parcial de Luis Gómez). | `test/cobrix/system-coherence.test.ts` |
| **Abono parcial** | Luis Gómez: cuota de 20 pagada, cuota siguiente abierta con abono. | Factura más antigua pagada; siguiente abierta y evento de abono parcial registrado. | `test/cobrix/payment.test.ts` |
| **Anulación en caja** | Elena Ruiz: facturas siguen abiertas tras anular el cobro. | Facturas permanecen en estado `OPEN`. | `test/cobrix/payment.test.ts` |

---

## 7. Documentación detallada

Para profundizar en el diseño, operación y decisiones del proyecto, consulta los documentos complementarios en `docs/`:

- [**Guía de Desarrollo, Operación y Pruebas** (`docs/GUIA_DESARROLLO.md`)](docs/GUIA_DESARROLLO.md): Guía paso a paso para ejecutar y validar el flujo de negocio y conciliación (§5), desarrollo con Vite, variables de entorno y troubleshooting.

- [**Decisiones Técnicas y Nota de Entrega** (`docs/DECISIONES_TECNICAS.md`)](docs/DECISIONES_TECNICAS.md): Justificación técnica, qué quedó fuera, mejoras futuras y puntos diferenciales (sección 6 del enunciado).
- [**Arquitectura del Sistema** (`docs/ARQUITECTURA.md`)](docs/ARQUITECTURA.md): Modelo por capas, esquema SQLite, catálogo de la API REST interna `/api/*`, concurrencia y seguridad.
- [**Flujos de Negocio e Integración** (`docs/FLUJOS_DE_NEGOCIO.md`)](docs/FLUJOS_DE_NEGOCIO.md): Reglas de normalización, descarte defensivo, conciliación de pagos y scheduler diario.
- [**Glosario de Términos** (`docs/GLOSARIO.md`)](docs/GLOSARIO.md): Definiciones de términos técnicos y de dominio utilizados en la solución.
- [**Enunciado de la Prueba** (`docs/ENUNCIADO.md`)](docs/ENUNCIADO.md): Especificación original de requerimientos y criterios de evaluación.
- [**API del Administrador ISP** (`docs/API.md`)](docs/API.md): Especificación técnica de la API simulada del ISP.

---

## 8. Trabajo futuro y mejoras pendientes (TO-DOs)

Por limitaciones de tiempo en el alcance de la prueba técnica, se priorizó la corrección de las reglas de negocio, la integridad contable y la cobertura de pruebas, dejando documentadas las siguientes mejoras técnicas para una siguiente fase:

- **Integración de logs estructurados en el backend:** Sustituir la salida estándar de consola por un sistema de logging estructurado (como Pino o Winston) con niveles (`info`, `warn`, `error`, `debug`), formato JSON y trazabilidad por identificador de corrida (`correlationId`).
- **Integración de TanStack React Query en el frontend:** Reemplazar el manejo manual de estados con `fetch` y `useEffect` por queries y mutaciones reactivas para gestión óptima de caché, invalidaciones automáticas tras sincronizar y reintentos en segundo plano.
- **Integración de pruebas E2E en el frontend con Vitest / Playwright:** Incorporar tests de extremo a extremo que automaticen la navegación en el navegador, la ejecución de sincronizaciones manuales desde la UI y la verificación de modales de detalle.
- **Integrar Zod en ambos proyectos:** Validación exhaustiva de esquemas en tiempo de ejecución tanto en la frontera de entrada del backend (respuestas del ISP y payloads de la API) como en el frontend, complementando las guardas de tipos nativas actuales.
- **Ampliación de edge cases en los test suites:** Incorporar más escenarios límite alrededor de colisiones de pagos concurrentes, reversiones complejas, interrupciones de red durante corridas extensas y reanudación tras fallos.
- **Mejora del diseño de alertas y retroalimentación:** Pulir los componentes visuales de mensajes contextuales (`toast`, estados de `success`, `danger`, `alert` y banners de advertencia) con mejor jerarquía y microanimaciones.
- **Diseño responsive para móviles y tablets:** Adaptar las vistas del dashboard, tablas de clientes y modales de historial para una experiencia táctil y fluida en pantallas pequeñas.
