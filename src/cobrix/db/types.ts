/**
 * Strongly-typed entities and inputs for the Cobrix persistence layer.
 * Strictly typed.
 */

import type { DocumentType, PersonType } from '../domain/identification.ts'

export type InvoiceStatus = 'OPEN' | 'PAID'
export type SyncRunType = 'IMPORT' | 'PAYMENT_UPDATE'
export type SyncRunStatus = 'COMPLETED' | 'FAILED'
export type CustomerEventType = 'CUSTOMER_CREATED' | 'INVOICE_IMPORTED' | 'INVOICE_PAID' | 'PARTIAL_PAYMENT'

export interface CobrixConfig {
	readonly id: number
	readonly companyName: string
	readonly companyTaxId: string
	readonly companyEmail: string
	readonly apiUrl: string
	readonly apiUsername: string
	readonly apiPassword: string
	readonly importableStatuses: readonly string[]
	readonly windowMonths: number | null
	readonly maxRecentInstallments: number | null
	readonly graceDays: number
	readonly runInvoiceLimit: number | null
	readonly runAmountLimitCents: number | null
	readonly excludedDocumentTypes: readonly DocumentType[]
	readonly autoRunHour: string
	readonly autoRunActive: boolean
}

export interface UpdateConfigInput {
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
	readonly excludedDocumentTypes?: readonly DocumentType[]
	readonly autoRunHour?: string
	readonly autoRunActive?: boolean
}

export interface Customer {
	readonly id: string // Normalized identification (e.g. "9000123", "V12345678")
	readonly originalDocument: string
	readonly documentType: DocumentType | null
	readonly personType: PersonType
	readonly name: string
	readonly phone: string
	readonly email: string
	readonly address: string
	readonly createdAt: string
	readonly updatedAt: string
}

export interface CreateCustomerInput {
	readonly id: string
	readonly originalDocument: string
	readonly documentType: DocumentType | null
	readonly personType: PersonType
	readonly name: string
	readonly phone?: string
	readonly email?: string
	readonly address?: string
}

export interface Contract {
	readonly id: number // ISP contract id
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

export interface UpsertContractInput {
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
}

export interface Invoice {
	readonly id: number
	readonly invoiceNumber: string
	readonly externalDebtId: string
	readonly contractId: number
	readonly customerId: string
	readonly period: string // YYYY-MM
	readonly dueDate: string // YYYY-MM-01
	readonly cutDate: string // YYYY-MM-DD
	readonly totalAmountCents: number
	readonly balanceCents: number
	readonly status: InvoiceStatus
	readonly paidAt: string | null
	readonly ispPaymentInvoice: string | null
	readonly createdAt: string
	readonly updatedAt: string
}

export interface CreateInvoiceInput {
	readonly invoiceNumber: string
	readonly externalDebtId: string
	readonly contractId: number
	readonly customerId: string
	readonly period: string
	readonly dueDate: string
	readonly cutDate: string
	readonly totalAmountCents: number
	readonly balanceCents: number
	readonly status?: InvoiceStatus
}

export interface MarkInvoicePaidInput {
	readonly paidAt: string
	readonly ispPaymentInvoice: string
}

export interface SyncRun {
	readonly id: string
	readonly type: SyncRunType
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage: string | null
	readonly summaryJson: string
}

export interface CreateSyncRunInput {
	readonly id: string
	readonly type: SyncRunType
	readonly isSimulation: boolean
	readonly status: SyncRunStatus
	readonly startedAt: string
	readonly finishedAt: string
	readonly errorMessage?: string | null
	readonly summaryJson: string
}

export interface SyncRunDetail {
	readonly id: number
	readonly runId: string
	readonly contractId: number
	readonly debtId: string
	readonly period: string
	readonly amountCents: number
	readonly result: string
	readonly reason: string
}

export interface CreateSyncRunDetailInput {
	readonly runId: string
	readonly contractId: number
	readonly debtId: string
	readonly period: string
	readonly amountCents: number
	readonly result: string
	readonly reason: string
}

export interface CustomerEvent {
	readonly id: number
	readonly customerId: string
	readonly eventType: CustomerEventType
	readonly description: string
	readonly metadataJson: string
	readonly createdAt: string
}

export interface CreateCustomerEventInput {
	readonly customerId: string
	readonly eventType: CustomerEventType
	readonly description: string
	readonly metadataJson?: string
}

export interface InvoiceAggregateMetrics {
	readonly openInvoicesCount: number
	readonly paidInvoicesCount: number
	readonly totalOpenBalanceCents: number
	readonly oldestOpenDueDate: string | null
}

export interface CustomerMetricsSummary {
	readonly customerId: string
	readonly name: string
	readonly totalContractsCount: number
	readonly openInvoicesCount: number
	readonly paidInvoicesCount: number
	readonly openBalanceCents: number
	readonly oldestOpenDueDate: string | null
}
