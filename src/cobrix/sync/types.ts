/**
 * Tipos e interfaces fuertemente tipados para el proceso de importación y sincronización de Cobrix.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import type { SyncRunStatus } from '../db/types.ts'
import type { DocumentType } from '../domain/identification.ts'

/**
 * Opciones para ejecutar una corrida de importación de facturas y deudas.
 */
export interface RunImportOptions {
	/**
	 * Si es true, ejecuta la corrida en modo simulación:
	 * evalúa todos los contratos y cuotas, calcula contadores y detalles,
	 * pero no persiste cambios en las tablas de negocio (customer, contract, invoice, customer_event).
	 */
	readonly isSimulation?: boolean
}

/**
 * Tipos de resultado posibles para cada cuota evaluada durante la importación.
 */
export type ImportItemResultType =
	| 'IMPORTED'
	| 'ALREADY_IMPORTED'
	| 'EXCLUDED_STATUS'
	| 'EXCLUDED_DOCUMENT_TYPE'
	| 'OUT_OF_WINDOW'
	| 'EXCLUDED_MAX_INSTALLMENTS'
	| 'LIMIT_REACHED'
	| 'INCONSISTENT_CURRENCY'
	| 'RESIDUAL_BALANCE'
	| 'NO_DEBT'
	| 'INVALID_IDENTIFICATION'
	| 'INVALID_DATA'

/**
 * Tipo de tope de corrida alcanzado cuando se frena una cuota.
 */
export type ImportLimitType = 'INVOICE_LIMIT' | 'AMOUNT_LIMIT'

/**
 * Unión discriminada para el detalle de evaluación de cada cuota.
 * Cada variante comparte contractId, debtId, period, amountCents, result y reason,
 * aportando datos específicos adicionales según la categoría del resultado.
 */
export type ImportItemEvaluation =
	| {
			readonly result: 'IMPORTED'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly customerId: string
			readonly invoiceNumber: string
			readonly reason: string
	  }
	| {
			readonly result: 'ALREADY_IMPORTED'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly customerId: string
			readonly reason: string
	  }
	| {
			readonly result: 'EXCLUDED_STATUS'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly contractStatus: string
			readonly reason: string
	  }
	| {
			readonly result: 'EXCLUDED_DOCUMENT_TYPE'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly documentType: DocumentType | null
			readonly reason: string
	  }
	| {
			readonly result: 'OUT_OF_WINDOW'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly windowMonths: number
			readonly reason: string
	  }
	| {
			readonly result: 'EXCLUDED_MAX_INSTALLMENTS'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly maxRecent: number
			readonly reason: string
	  }
	| {
			readonly result: 'LIMIT_REACHED'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly limitType: ImportLimitType
			readonly reason: string
	  }
	| {
			readonly result: 'INCONSISTENT_CURRENCY'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly planPriceCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'RESIDUAL_BALANCE'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'NO_DEBT'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly reason: string
	  }
	| {
			readonly result: 'INVALID_IDENTIFICATION'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly rawIdentification: string
			readonly reason: string
	  }
	| {
			readonly result: 'INVALID_DATA'
			readonly contractId: number
			readonly debtId: string
			readonly period: string
			readonly amountCents: number
			readonly reason: string
	  }

/**
 * Contadores cuantitativos de una corrida de importación.
 */
export interface ImportRunCounters {
	readonly totalContractsInspected: number
	readonly totalInstallmentsEvaluated: number
	readonly importedInvoicesCount: number
	readonly importedAmountCents: number
	readonly newCustomersCount: number
	readonly alreadyImportedCount: number
	readonly excludedByStatusCount: number
	readonly excludedByDocumentTypeCount: number
	readonly outOfWindowCount: number
	readonly excludedByMaxInstallmentsCount: number
	readonly limitReachedCount: number
	readonly inconsistentCurrencyCount: number
	readonly residualBalanceCount: number
	readonly noDebtCount: number
	readonly invalidIdentificationCount: number
	readonly invalidDataCount: number
}

/**
 * Resumen consolidado de la corrida de importación (almacenable en `sync_run.summary_json`).
 */
export interface ImportRunSummary extends ImportRunCounters {
	readonly runId: string
	readonly isSimulation: boolean
	readonly startedAt: string
	readonly finishedAt: string
	readonly durationMs: number
}

/**
 * Resultado completo retornado por el proceso de importación.
 */
export interface ImportRunResult {
	readonly runId: string
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly summary: ImportRunSummary
	readonly details: readonly ImportItemEvaluation[]
	readonly errorMessage?: string | null
}
