/**
 * Strongly-typed repositories for Cobrix database operations.
 * Validates database output strictly.
 */

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'

import type { DocumentType, PersonType } from '../domain/identification.ts'
import type {
	CobrixConfig,
	Contract,
	CreateCustomerEventInput,
	CreateCustomerInput,
	CreateInvoiceInput,
	CreateSyncRunDetailInput,
	CreateSyncRunInput,
	Customer,
	CustomerEvent,
	CustomerEventType,
	CustomerMetricsSummary,
	Invoice,
	InvoiceAggregateMetrics,
	InvoiceStatus,
	MarkInvoicePaidInput,
	SyncRun,
	SyncRunDetail,
	SyncRunStatus,
	SyncRunType,
	UpdateConfigInput,
	UpsertContractInput,
} from './types.ts'

// ============================================================================
// Safe column value extractors (strictly typed runtime parsers)
// ============================================================================

function parseString(row: Record<string, SQLOutputValue>, column: string): string {
	const val = row[column]
	if (typeof val !== 'string') {
		throw new Error(`Column "${column}" must be string, got: ${String(val)}`)
	}
	return val
}

function parseOptionalString(row: Record<string, SQLOutputValue>, column: string): string | null {
	const val = row[column]
	if (val === null || val === undefined) return null
	if (typeof val !== 'string') {
		throw new Error(`Column "${column}" must be string or null, got: ${String(val)}`)
	}
	return val
}

function parseNumber(row: Record<string, SQLOutputValue>, column: string): number {
	const val = row[column]
	if (typeof val === 'number') return val
	if (typeof val === 'bigint') return Number(val)
	throw new Error(`Column "${column}" must be number, got: ${String(val)}`)
}

function parseOptionalNumber(row: Record<string, SQLOutputValue>, column: string): number | null {
	const val = row[column]
	if (val === null || val === undefined) return null
	if (typeof val === 'number') return val
	if (typeof val === 'bigint') return Number(val)
	throw new Error(`Column "${column}" must be number or null, got: ${String(val)}`)
}

function parseBoolean(row: Record<string, SQLOutputValue>, column: string): boolean {
	return parseNumber(row, column) !== 0
}

function parsePersonType(row: Record<string, SQLOutputValue>, column: string): PersonType {
	const val = parseString(row, column)
	if (val === 'NATURAL' || val === 'JURIDICA') return val
	throw new Error(`Invalid PersonType value: ${val}`)
}

function parseDocumentType(row: Record<string, SQLOutputValue>, column: string): DocumentType | null {
	const val = parseOptionalString(row, column)
	if (val === null) return null
	if (val === 'V' || val === 'E' || val === 'J' || val === 'G' || val === 'P') return val
	throw new Error(`Invalid DocumentType value: ${val}`)
}

function parseInvoiceStatus(row: Record<string, SQLOutputValue>, column: string): InvoiceStatus {
	const val = parseString(row, column)
	if (val === 'OPEN' || val === 'PAID') return val
	throw new Error(`Invalid InvoiceStatus value: ${val}`)
}

function parseSyncRunType(row: Record<string, SQLOutputValue>, column: string): SyncRunType {
	const val = parseString(row, column)
	if (val === 'IMPORT' || val === 'PAYMENT_UPDATE') return val
	throw new Error(`Invalid SyncRunType value: ${val}`)
}

function parseSyncRunStatus(row: Record<string, SQLOutputValue>, column: string): SyncRunStatus {
	const val = parseString(row, column)
	if (val === 'COMPLETED' || val === 'FAILED') return val
	throw new Error(`Invalid SyncRunStatus value: ${val}`)
}

function parseCustomerEventType(row: Record<string, SQLOutputValue>, column: string): CustomerEventType {
	const val = parseString(row, column)
	if (
		val === 'CUSTOMER_CREATED' ||
		val === 'INVOICE_IMPORTED' ||
		val === 'INVOICE_PAID' ||
		val === 'PARTIAL_PAYMENT'
	) {
		return val
	}
	throw new Error(`Invalid CustomerEventType value: ${val}`)
}

// ============================================================================
// Entity Mappers
// ============================================================================

function mapConfig(row: Record<string, SQLOutputValue>): CobrixConfig {
	const rawStatuses = parseString(row, 'importable_statuses')
	const importableStatuses = rawStatuses
		.split(',')
		.map(s => s.trim())
		.filter(s => s.length > 0)

	const rawExcluded = parseString(row, 'excluded_document_types')
	const excludedDocumentTypes: DocumentType[] = []
	for (const item of rawExcluded.split(',').map(s => s.trim())) {
		if (item === 'V' || item === 'E' || item === 'J' || item === 'G' || item === 'P') {
			excludedDocumentTypes.push(item)
		}
	}

	return {
		id: parseNumber(row, 'id'),
		companyName: parseString(row, 'company_name'),
		companyTaxId: parseString(row, 'company_tax_id'),
		companyEmail: parseString(row, 'company_email'),
		apiUrl: parseString(row, 'api_url'),
		apiUsername: parseString(row, 'api_username'),
		apiPassword: parseString(row, 'api_password'),
		importableStatuses,
		windowMonths: parseOptionalNumber(row, 'window_months'),
		maxRecentInstallments: parseOptionalNumber(row, 'max_recent_installments'),
		graceDays: parseNumber(row, 'grace_days'),
		runInvoiceLimit: parseOptionalNumber(row, 'run_invoice_limit'),
		runAmountLimitCents: parseOptionalNumber(row, 'run_amount_limit_cents'),
		excludedDocumentTypes,
		autoRunHour: parseString(row, 'auto_run_hour'),
		autoRunActive: parseBoolean(row, 'auto_run_active'),
	}
}

function mapCustomer(row: Record<string, SQLOutputValue>): Customer {
	return {
		id: parseString(row, 'id'),
		originalDocument: parseString(row, 'original_document'),
		documentType: parseDocumentType(row, 'document_type'),
		personType: parsePersonType(row, 'person_type'),
		name: parseString(row, 'name'),
		phone: parseString(row, 'phone'),
		email: parseString(row, 'email'),
		address: parseString(row, 'address'),
		createdAt: parseString(row, 'created_at'),
		updatedAt: parseString(row, 'updated_at'),
	}
}

function mapContract(row: Record<string, SQLOutputValue>): Contract {
	return {
		id: parseNumber(row, 'id'),
		customerId: parseString(row, 'customer_id'),
		code: parseString(row, 'code'),
		status: parseString(row, 'status'),
		plan: parseString(row, 'plan'),
		planPriceCents: parseNumber(row, 'plan_price_cents'),
		branch: parseString(row, 'branch'),
		currency: parseString(row, 'currency'),
		billingDay: parseNumber(row, 'billing_day'),
		cutoffDay: parseNumber(row, 'cutoff_day'),
		createdAt: parseString(row, 'created_at'),
		updatedAt: parseString(row, 'updated_at'),
	}
}

function mapInvoice(row: Record<string, SQLOutputValue>): Invoice {
	return {
		id: parseNumber(row, 'id'),
		invoiceNumber: parseString(row, 'invoice_number'),
		externalDebtId: parseString(row, 'external_debt_id'),
		contractId: parseNumber(row, 'contract_id'),
		customerId: parseString(row, 'customer_id'),
		period: parseString(row, 'period'),
		dueDate: parseString(row, 'due_date'),
		cutDate: parseString(row, 'cut_date'),
		totalAmountCents: parseNumber(row, 'total_amount_cents'),
		balanceCents: parseNumber(row, 'balance_cents'),
		status: parseInvoiceStatus(row, 'status'),
		paidAt: parseOptionalString(row, 'paid_at'),
		ispPaymentInvoice: parseOptionalString(row, 'isp_payment_invoice'),
		createdAt: parseString(row, 'created_at'),
		updatedAt: parseString(row, 'updated_at'),
	}
}

function mapSyncRun(row: Record<string, SQLOutputValue>): SyncRun {
	return {
		id: parseString(row, 'id'),
		type: parseSyncRunType(row, 'type'),
		isSimulation: parseBoolean(row, 'is_simulation'),
		status: parseSyncRunStatus(row, 'status'),
		startedAt: parseString(row, 'started_at'),
		finishedAt: parseString(row, 'finished_at'),
		errorMessage: parseOptionalString(row, 'error_message'),
		summaryJson: parseString(row, 'summary_json'),
	}
}

function mapSyncRunDetail(row: Record<string, SQLOutputValue>): SyncRunDetail {
	return {
		id: parseNumber(row, 'id'),
		runId: parseString(row, 'run_id'),
		contractId: parseNumber(row, 'contract_id'),
		debtId: parseString(row, 'debt_id'),
		period: parseString(row, 'period'),
		amountCents: parseNumber(row, 'amount_cents'),
		result: parseString(row, 'result'),
		reason: parseString(row, 'reason'),
	}
}

function mapCustomerEvent(row: Record<string, SQLOutputValue>): CustomerEvent {
	return {
		id: parseNumber(row, 'id'),
		customerId: parseString(row, 'customer_id'),
		eventType: parseCustomerEventType(row, 'event_type'),
		description: parseString(row, 'description'),
		metadataJson: parseString(row, 'metadata_json'),
		createdAt: parseString(row, 'created_at'),
	}
}

function mapInvoiceAggregateMetrics(row: Record<string, SQLOutputValue>): InvoiceAggregateMetrics {
	return {
		openInvoicesCount: parseNumber(row, 'open_invoices_count'),
		paidInvoicesCount: parseNumber(row, 'paid_invoices_count'),
		totalOpenBalanceCents: parseNumber(row, 'total_open_balance_cents'),
		oldestOpenDueDate: parseOptionalString(row, 'oldest_open_due_date'),
	}
}

function mapCustomerMetrics(row: Record<string, SQLOutputValue>): CustomerMetricsSummary {
	return {
		customerId: parseString(row, 'customer_id'),
		name: parseString(row, 'customer_name'),
		totalContractsCount: parseNumber(row, 'total_contracts_count'),
		openInvoicesCount: parseNumber(row, 'open_invoices_count'),
		paidInvoicesCount: parseNumber(row, 'paid_invoices_count'),
		openBalanceCents: parseNumber(row, 'open_balance_cents'),
		oldestOpenDueDate: parseOptionalString(row, 'oldest_open_due_date'),
	}
}

// ============================================================================
// Repositories
// ============================================================================

export const configRepository = {
	get(db: DatabaseSync): CobrixConfig {
		const row = db.prepare('SELECT * FROM config WHERE id = 1').get()
		if (row === undefined) {
			throw new Error('Cobrix configuration not found')
		}
		return mapConfig(row)
	},

	update(db: DatabaseSync, input: UpdateConfigInput): CobrixConfig {
		const current = configRepository.get(db)
		const statuses = input.importableStatuses !== undefined
			? input.importableStatuses.join(',')
			: current.importableStatuses.join(',')
		const excluded = input.excludedDocumentTypes !== undefined
			? input.excludedDocumentTypes.join(',')
			: current.excludedDocumentTypes.join(',')

		db.prepare(`
			UPDATE config SET
				company_name = ?,
				company_tax_id = ?,
				company_email = ?,
				api_url = ?,
				api_username = ?,
				api_password = ?,
				importable_statuses = ?,
				window_months = ?,
				max_recent_installments = ?,
				grace_days = ?,
				run_invoice_limit = ?,
				run_amount_limit_cents = ?,
				excluded_document_types = ?,
				auto_run_hour = ?,
				auto_run_active = ?
			WHERE id = 1
		`).run(
			input.companyName ?? current.companyName,
			input.companyTaxId ?? current.companyTaxId,
			input.companyEmail ?? current.companyEmail,
			input.apiUrl ?? current.apiUrl,
			input.apiUsername ?? current.apiUsername,
			input.apiPassword ?? current.apiPassword,
			statuses,
			input.windowMonths !== undefined ? input.windowMonths : current.windowMonths,
			input.maxRecentInstallments !== undefined ? input.maxRecentInstallments : current.maxRecentInstallments,
			input.graceDays !== undefined ? input.graceDays : current.graceDays,
			input.runInvoiceLimit !== undefined ? input.runInvoiceLimit : current.runInvoiceLimit,
			input.runAmountLimitCents !== undefined ? input.runAmountLimitCents : current.runAmountLimitCents,
			excluded,
			input.autoRunHour ?? current.autoRunHour,
			input.autoRunActive !== undefined ? (input.autoRunActive ? 1 : 0) : (current.autoRunActive ? 1 : 0),
		)

		return configRepository.get(db)
	},
}

export const customerRepository = {
	getById(db: DatabaseSync, id: string): Customer | null {
		const row = db.prepare('SELECT * FROM customer WHERE id = ?').get(id)
		return row !== undefined ? mapCustomer(row) : null
	},

	list(db: DatabaseSync): Customer[] {
		const rows = db.prepare('SELECT * FROM customer ORDER BY name ASC').all()
		return rows.map(mapCustomer)
	},

	create(db: DatabaseSync, input: CreateCustomerInput): Customer {
		const now = new Date().toISOString()
		db.prepare(`
			INSERT INTO customer (
				id, original_document, document_type, person_type,
				name, phone, email, address, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			input.id,
			input.originalDocument,
			input.documentType,
			input.personType,
			input.name,
			input.phone ?? '',
			input.email ?? '',
			input.address ?? '',
			now,
			now,
		)
		const created = customerRepository.getById(db, input.id)
		if (created === null) throw new Error(`Failed to retrieve newly created customer: ${input.id}`)
		return created
	},

	count(db: DatabaseSync): number {
		const row = db.prepare('SELECT COUNT(*) AS count FROM customer').get()
		if (row === undefined) return 0
		return parseNumber(row, 'count')
	},

	listCustomerMetrics(db: DatabaseSync): CustomerMetricsSummary[] {
		const rows = db.prepare(`
			SELECT
				c.id AS customer_id,
				c.name AS customer_name,
				COALESCE(ct.contracts_count, 0) AS total_contracts_count,
				COALESCE(inv.open_invoices_count, 0) AS open_invoices_count,
				COALESCE(inv.paid_invoices_count, 0) AS paid_invoices_count,
				COALESCE(inv.open_balance_cents, 0) AS open_balance_cents,
				inv.oldest_open_due_date AS oldest_open_due_date
			FROM customer c
			LEFT JOIN (
				SELECT customer_id, COUNT(*) AS contracts_count
				FROM contract
				GROUP BY customer_id
			) ct ON ct.customer_id = c.id
			LEFT JOIN (
				SELECT
					customer_id,
					COUNT(CASE WHEN status = 'OPEN' THEN 1 END) AS open_invoices_count,
					COUNT(CASE WHEN status = 'PAID' THEN 1 END) AS paid_invoices_count,
					COALESCE(SUM(CASE WHEN status = 'OPEN' THEN balance_cents ELSE 0 END), 0) AS open_balance_cents,
					MIN(CASE WHEN status = 'OPEN' THEN due_date END) AS oldest_open_due_date
				FROM invoice
				GROUP BY customer_id
			) inv ON inv.customer_id = c.id
			ORDER BY c.name ASC, c.id ASC
		`).all()
		return rows.map(mapCustomerMetrics)
	},

	getCustomerMetricsById(db: DatabaseSync, customerId: string): CustomerMetricsSummary | null {
		const row = db.prepare(`
			SELECT
				c.id AS customer_id,
				c.name AS customer_name,
				COALESCE(ct.contracts_count, 0) AS total_contracts_count,
				COALESCE(inv.open_invoices_count, 0) AS open_invoices_count,
				COALESCE(inv.paid_invoices_count, 0) AS paid_invoices_count,
				COALESCE(inv.open_balance_cents, 0) AS open_balance_cents,
				inv.oldest_open_due_date AS oldest_open_due_date
			FROM customer c
			LEFT JOIN (
				SELECT customer_id, COUNT(*) AS contracts_count
				FROM contract
				WHERE customer_id = ?
				GROUP BY customer_id
			) ct ON ct.customer_id = c.id
			LEFT JOIN (
				SELECT
					customer_id,
					COUNT(CASE WHEN status = 'OPEN' THEN 1 END) AS open_invoices_count,
					COUNT(CASE WHEN status = 'PAID' THEN 1 END) AS paid_invoices_count,
					COALESCE(SUM(CASE WHEN status = 'OPEN' THEN balance_cents ELSE 0 END), 0) AS open_balance_cents,
					MIN(CASE WHEN status = 'OPEN' THEN due_date END) AS oldest_open_due_date
				FROM invoice
				WHERE customer_id = ?
				GROUP BY customer_id
			) inv ON inv.customer_id = c.id
			WHERE c.id = ?
		`).get(customerId, customerId, customerId)
		return row !== undefined ? mapCustomerMetrics(row) : null
	},
}

export const contractRepository = {
	getById(db: DatabaseSync, id: number): Contract | null {
		const row = db.prepare('SELECT * FROM contract WHERE id = ?').get(id)
		return row !== undefined ? mapContract(row) : null
	},

	listByCustomerId(db: DatabaseSync, customerId: string): Contract[] {
		const rows = db.prepare('SELECT * FROM contract WHERE customer_id = ? ORDER BY id ASC').all(customerId)
		return rows.map(mapContract)
	},

	upsert(db: DatabaseSync, input: UpsertContractInput): Contract {
		const now = new Date().toISOString()
		db.prepare(`
			INSERT INTO contract (
				id, customer_id, code, status, plan, plan_price_cents,
				branch, currency, billing_day, cutoff_day, created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET
				customer_id = excluded.customer_id,
				code = excluded.code,
				status = excluded.status,
				plan = excluded.plan,
				plan_price_cents = excluded.plan_price_cents,
				branch = excluded.branch,
				currency = excluded.currency,
				billing_day = excluded.billing_day,
				cutoff_day = excluded.cutoff_day,
				updated_at = excluded.updated_at
		`).run(
			input.id,
			input.customerId,
			input.code,
			input.status,
			input.plan,
			input.planPriceCents,
			input.branch,
			input.currency,
			input.billingDay,
			input.cutoffDay,
			now,
			now,
		)
		const result = contractRepository.getById(db, input.id)
		if (result === null) throw new Error(`Failed to retrieve contract ${input.id}`)
		return result
	},

	count(db: DatabaseSync): number {
		const row = db.prepare('SELECT COUNT(*) AS count FROM contract').get()
		if (row === undefined) return 0
		return parseNumber(row, 'count')
	},
}

export const invoiceRepository = {
	getByExternalDebtId(db: DatabaseSync, debtId: string): Invoice | null {
		const row = db.prepare('SELECT * FROM invoice WHERE external_debt_id = ?').get(debtId)
		return row !== undefined ? mapInvoice(row) : null
	},

	listByCustomerId(db: DatabaseSync, customerId: string): Invoice[] {
		const rows = db.prepare('SELECT * FROM invoice WHERE customer_id = ? ORDER BY due_date ASC').all(customerId)
		return rows.map(mapInvoice)
	},

	listOpen(db: DatabaseSync): Invoice[] {
		const rows = db.prepare('SELECT * FROM invoice WHERE status = ? ORDER BY due_date ASC').all('OPEN')
		return rows.map(mapInvoice)
	},

	getAggregateMetrics(db: DatabaseSync): InvoiceAggregateMetrics {
		const row = db.prepare(`
			SELECT
				COUNT(CASE WHEN status = 'OPEN' THEN 1 END) AS open_invoices_count,
				COUNT(CASE WHEN status = 'PAID' THEN 1 END) AS paid_invoices_count,
				COALESCE(SUM(CASE WHEN status = 'OPEN' THEN balance_cents ELSE 0 END), 0) AS total_open_balance_cents,
				MIN(CASE WHEN status = 'OPEN' THEN due_date END) AS oldest_open_due_date
			FROM invoice
		`).get()

		if (row === undefined) {
			return {
				openInvoicesCount: 0,
				paidInvoicesCount: 0,
				totalOpenBalanceCents: 0,
				oldestOpenDueDate: null,
			}
		}

		return mapInvoiceAggregateMetrics(row)
	},

	create(db: DatabaseSync, input: CreateInvoiceInput): Invoice {
		const now = new Date().toISOString()
		const status: InvoiceStatus = input.status ?? 'OPEN'

		db.prepare(`
			INSERT INTO invoice (
				invoice_number, external_debt_id, contract_id, customer_id,
				period, due_date, cut_date,
				total_amount_cents, balance_cents, status,
				created_at, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			input.invoiceNumber,
			input.externalDebtId,
			input.contractId,
			input.customerId,
			input.period,
			input.dueDate,
			input.cutDate,
			input.totalAmountCents,
			input.balanceCents,
			status,
			now,
			now,
		)

		const created = invoiceRepository.getByExternalDebtId(db, input.externalDebtId)
		if (created === null) throw new Error(`Failed to retrieve created invoice: ${input.externalDebtId}`)
		return created
	},

	markAsPaid(db: DatabaseSync, externalDebtId: string, input: MarkInvoicePaidInput): Invoice {
		const now = new Date().toISOString()
		db.prepare(`
			UPDATE invoice SET
				status = 'PAID',
				balance_cents = 0,
				paid_at = ?,
				isp_payment_invoice = ?,
				updated_at = ?
			WHERE external_debt_id = ?
		`).run(input.paidAt, input.ispPaymentInvoice, now, externalDebtId)

		const updated = invoiceRepository.getByExternalDebtId(db, externalDebtId)
		if (updated === null) throw new Error(`Invoice with externalDebtId ${externalDebtId} not found`)
		return updated
	},

	updateBalance(db: DatabaseSync, externalDebtId: string, newBalanceCents: number): Invoice {
		const now = new Date().toISOString()
		db.prepare(`
			UPDATE invoice SET
				balance_cents = ?,
				updated_at = ?
			WHERE external_debt_id = ?
		`).run(newBalanceCents, now, externalDebtId)

		const updated = invoiceRepository.getByExternalDebtId(db, externalDebtId)
		if (updated === null) throw new Error(`Invoice with externalDebtId ${externalDebtId} not found`)
		return updated
	},
}

export const syncRunRepository = {
	getById(db: DatabaseSync, id: string): SyncRun | null {
		const row = db.prepare('SELECT * FROM sync_run WHERE id = ?').get(id)
		return row !== undefined ? mapSyncRun(row) : null
	},

	list(db: DatabaseSync, limit?: number): SyncRun[] {
		if (limit !== undefined && limit > 0) {
			const rows = db.prepare('SELECT * FROM sync_run ORDER BY started_at DESC LIMIT ?').all(limit)
			return rows.map(mapSyncRun)
		}
		const rows = db.prepare('SELECT * FROM sync_run ORDER BY started_at DESC').all()
		return rows.map(mapSyncRun)
	},

	create(db: DatabaseSync, input: CreateSyncRunInput): SyncRun {
		db.prepare(`
			INSERT INTO sync_run (
				id, type, is_simulation, status,
				started_at, finished_at, error_message, summary_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			input.id,
			input.type,
			input.isSimulation ? 1 : 0,
			input.status,
			input.startedAt,
			input.finishedAt,
			input.errorMessage ?? null,
			input.summaryJson,
		)

		const created = syncRunRepository.getById(db, input.id)
		if (created === null) throw new Error(`Failed to retrieve syncRun ${input.id}`)
		return created
	},

	addDetails(db: DatabaseSync, details: readonly CreateSyncRunDetailInput[]): void {
		const stmt = db.prepare(`
			INSERT INTO sync_run_detail (
				run_id, contract_id, debt_id, period,
				amount_cents, result, reason
			) VALUES (?, ?, ?, ?, ?, ?, ?)
		`)
		for (const d of details) {
			stmt.run(d.runId, d.contractId, d.debtId, d.period, d.amountCents, d.result, d.reason)
		}
	},

	listDetailsByRunId(db: DatabaseSync, runId: string): SyncRunDetail[] {
		const rows = db.prepare('SELECT * FROM sync_run_detail WHERE run_id = ? ORDER BY id ASC').all(runId)
		return rows.map(mapSyncRunDetail)
	},
}

export const customerEventRepository = {
	create(db: DatabaseSync, input: CreateCustomerEventInput): CustomerEvent {
		const now = new Date().toISOString()
		const result = db.prepare(`
			INSERT INTO customer_event (
				customer_id, event_type, description, metadata_json, created_at
			) VALUES (?, ?, ?, ?, ?)
		`).run(
			input.customerId,
			input.eventType,
			input.description,
			input.metadataJson ?? '{}',
			now,
		)
		const rowId = Number(result.lastInsertRowid)
		const row = db.prepare('SELECT * FROM customer_event WHERE id = ?').get(rowId)
		if (row === undefined) throw new Error('Failed to retrieve newly created customer event')
		return mapCustomerEvent(row)
	},

	listByCustomerId(db: DatabaseSync, customerId: string): CustomerEvent[] {
		const rows = db.prepare('SELECT * FROM customer_event WHERE customer_id = ? ORDER BY id ASC').all(customerId)
		return rows.map(mapCustomerEvent)
	},
}
