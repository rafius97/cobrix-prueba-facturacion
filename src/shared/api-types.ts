/**
 * Contratos de datos fuertemente tipados para la API HTTP de Cobrix (/api/*).
 * Isomórficos: compartidos entre el servidor Node.js y la aplicación cliente React.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

export type SyncRunStatusDto = 'COMPLETED' | 'FAILED'
export type SyncRunTypeDto = 'IMPORT' | 'PAYMENT_UPDATE'
export type SyncTriggerTypeDto = 'MANUAL' | 'SCHEDULED'
export type AutoRunStatusDto = 'RUNNING' | 'COMPLETED' | 'FAILED'

export interface ImportRunSummaryDto {
	readonly type: 'IMPORT'
	readonly isSimulation: boolean
	readonly durationMs: number
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

export interface PaymentSyncSummaryDto {
	readonly type: 'PAYMENT_UPDATE'
	readonly isSimulation: boolean
	readonly durationMs: number
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

export type SyncRunSummaryDto = ImportRunSummaryDto | PaymentSyncSummaryDto

export interface SyncRunItemDto {
	readonly id: string
	readonly type: SyncRunTypeDto
	readonly triggerType: SyncTriggerTypeDto
	readonly isSimulation: boolean
	readonly status: SyncRunStatusDto
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage: string | null
	readonly summary: SyncRunSummaryDto | null
}

export interface SyncRunListResponseDto {
	readonly runs: readonly SyncRunItemDto[]
	readonly totalCount: number
}

export interface SyncRunDetailItemDto {
	readonly id: number
	readonly runId: string
	readonly contractId: number
	readonly debtId: string
	readonly period: string
	readonly amountCents: number
	readonly result: string
	readonly reason: string
}

export interface SyncRunDetailResponseDto {
	readonly run: SyncRunItemDto
	readonly details: readonly SyncRunDetailItemDto[]
}

export interface SyncRunTriggerRequestDto {
	readonly isSimulation?: boolean
}

export interface GlobalMetricsDto {
	readonly totalCustomersCount: number
	readonly totalContractsCount: number
	readonly openInvoicesCount: number
	readonly paidInvoicesCount: number
	readonly totalOpenBalanceCents: number
	readonly oldestOpenDueDate: string | null
	readonly recentRuns: readonly SyncRunItemDto[]
}

export interface CompanyConfigDto {
	readonly companyName: string
	readonly companyTaxId: string
	readonly companyEmail: string
	readonly apiUrl: string
	readonly apiUsername: string
	readonly importableStatuses: readonly string[]
	readonly windowMonths: number | null
	readonly maxRecentInstallments: number | null
	readonly graceDays: number
	readonly runInvoiceLimit: number | null
	readonly runAmountLimitCents: number | null
	readonly excludedDocumentTypes: readonly string[]
	readonly autoRunHour: string
	readonly autoRunActive: boolean
	readonly lastAutoRunDate: string | null
	readonly lastAutoRunStatus: AutoRunStatusDto | null
}

export type ConfigResponseDto = CompanyConfigDto

export interface UpdateConfigRequestDto {
	readonly companyName?: string
	readonly companyTaxId?: string
	readonly companyEmail?: string
	readonly apiUrl?: string
	readonly apiUsername?: string
	readonly apiPassword?: string
	readonly importableStatuses?: readonly string[]
	readonly windowMonths?: number | null
	readonly maxRecentInstallments?: number | null
	readonly graceDays?: number
	readonly runInvoiceLimit?: number | null
	readonly runAmountLimitCents?: number | null
	readonly excludedDocumentTypes?: readonly string[]
	readonly autoRunHour?: string
	readonly autoRunActive?: boolean
}

export interface TestConnectionRequestDto {
	readonly apiUrl?: string
	readonly apiUsername?: string
	readonly apiPassword?: string
}

export interface TestConnectionResponseDto {
	readonly success: boolean
	readonly totalContracts?: number
	readonly message: string
}

export interface DashboardResponseDto {
	readonly metrics: GlobalMetricsDto
	readonly company: CompanyConfigDto
}

export interface EnunciadoResponseDto {
	readonly content: string
}

export interface ApiErrorResponseDto {
	readonly error: string
	readonly statusCode: number
	readonly path: string
}

// ============================================================================
// Directorio de Clientes (/api/customers)
// ============================================================================

export interface CustomerListItemDto {
	readonly customerId: string
	readonly originalDocument: string
	readonly documentType: string | null
	readonly personType: 'NATURAL' | 'JURIDICA'
	readonly name: string
	readonly totalContractsCount: number
	readonly openInvoicesCount: number
	readonly paidInvoicesCount: number
	readonly openBalanceCents: number
	readonly oldestOpenDueDate: string | null
}

export interface CustomerListResponseDto {
	readonly customers: readonly CustomerListItemDto[]
	readonly totalCount: number
}

// ============================================================================
// Expediente del Cliente (/api/customers/:id)
// ============================================================================

export interface CustomerDetailDto {
	readonly id: string
	readonly originalDocument: string
	readonly documentType: string | null
	readonly personType: 'NATURAL' | 'JURIDICA'
	readonly name: string
	readonly phone: string
	readonly email: string
	readonly address: string
	readonly createdAt: string
	readonly updatedAt: string
}

export interface CustomerMetricsDto {
	readonly totalContractsCount: number
	readonly openInvoicesCount: number
	readonly paidInvoicesCount: number
	readonly openBalanceCents: number
	readonly oldestOpenDueDate: string | null
}

export interface ContractItemDto {
	readonly id: number
	readonly customerId: string
	readonly code: string
	readonly status: string
	readonly plan: string
	readonly planPriceCents: number
	readonly branch: string
	readonly currency: string
	readonly billingDay: number
	readonly cutoffDay: number
	readonly createdAt: string
	readonly updatedAt: string
}

export interface InvoiceItemDto {
	readonly id: number
	readonly invoiceNumber: string
	readonly externalDebtId: string
	readonly contractId: number
	readonly customerId: string
	readonly period: string
	readonly dueDate: string
	readonly cutDate: string
	readonly totalAmountCents: number
	readonly balanceCents: number
	readonly status: 'OPEN' | 'PAID'
	readonly paidAt: string | null
	readonly ispPaymentInvoice: string | null
	readonly createdAt: string
	readonly updatedAt: string
}

export interface CustomerEventItemDto {
	readonly id: number
	readonly customerId: string
	readonly eventType: 'CUSTOMER_CREATED' | 'INVOICE_IMPORTED' | 'INVOICE_PAID' | 'PARTIAL_PAYMENT'
	readonly description: string
	readonly metadataJson: string
	readonly createdAt: string
}

export interface CustomerDossierResponseDto {
	readonly customer: CustomerDetailDto
	readonly metrics: CustomerMetricsDto
	readonly contracts: readonly ContractItemDto[]
	readonly invoices: readonly InvoiceItemDto[]
	readonly events: readonly CustomerEventItemDto[]
}
