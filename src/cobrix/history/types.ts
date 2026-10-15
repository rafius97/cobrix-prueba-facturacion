/**
 * Modelos de dominio fuertemente tipados para el historial de corridas de sincronización de Cobrix.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import type { SyncRun, SyncRunStatus, SyncRunType } from '../db/types.ts'
import type { ImportRunSummary } from '../sync/types.ts'
import type { PaymentSyncSummary } from '../sync/payment-types.ts'

export type { ImportRunSummary, PaymentSyncSummary, SyncRun, SyncRunStatus, SyncRunType }

/**
 * Entrada cruda representativa de un registro de corrida, antes de validar su tipo y resumen.
 */
export interface RawSyncRunInput {
	readonly id: string
	readonly type: string
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage: string | null
	readonly summaryJson: string
}

/**
 * Unión discriminada para el resumen tipado de una corrida de sincronización.
 */
export type TypedSyncRunSummary =
	| {
			readonly type: 'IMPORT'
			readonly summary: ImportRunSummary
	  }
	| {
			readonly type: 'PAYMENT_UPDATE'
			readonly summary: PaymentSyncSummary
	  }

/**
 * Corrida de importación con su resumen fuertemente tipado y validado.
 */
export interface TypedImportSyncRun {
	readonly id: string
	readonly type: 'IMPORT'
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage: string | null
	readonly summaryJson: string
	readonly summary: ImportRunSummary
}

/**
 * Corrida de conciliación de pagos con su resumen fuertemente tipado y validado.
 */
export interface TypedPaymentSyncRun {
	readonly id: string
	readonly type: 'PAYMENT_UPDATE'
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage: string | null
	readonly summaryJson: string
	readonly summary: PaymentSyncSummary
}

/**
 * Unión discriminada para una corrida de sincronización con resumen validado.
 */
export type TypedSyncRun = TypedImportSyncRun | TypedPaymentSyncRun
