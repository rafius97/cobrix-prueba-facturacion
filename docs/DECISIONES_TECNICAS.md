# Decisiones Técnicas y Nota de Entrega — Cobrix

Este documento constituye la **nota técnica de entrega** requerida por la sección 6 del enunciado (`docs/ENUNCIADO.md`). En él se sintetizan las decisiones de diseño adoptadas, el alcance implementado, las razones de lo que quedó fuera, las mejoras prioritarias para una siguiente fase y los puntos diferenciales de la solución.

---

## 1. Decisiones técnicas y justificación

### 1.1 Precisión monetaria en enteros (centavos de dólar)
- **Decisión:** Todos los montos monetarios en USD se representan internamente y en base de datos como enteros en centavos (`total_amount_cents`, `balance_cents`, `plan_price_cents`). La conversión desde y hacia números decimales ocurre exclusivamente en las fronteras de entrada/salida (consumo de la API externa del ISP y renderizado en UI).
- **Justificación:** Los números de punto flotante estándar (`float`/`double`) en JavaScript/TypeScript introducen errores de redondeo acumulativos (por ejemplo, `0.1 + 0.2 !== 0.3`). Trabajar en unidades menores enteras elimina este riesgo y garantiza integridad financiera absoluta en sumas, deducciones y validación de saldos residuales.

### 1.2 Persistencia nativa con SQLite (`node:sqlite`)
- **Decisión:** Utilizar el módulo nativo `node:sqlite` de Node.js 24 en lugar de ORMs pesados o dependencias externas como `better-sqlite3` o Prisma.
- **Justificación:** Reduce la superficie de dependencias a cero en el backend de datos, respeta las restricciones de Node 24 del proyecto, permite consultas SQL explícitas de alto rendimiento, habilita transacciones atómicas seguras (`withTransaction`) y facilita pruebas en memoria (`:memory:`) ultra rápidas y deterministas.

### 1.3 Validación estricta y tipado sin excepciones (`no-any`, `no-unknown`, `no-as`)
- **Decisión:** Toda la aplicación, servicios, repositorios, controladores y pruebas están tipados estrictamente. No se utiliza `any` ni `unknown`, ni aserciones de tipo `as` para encubrir tipos inciertos.
- **Justificación:** Las respuestas externas de la API de un ISP y los datos leídos de SQLite son fronteras no confiables. La solución emplea funciones de validación defensiva (guardas de tipos) que comprueban la forma de los objetos en tiempo de ejecución antes de acceder a sus propiedades, evitando errores de tipo `TypeError: cannot read property of undefined` en producción.

### 1.4 Exclusión mutua en memoria mediante cerrojo de sincronización (`SyncLock`)
- **Decisión:** Implementar un cerrojo en memoria (`acquireSyncLock` y `releaseSyncLock`) compartido entre las operaciones manuales y el scheduler automático.
- **Justificación:** Evita condiciones de carrera donde una importación manual y una corrida automática (o dos manuales simultáneas) intenten modificar concurrentemente las mismas tablas, crear facturas duplicadas o sobreescribir balances. Si una operación está en curso, cualquier intento concurrente manual es rechazado con código HTTP `409 Conflict`, y el scheduler pospone su ejecución para el siguiente ciclo.

### 1.5 Arquitectura desacoplada: Frontend SPA moderno y Backend REST
- **Decisión:** Sustituir el esqueleto HTML estático inicial por una Single Page Application (SPA) en React 19 con Tailwind CSS v4, Lucide Icons y React Router DOM v7, respaldada por una API REST limpia (`/api/*`).
- **Justificación:** Ofrece al operador de cobranzas una experiencia de usuario ágil, reactiva e informativa: filtros en tiempo real, búsqueda de clientes instantánea, desgloses fila a fila de corridas, modales de confirmación y visualización inmediata de estados sin recargar la página completa.

### 1.6 Idempotencia estructural y migraciones automáticas
- **Decisión:** Aplicar restricciones de unicidad en SQLite (ej. índice único sobre `external_debt_id` en facturas) y funciones de migración no destructivas (`migrateConfigSchemaIfNeeded`, `migrateSyncRunSchemaIfNeeded`) que se ejecutan al iniciar la aplicación.
- **Justificación:** Permite actualizar bases de datos preexistentes sin pérdida de información histórica y garantiza que repetir una importación o una actualización de pagos no duplique registros ni altere el estado financiero.

---

## 2. Qué quedó fuera del alcance

De forma deliberada y para mantener el foco en la solidez del negocio y las reglas del enunciado, se dejaron fuera:

1. **Pasarela de pago y cobro directo:** Cobrix registra, importa y concilia pagos que el ISP cobra a través de sus canales (caja, bancos). Cobrix no procesa tarjetas de crédito, transferencias bancarias ni pagos en línea directos.
2. **Soporte multi-empresa o multi-tenant distribuido:** La persistencia actual está diseñada para una empresa operadora (`config` con singleton `id = 1`).
3. **Distribución en clúster con colas externas (Redis / BullMQ):** El scheduler y el cerrojo residen en el proceso principal del backend Node.js. Si bien es óptimo para la escala requerida y entornos contenerizados de instancia única, requeriría cerrojos distribuidos (ej. Redlock o locks a nivel de base de datos) para despliegues con múltiples réplicas simultáneas.
4. **Mapeo configurable de campos de la API externa:** El cliente HTTP se adapta a los nombres de campos específicos del administrador del ISP (`id_contrato`, `deuda_id`, `pago_informacion`, etc.) según el contrato documentado en `docs/API.md`.

---

## 3. Qué se haría con más tiempo

Si el proyecto continuara hacia una fase de despliegue a gran escala, las prioridades técnicas serían:

1. **Exportación de reportes y auditorías:** Exportación en formato CSV y Excel de los desgloses de corridas (`sync_run_detail`) y de la cartera de clientes con facturas vencidas para facilitar la gestión de cobranza telefónica o en campo.
2. **Notificaciones y webhooks:** Envío automático de alertas por correo electrónico o webhooks (Slack / WhatsApp) cuando una corrida automática finalice con estado `FAILED` o cuando se alcancen los topes configurados (`HALTED_BY_LIMIT`).
3. **Métricas de observabilidad Prometheus / OpenTelemetry:** Exposición de métricas de duración de corridas, tasa de éxito en peticiones HTTP al ISP y tiempos de respuesta de base de datos para monitoreo con Grafana.
4. **Reintentos automáticos con retroceso exponencial (Exponential Backoff):** Reintentar automáticamente peticiones fallidas ante errores temporales de red (`502`, `503`, `ETIMEDOUT`) contra la API del ISP antes de marcar una corrida como fallida.
5. **Autenticación y roles de usuario en el panel:** Control de acceso basado en roles (RBAC) para operadores de consulta, operadores de sincronización y administradores de configuración.

---

## 4. Puntos diferenciales de la solución

Los aspectos que distinguen esta entrega frente a una implementación mínima son:

### A. Scheduler autónomo con cálculo civil real en `America/Caracas`
El planificador diario (`SyncScheduler`) está integrado en el backend sin requerir dependencias pesadas de cron del sistema operativo. Calcula la fecha y hora civil de Caracas (`UTC-4`) mediante `Intl.DateTimeFormat.formatToParts`, protegiéndose del valor estático de `SANDBOX_TODAY` que solo rige para el simulador de pruebas. Cuenta con detección de arranque tardío, prevención de ticks solapados y apagado limpio (`unref` y `clearInterval`).

### B. Trazabilidad completa cuota a cuota y origen del disparador
Cada corrida registra si su origen fue manual (`MANUAL`) o programado (`SCHEDULED`), lo cual se propaga desde el backend hasta la base de datos (`sync_run.trigger_type`), la API REST y las vistas del frontend (badges visuales en el historial y en el Dashboard). Cada corrida almacena en `sync_run_detail` el motivo exacto por el cual cada cuota fue importada, excluida, frenada por tope, pagada o dejada abierta.

### C. Conciliación conservadora y no destructiva de pagos
La lógica de conciliación nunca marca una factura como pagada ante la menor inconsistencia o falta de evidencia. Distingue rigurosamente pagos completos, abonos parciales (la factura sigue abierta pero se audita el abono), exoneraciones y cuotas sin rastro en el libro del ISP, preservando la coherencia contable en todo momento.

### D. Migraciones idempotentes con compatibilidad hacia atrás
El esquema de SQLite se actualiza automáticamente al arrancar sin destruir tablas ni requerir scripts manuales. Las bases de datos antiguas que no tenían columnas del scheduler o de trazabilidad reciben los campos necesarios con valores por defecto consistentes (`trigger_type = 'MANUAL'`) de forma transparente.

### E. Cobertura integral de pruebas (181 tests, 0 fallos)
El 100% de las reglas de negocio de la sección 4 y los números exactos de la sección 5 del enunciado están cubiertos por pruebas unitarias, de persistencia, de API y de integración de ciclo completo (`test/cobrix/system-coherence.test.ts`), garantizando reproducibilidad absoluta.
