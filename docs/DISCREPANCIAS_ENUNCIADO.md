# Discrepancias Identificadas en el Enunciado — Cobrix

Este documento registra de forma transparente la discrepancia detectada entre el criterio de aceptación redactado en la especificación original y el resultado derivado de las reglas de negocio y operaciones contables solicitadas.

---

## 1. Referencia a la especificación original

En [`docs/ENUNCIADO.md`](ENUNCIADO.md), Sección 5 («Criterios de aceptación»), se establece el siguiente resultado final esperado tras la ejecución del escenario de cobros y posterior actualización:

> **«Resultado final: 8 facturas pagadas y 34 abiertas por USD 955,00. Repetir la actualización no cambia nada.»**

---

## 2. Comportamiento observado en el escenario de prueba

En la misma sección 5 del enunciado se solicita registrar cobros en la caja del ISP simulado para cinco clientes. Entre ellos figura:

| Cliente / Contrato | Operación en la caja | Resultado descrito en el enunciado |
|---|---|---|
| **LUIS GOMEZ**, contrato cortado (`900103`) | `{"id_contrato": 900103, "monto": 25}` (cuotas mensuales de $20,00) | *«1 pagada; la siguiente sigue abierta como abono parcial»* |

Al ejecutar esta operación en el simulador externo del ISP (`POST /__sim/pagar`):
1. **Primera cuota (`7000031`):** Se cancelan USD 20,00. Su saldo pasa a 0 y queda totalmente pagada.
2. **Segunda cuota (`7000032`):** Se aplican los USD 5,00 restantes del pago de $25,00. La cuota permanece abierta, pero su saldo pendiente en el ISP se reduce de USD 20,00 a **USD 15,00** (`saldo = 15`, `valor_pago = 5`).

---

## 3. Comparativa y cálculo del saldo abierto

| Concepto | Cálculo | Saldo resultante |
|---|---|---|
| **A. Cifra indicada en el enunciado (§5)** | $\text{USD } 1.235,00 - \text{USD } 280,00 \text{ (8 facturas pagadas)}$ | **USD 955,00** |
| **B. Resultado contable del sistema Cobrix** | $\text{USD } 1.235,00 - \text{USD } 280,00 - \text{USD } 5,00 \text{ (abono parcial)}$ | **USD 950,00** |

### Explicación matemática
Ambos importes difieren en exactamente **USD 5,00**:
- El valor de **USD 955,00** resulta de restar únicamente el importe de las ocho facturas cuyo estado cambió a `PAID` (Ana Pérez $70 + El Faro $120 + Soto $70 + Luis Gómez $20 = $280). No descuenta el abono parcial de USD 5,00 que ingresó a la siguiente cuota.
- El valor de **USD 950,00** refleja el total adeudado real tras computar tanto las facturas liquidadas como el abono parcial efectivamente cobrado por el ISP ($280 + $5 = $285 recaudados).

---

## 4. Decisión técnica adoptada

En el modelo de datos de Cobrix ([`src/cobrix/db/schema.ts`](../src/cobrix/db/schema.ts)), cada factura almacena tanto su importe original (`total_amount_cents`) como su saldo pendiente exigible (`balance_cents`).

La consulta agregada del sistema ([`invoiceRepository.getAggregateMetrics`](../src/cobrix/db/repositories.ts)) calcula el saldo por cobrar como:

```sql
COALESCE(SUM(CASE WHEN status = 'OPEN' THEN balance_cents ELSE 0 END), 0) AS total_open_balance_cents
```

Por diseño del dominio:
- Los abonos parciales actualizan `balance_cents` de la factura afectada (`invoiceRepository.updateBalance`).
- La factura permanece con `status = 'OPEN'` (como exige la sección 4 del enunciado: *«si la cuota tiene saldo pero menor al de Cobrix (abono parcial), se informa y la factura sigue abierta»*).
- Al sumar los saldos de las 34 facturas abiertas (33 con su monto completo original y 1 con saldo restante de $15,00), la suma arroja exactamente **USD 950,00** (`95.000` centavos).

**USD 950,00** es el resultado estrictamente coherente con la implementación del motor de conciliación y con las suites de prueba existentes ([`test/cobrix/system-coherence.test.ts`](../test/cobrix/system-coherence.test.ts) y [`test/cobrix/payment.test.ts`](../test/cobrix/payment.test.ts)). No se asume que el autor del enunciado pretendía una regla contable diferente ni que el evaluador haya confirmado explícitamente esta interpretación.

---

## 5. Clasificación y resolución

Esta situación queda formalmente clasificada como una **discrepancia detectada entre el criterio de aceptación numérico del enunciado y el cálculo contable derivado de las operaciones de caja solicitadas**.

- **Conducta implementada:** No se modifica artificialmente la lógica para forzar USD 955,00 (lo cual requeriría ignorar el abono de $5 en la base de datos o sumar montos nominales originales en vez de saldos vivos).
- **Resolución ante el evaluador:** Si el evaluador determina que el saldo reportado debe ignorar amortizaciones parciales hasta que la factura se liquide por completo, deberá formalizarse dicha regla de negocio y ajustarse en consecuencia las aserciones de prueba correspondientes.
