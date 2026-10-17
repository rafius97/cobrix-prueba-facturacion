# Glosario de Términos — Cobrix

Glosario de referencia con los conceptos de dominio, técnicos y de integración que aparecen en el código, la base de datos y la interfaz de usuario de Cobrix.

---

| Término en código / UI | Equivalente conceptual | Definición técnica en Cobrix |
|---|---|---|
| **Abono parcial** (`PARTIAL_PAYMENT`) | Pago a cuenta | Situación en la que el libro del ISP reporta un pago que reduce la deuda de la cuota, pero deja un saldo pendiente mayor a cero. La factura permanece abierta (`OPEN`). |
| **Ausencia de evidencia** (`NO_EVIDENCE`) | Sin registro verificable | Cuota abierta en Cobrix que no figura ni en el libro de pagos ni en cuotas pendientes del ISP. Por política de seguridad, nunca se marca como pagada. |
| **Cerrojo / Bloqueo en memoria** (`SyncLock`) | Exclusión mutua (Mutex) | Mecanismo que impide que dos procesos de importación o conciliación (manuales o automáticos) se ejecuten simultáneamente. |
| **Corrida automática** (`SCHEDULED`) | Ejecución programada | Ciclo de sincronización disparado por el `SyncScheduler` a la hora fijada en la configuración. |
| **Corrida manual** (`MANUAL`) | Ejecución por operador | Sincronización iniciada interactivamente por un usuario desde la interfaz web o mediante la API REST. |
| **Cuota** (`Installment`) | Obligación mensual de cobro | Unidad mínima de deuda emitida por el ISP asociada a un contrato y a un periodo mensual. |
| **Cuota sin deuda** (`NO_DEBT_ROW`) | Registro centinela | Fila enviada por la API del ISP con `deuda_id: "0"` y monto cero que indica ausencia de compromisos pendientes y debe ser descartada. |
| **Desglose de corrida** (`SyncRunDetail`) | Auditoría granular | Registro individual asociado a una corrida donde se documenta el contrato, deuda, monto, resultado y motivo de cada cuota evaluada. |
| **Días de gracia** (`graceDays`) | Prórroga de corte | Cantidad de días adicionales permitidos tras la fecha de vencimiento antes de establecer la fecha de corte del servicio. |
| **Exoneración** (`EXONERATED`) | Deuda perdonada sin cobro | Cuota que en el ISP reporta saldo cero pero con valor pagado de cero (`valor_pago = 0`). Cobrix no la clasifica como pago financiero. |
| **Expediente / Dossier** (`CustomerDossier`) | Ficha integral del cliente | Vista consolidada con datos del cliente, contratos activos, facturas asociadas, eventos históricos y métricas de cobranza. |
| **Frenado por tope** (`HALTED_BY_LIMIT`) | Detención por umbral | Estado asignado a cuotas válidas que no se importaron porque la corrida alcanzó el límite configurado de facturas o monto en dólares. |
| **Idempotencia** (`Idempotency`) | Consistencia estructural | Propiedad por la cual repetir una importación o conciliación no genera duplicados ni altera saldos ya calculados. |
| **Límite de cuotas recientes** (`maxRecentInstallments`) | Tope temporal por contrato | Regla que restringe la importación a las N cuotas más recientes cronológicamente de cada contrato. |
| **Modo simulación** (`isSimulation: true`) | Ensayo sin mutación | Modo de ejecución que consulta la API del ISP y evalúa reglas de negocio, pero no modifica clientes, contratos ni facturas. |
| **Moneda incoherente** (`INCOHERENT_CURRENCY`) | Anomalía de divisa | Contrato reportado en USD cuyas cuotas son inferiores al 1% del precio del plan contratado; se descarta por inconsistencia de datos. |
| **Saldo residual** (`Residual balance`) | Fracción despreciable | Saldo de menos de un centavo de dólar (`deuda <= 0`) que se descarta durante la importación. |
| **Titular** (`Contract holder`) | Sujeto de crédito | Persona natural o jurídica identificada por cédula o RIF que suscribe uno o más contratos con el ISP. |
| **Unidades menores / Centavos** (`Minor units / Cents`) | Enteros monetarios | Almacenamiento de valores en dólares multiplicados por 100 (`$25.50` → `2550`) para prevenir errores de coma flotante. |
| **Ventana de importación** (`windowMonths`) | Ventana móvil de tiempo | Filtro que excluye cuotas anteriores a N meses respecto al periodo actual (ej. 3, 6, 9 o 12 meses). |
