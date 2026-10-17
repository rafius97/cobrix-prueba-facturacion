/**
 * Controlador de API para el Dashboard / Resumen del sistema Cobrix.
 * Obtiene métricas agregadas y datos de empresa sin exponer contraseñas.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import type { DatabaseSync } from 'node:sqlite'

import { configRepository } from '../../cobrix/db/repositories.ts'
import { HistoryService } from '../../cobrix/history/history-service.ts'
import type {
	CompanyConfigDto,
	DashboardResponseDto,
	GlobalMetricsDto,
	ImportRunSummaryDto,
	PaymentSyncSummaryDto,
	SyncRunItemDto,
} from '../../shared/api-types.ts'

export function getDashboardData(db: DatabaseSync): DashboardResponseDto {
	const historyService = new HistoryService(db)
	const globalMetrics = historyService.getGlobalMetrics(5)
	const config = configRepository.get(db)

	const recentRuns: SyncRunItemDto[] = globalMetrics.recentRuns.map(run => {
		if (run.type === 'IMPORT') {
			const importSummary: ImportRunSummaryDto = {
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
			return {
				id: run.id,
				type: run.type,
				triggerType: run.triggerType,
				isSimulation: run.isSimulation,
				status: run.status,
				startedAt: run.startedAt,
				finishedAt: run.finishedAt,
				errorMessage: run.errorMessage,
				summary: importSummary,
			}
		}

		const paymentSummary: PaymentSyncSummaryDto = {
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
		return {
			id: run.id,
			type: run.type,
			triggerType: run.triggerType,
			isSimulation: run.isSimulation,
			status: run.status,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			errorMessage: run.errorMessage,
			summary: paymentSummary,
		}
	})

	const metrics: GlobalMetricsDto = {
		totalCustomersCount: globalMetrics.totalCustomersCount,
		totalContractsCount: globalMetrics.totalContractsCount,
		openInvoicesCount: globalMetrics.openInvoicesCount,
		paidInvoicesCount: globalMetrics.paidInvoicesCount,
		totalOpenBalanceCents: globalMetrics.totalOpenBalanceCents,
		oldestOpenDueDate: globalMetrics.oldestOpenDueDate,
		recentRuns,
	}

	const company: CompanyConfigDto = {
		companyName: config.companyName,
		companyTaxId: config.companyTaxId,
		companyEmail: config.companyEmail,
		apiUrl: config.apiUrl,
		apiUsername: config.apiUsername,
		importableStatuses: config.importableStatuses,
		windowMonths: config.windowMonths,
		maxRecentInstallments: config.maxRecentInstallments,
		graceDays: config.graceDays,
		runInvoiceLimit: config.runInvoiceLimit,
		runAmountLimitCents: config.runAmountLimitCents,
		excludedDocumentTypes: config.excludedDocumentTypes,
		autoRunHour: config.autoRunHour,
		autoRunActive: config.autoRunActive,
		lastAutoRunDate: config.lastAutoRunDate,
		lastAutoRunStatus: config.lastAutoRunStatus,
	}

	return {
		metrics,
		company,
	}
}
