/**
 * Tipos e interfaces fuertemente tipados para el proceso de sincronización y conciliación
 * de pagos de Cobrix con la API externa del ISP.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import type { SyncRunStatus } from '../db/types.ts'

/**
 * Opciones para ejecutar una corrida de sincronización y conciliación de pagos.
 */
export interface RunPaymentSyncOptions {
	/**
	 * Si es true, ejecuta la corrida en modo simulación:
	 * evalúa las facturas abiertas contra el libro de pagos del ISP y calcula
	 * los contadores y detalles, pero no persiste mutaciones en las tablas de negocio
	 * (invoice, customer_event).
	 */
	readonly isSimulation?: boolean

	/**
	 * Fecha de inicio opcional (YYYY-MM-DD) para delimitar la consulta al libro de pagos.
	 * Si no se especifica, el servicio calcula una ventana segura basada en las facturas abiertas.
	 */
	readonly startDate?: string

	/**
	 * Fecha de fin opcional (YYYY-MM-DD) para delimitar la consulta al libro de pagos.
	 * Si no se especifica, el servicio utiliza la fecha actual del sistema.
	 */
	readonly endDate?: string
}

/**
 * Categorías de resultados posibles para cada factura abierta evaluada durante la conciliación.
 */
export type PaymentItemResultType =
	| 'MARKED_PAID'
	| 'PARTIAL_PAYMENT'
	| 'STILL_OPEN'
	| 'EXEMPTION_NOT_PAYMENT'
	| 'NO_EVIDENCE'
	| 'CONTRADICTORY_DATA'
	| 'INVALID_DATA'

/**
 * Unión discriminada para el detalle de evaluación de cada factura abierta.
 * Cada variante comparte contractId, debtId, period, amountCents, result y reason,
 * aportando metadatos específicos según la categoría del resultado.
 */
export type PaymentItemEvaluation =
	| {
			readonly result: 'MARKED_PAID'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly paidAt: string
			readonly ispPaymentInvoice: string
			readonly paidAmountCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'PARTIAL_PAYMENT'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly previousBalanceCents: number
			readonly newBalanceCents: number
			readonly paidAmountCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'STILL_OPEN'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly balanceCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'EXEMPTION_NOT_PAYMENT'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly tariffCents: number
			readonly discountCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'NO_EVIDENCE'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly reason: string
	  }
	| {
			readonly result: 'CONTRADICTORY_DATA'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber: string
			readonly customerId: string
			readonly reason: string
	  }
	| {
			readonly result: 'INVALID_DATA'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly invoiceNumber?: string
			readonly customerId?: string
			readonly reason: string
	  }

/**
 * Contadores cuantitativos de una corrida de conciliación de pagos.
 */
export interface PaymentSyncCounters {
	readonly totalInvoicesInspected: number
	readonly totalContractsInspected: number
	readonly markedPaidCount: number
	readonly markedPaidAmountCents: number
	readonly partialPaymentsCount: number
	readonly partialPaymentsAmountCents: number
	readonly stillOpenCount: number
	readonly stillOpenBalanceCents: number
	readonly exemptionCount: number
	readonly noEvidenceCount: number
	readonly contradictoryDataCount: number
	readonly invalidDataCount: number
}

/**
 * Resumen consolidado de la corrida de conciliación (almacenable en `sync_run.summary_json`).
 */
export interface PaymentSyncSummary extends PaymentSyncCounters {
	readonly runId: string
	readonly isSimulation: boolean
	readonly startedAt: string
	readonly finishedAt: string
	readonly durationMs: number
}

/**
 * Resultado completo retornado por el proceso de sincronización y conciliación de pagos.
 */
export interface PaymentSyncResult {
	readonly runId: string
	readonly runType: 'PAYMENT_UPDATE'
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly summary: PaymentSyncSummary
	readonly details: readonly PaymentItemEvaluation[]
	readonly errorMessage?: string | null
}
