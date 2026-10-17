/**
 * Controlador de API para las operaciones de sincronización e historial de Cobrix (/api/sync/*).
 * Coordina la ejecución de importación de cuotas, conciliación de pagos y auditoría.
 * Implementa exclusión mutua en memoria para evitar ejecuciones concurrentes.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones inseguras.
 */

import type { DatabaseSync } from 'node:sqlite'

import { BillingApiClient } from '../../cobrix/client/billing-api-client.ts'
import { configRepository } from '../../cobrix/db/repositories.ts'
import type { SyncTriggerType } from '../../cobrix/db/types.ts'
import { HistoryService } from '../../cobrix/history/history-service.ts'
import type { TypedImportSyncRun, TypedPaymentSyncRun, TypedSyncRun } from '../../cobrix/history/types.ts'
import { ImportService } from '../../cobrix/sync/import-service.ts'
import { PaymentSyncService } from '../../cobrix/sync/payment-sync-service.ts'
import type {
	ImportRunSummaryDto,
	PaymentSyncSummaryDto,
	SyncRunDetailItemDto,
	SyncRunDetailResponseDto,
	SyncRunItemDto,
	SyncRunListResponseDto,
} from '../../shared/api-types.ts'

// ============================================================================
// Control de Concurrencia (Bloqueo en Memoria por Proceso)
// ============================================================================

/**
 * Indicador de exclusión mutua a nivel de proceso Node.js.
 * Garantiza que no se ejecuten simultáneamente dos operaciones de sincronización (import o payment).
 */
let isSyncInProgress = false

export class SyncConflictError extends Error {
	constructor(message: string = 'A synchronization operation is already in progress') {
		super(message)
		this.name = 'SyncConflictError'
	}
}

/**
 * Adquiere el bloqueo en memoria para operaciones de sincronización.
 * Lanza SyncConflictError si ya existe una operación activa.
 */
export function acquireSyncLock(): void {
	if (isSyncInProgress) {
		throw new SyncConflictError()
	}
	isSyncInProgress = true
}

/**
 * Libera el bloqueo en memoria de sincronización.
 */
export function releaseSyncLock(): void {
	isSyncInProgress = false
}

/**
 * Verifica si el bloqueo está activo actualmente (útil para auditoría y pruebas).
 */
export function isSyncRunning(): boolean {
	return isSyncInProgress
}

// ============================================================================
// Funciones de Mapeo Tipadas
// ============================================================================

function mapImportSummaryToDto(run: TypedImportSyncRun): ImportRunSummaryDto {
	return {
		type: 'IMPORT',
		isSimulation: run.summary.isSimulation,
		durationMs: run.summary.durationMs,
		totalContractsInspected: run.summary.totalContractsInspected,
		totalInstallmentsEvaluated: run.summary.totalInstallmentsEvaluated,
		importedInvoicesCount: run.summary.importedInvoicesCount,
		importedAmountCents: run.summary.importedAmountCents,
		newCustomersCount: run.summary.newCustomersCount,
		alreadyImportedCount: run.summary.alreadyImportedCount,
		excludedByStatusCount: run.summary.excludedByStatusCount,
		excludedByDocumentTypeCount: run.summary.excludedByDocumentTypeCount,
		outOfWindowCount: run.summary.outOfWindowCount,
		excludedByMaxInstallmentsCount: run.summary.excludedByMaxInstallmentsCount,
		limitReachedCount: run.summary.limitReachedCount,
		inconsistentCurrencyCount: run.summary.inconsistentCurrencyCount,
		residualBalanceCount: run.summary.residualBalanceCount,
		noDebtCount: run.summary.noDebtCount,
		invalidIdentificationCount: run.summary.invalidIdentificationCount,
		invalidDataCount: run.summary.invalidDataCount,
	}
}

function mapPaymentSummaryToDto(run: TypedPaymentSyncRun): PaymentSyncSummaryDto {
	return {
		type: 'PAYMENT_UPDATE',
		isSimulation: run.summary.isSimulation,
		durationMs: run.summary.durationMs,
		totalInvoicesInspected: run.summary.totalInvoicesInspected,
		totalContractsInspected: run.summary.totalContractsInspected,
		markedPaidCount: run.summary.markedPaidCount,
		markedPaidAmountCents: run.summary.markedPaidAmountCents,
		partialPaymentsCount: run.summary.partialPaymentsCount,
		partialPaymentsAmountCents: run.summary.partialPaymentsAmountCents,
		stillOpenCount: run.summary.stillOpenCount,
		stillOpenBalanceCents: run.summary.stillOpenBalanceCents,
		exemptionCount: run.summary.exemptionCount,
		noEvidenceCount: run.summary.noEvidenceCount,
		contradictoryDataCount: run.summary.contradictoryDataCount,
		invalidDataCount: run.summary.invalidDataCount,
	}
}

export function mapTypedSyncRunToItemDto(run: TypedSyncRun): SyncRunItemDto {
	if (run.type === 'IMPORT') {
		return {
			id: run.id,
			type: run.type,
			triggerType: run.triggerType,
			isSimulation: run.isSimulation,
			status: run.status,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			errorMessage: run.errorMessage,
			summary: mapImportSummaryToDto(run),
		}
	}

	return {
		id: run.id,
		type: run.type,
		triggerType: run.triggerType,
		isSimulation: run.isSimulation,
		status: run.status,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		errorMessage: run.errorMessage,
		summary: mapPaymentSummaryToDto(run),
	}
}

// ============================================================================
// Operaciones del Controlador
// ============================================================================

export interface ExecuteSyncOptions {
	readonly isSimulation?: boolean
	readonly billingClient?: BillingApiClient
	readonly triggerType?: SyncTriggerType
}

/**
 * Instancia un cliente de Billing API a partir de la configuración guardada en la base de datos de Cobrix.
 */
function resolveBillingClient(db: DatabaseSync, customClient?: BillingApiClient): BillingApiClient {
	if (customClient !== undefined) {
		return customClient
	}
	const config = configRepository.get(db)
	return new BillingApiClient({
		baseUrl: config.apiUrl,
		username: config.apiUsername,
		password: config.apiPassword,
	})
}

async function runImport(
	db: DatabaseSync,
	client: BillingApiClient,
	isSimulation: boolean,
	triggerType: SyncTriggerType = 'MANUAL',
): Promise<SyncRunItemDto> {
	const service = new ImportService(db, client)
	const result = await service.run({ isSimulation, triggerType })
	const historyService = new HistoryService(db)
	const savedRun = historyService.getRunById(result.runId)
	if (savedRun === null) {
		throw new Error(`Failed to retrieve recorded sync run: ${result.runId}`)
	}
	return mapTypedSyncRunToItemDto(savedRun)
}

async function runPayment(
	db: DatabaseSync,
	client: BillingApiClient,
	isSimulation: boolean,
	triggerType: SyncTriggerType = 'MANUAL',
): Promise<SyncRunItemDto> {
	const service = new PaymentSyncService(db, client)
	const result = await service.run({ isSimulation, triggerType })
	const historyService = new HistoryService(db)
	const savedRun = historyService.getRunById(result.runId)
	if (savedRun === null) {
		throw new Error(`Failed to retrieve recorded sync run: ${result.runId}`)
	}
	return mapTypedSyncRunToItemDto(savedRun)
}

/**
 * Ejecuta una corrida de importación de cuotas (o su simulación) bajo exclusión mutua.
 */
export async function executeImportSync(
	db: DatabaseSync,
	options: ExecuteSyncOptions,
): Promise<SyncRunItemDto> {
	acquireSyncLock()
	try {
		const client = resolveBillingClient(db, options.billingClient)
		return await runImport(db, client, options.isSimulation ?? false, options.triggerType ?? 'MANUAL')
	} finally {
		releaseSyncLock()
	}
}

/**
 * Ejecuta una corrida de actualización y conciliación de facturas pagadas (o su simulación) bajo exclusión mutua.
 */
export async function executePaymentSync(
	db: DatabaseSync,
	options: ExecuteSyncOptions,
): Promise<SyncRunItemDto> {
	acquireSyncLock()
	try {
		const client = resolveBillingClient(db, options.billingClient)
		return await runPayment(db, client, options.isSimulation ?? false, options.triggerType ?? 'MANUAL')
	} finally {
		releaseSyncLock()
	}
}

/**
 * Ejecuta el ciclo completo de sincronización automática (importación y posterior conciliación de pagos)
 * manteniendo el cerrojo de sincronización activo durante toda la secuencia para evitar que una
 * sincronización manual se interponga entre ambas fases.
 */
export async function executeScheduledFullSync(
	db: DatabaseSync,
	options: ExecuteSyncOptions = {},
): Promise<{ readonly importRun: SyncRunItemDto; readonly paymentRun: SyncRunItemDto | null }> {
	acquireSyncLock()
	try {
		const client = resolveBillingClient(db, options.billingClient)
		const isSimulation = options.isSimulation ?? false
		const triggerType: SyncTriggerType = options.triggerType ?? 'SCHEDULED'

		const importRun = await runImport(db, client, isSimulation, triggerType)
		if (triggerType === 'SCHEDULED' && importRun.status === 'COMPLETED') {
			console.log('[scheduler] Scheduled import completed')
		}
		if (importRun.status === 'FAILED') {
			return { importRun, paymentRun: null }
		}

		const paymentRun = await runPayment(db, client, isSimulation, triggerType)
		if (triggerType === 'SCHEDULED' && paymentRun.status === 'COMPLETED') {
			console.log('[scheduler] Scheduled payment update completed')
		}
		return { importRun, paymentRun }
	} finally {
		releaseSyncLock()
	}
}

/**
 * Obtiene la lista ordenada de corridas de sincronización registradas.
 */
export function getSyncRunsHistory(db: DatabaseSync, limit?: number): SyncRunListResponseDto {
	const historyService = new HistoryService(db)
	const runs = historyService.listRuns(limit)
	const dtos: SyncRunItemDto[] = runs.map(mapTypedSyncRunToItemDto)

	return {
		runs: dtos,
		totalCount: dtos.length,
	}
}

/**
 * Obtiene la cabecera, resumen tipado y el desglose de registros evaluados de una corrida específica.
 * Retorna null si la corrida no existe.
 */
export function getSyncRunDetail(
	db: DatabaseSync,
	runId: string,
): SyncRunDetailResponseDto | null {
	const historyService = new HistoryService(db)
	const run = historyService.getRunById(runId)
	if (run === null) {
		return null
	}

	const rawDetails = historyService.listRunDetails(runId)
	const details: SyncRunDetailItemDto[] = rawDetails.map(d => ({
		id: d.id,
		runId: d.runId,
		contractId: d.contractId,
		debtId: d.debtId,
		period: d.period,
		amountCents: d.amountCents,
		result: d.result,
		reason: d.reason,
	}))

	return {
		run: mapTypedSyncRunToItemDto(run),
		details,
	}
}
