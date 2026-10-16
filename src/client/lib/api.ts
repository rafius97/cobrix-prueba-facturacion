/**
 * Cliente HTTP tipado para consumir la API de Cobrix (/api/*).
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import type {
	ContractItemDto,
	CustomerDetailDto,
	CustomerDossierResponseDto,
	CustomerEventItemDto,
	CustomerListItemDto,
	CustomerListResponseDto,
	CustomerMetricsDto,
	ImportRunSummaryDto,
	InvoiceItemDto,
	PaymentSyncSummaryDto,
	SyncRunDetailItemDto,
	SyncRunDetailResponseDto,
	SyncRunItemDto,
	SyncRunListResponseDto,
	SyncRunStatusDto,
	SyncRunSummaryDto,
	SyncRunTriggerRequestDto,
	SyncRunTypeDto,
} from '../../shared/api-types'

// ============================================================================
// Tipos seguros para parsing JSON sin `any` ni `unknown`
// ============================================================================

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonArray
interface JsonObject {
	readonly [key: string]: JsonValue | undefined
}
type JsonArray = readonly JsonValue[]

function isJsonObject(val: JsonValue | undefined): val is JsonObject {
	return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Error tipado para fallos en las peticiones HTTP del cliente.
 */
export class ApiClientError extends Error {
	readonly statusCode: number
	readonly path?: string

	constructor(message: string, statusCode: number, path?: string) {
		super(message)
		this.name = 'ApiClientError'
		this.statusCode = statusCode
		this.path = path
	}
}

/**
 * Procesa la respuesta de error HTTP y extrae el mensaje seguro proporcionado por la API.
 */
async function parseErrorResponse(response: Response): Promise<ApiClientError> {
	try {
		const text = await response.text()
		if (text.length > 0) {
			const parsed: JsonValue = JSON.parse(text)
			if (isJsonObject(parsed)) {
				const errorMsg = typeof parsed.error === 'string' ? parsed.error : ''
				const pathMsg = typeof parsed.path === 'string' ? parsed.path : undefined
				if (errorMsg.length > 0) {
					return new ApiClientError(errorMsg, response.status, pathMsg)
				}
			}
		}
	} catch {
		// En caso de que la respuesta no sea JSON válido (p. ej. proxy o servidor caído)
	}

	if (response.status === 404) {
		return new ApiClientError('Recurso no encontrado', 404)
	}
	if (response.status === 405) {
		return new ApiClientError('Método no permitido', 405)
	}

	return new ApiClientError(`Error de comunicación con el servidor (HTTP ${response.status})`, response.status)
}

// ============================================================================
// Validadores y parseadores tipados de respuestas
// ============================================================================

function parseCustomerListItem(val: JsonValue): CustomerListItemDto {
	if (!isJsonObject(val)) throw new Error('Elemento de cliente inválido en el directorio')
	return {
		customerId: typeof val.customerId === 'string' ? val.customerId : '',
		originalDocument: typeof val.originalDocument === 'string' ? val.originalDocument : '',
		documentType: typeof val.documentType === 'string' ? val.documentType : null,
		personType: val.personType === 'JURIDICA' ? 'JURIDICA' : 'NATURAL',
		name: typeof val.name === 'string' ? val.name : '',
		totalContractsCount: typeof val.totalContractsCount === 'number' ? val.totalContractsCount : 0,
		openInvoicesCount: typeof val.openInvoicesCount === 'number' ? val.openInvoicesCount : 0,
		paidInvoicesCount: typeof val.paidInvoicesCount === 'number' ? val.paidInvoicesCount : 0,
		openBalanceCents: typeof val.openBalanceCents === 'number' ? val.openBalanceCents : 0,
		oldestOpenDueDate: typeof val.oldestOpenDueDate === 'string' ? val.oldestOpenDueDate : null,
	}
}

function parseCustomerListResponse(val: JsonValue): CustomerListResponseDto {
	if (!isJsonObject(val)) throw new Error('Respuesta de clientes con formato no compatible')
	const rawList = Array.isArray(val.customers) ? val.customers : []
	return {
		totalCount: typeof val.totalCount === 'number' ? val.totalCount : 0,
		customers: rawList.map(parseCustomerListItem),
	}
}

function parseCustomerDetail(val: JsonValue | undefined): CustomerDetailDto {
	if (!isJsonObject(val)) throw new Error('Datos del cliente inválidos en el expediente')
	return {
		id: typeof val.id === 'string' ? val.id : '',
		originalDocument: typeof val.originalDocument === 'string' ? val.originalDocument : '',
		documentType: typeof val.documentType === 'string' ? val.documentType : null,
		personType: val.personType === 'JURIDICA' ? 'JURIDICA' : 'NATURAL',
		name: typeof val.name === 'string' ? val.name : '',
		phone: typeof val.phone === 'string' ? val.phone : '',
		email: typeof val.email === 'string' ? val.email : '',
		address: typeof val.address === 'string' ? val.address : '',
		createdAt: typeof val.createdAt === 'string' ? val.createdAt : '',
		updatedAt: typeof val.updatedAt === 'string' ? val.updatedAt : '',
	}
}

function parseCustomerMetrics(val: JsonValue | undefined): CustomerMetricsDto {
	if (!isJsonObject(val)) throw new Error('Métricas inválidas en el expediente')
	return {
		totalContractsCount: typeof val.totalContractsCount === 'number' ? val.totalContractsCount : 0,
		openInvoicesCount: typeof val.openInvoicesCount === 'number' ? val.openInvoicesCount : 0,
		paidInvoicesCount: typeof val.paidInvoicesCount === 'number' ? val.paidInvoicesCount : 0,
		openBalanceCents: typeof val.openBalanceCents === 'number' ? val.openBalanceCents : 0,
		oldestOpenDueDate: typeof val.oldestOpenDueDate === 'string' ? val.oldestOpenDueDate : null,
	}
}

function parseContractItem(val: JsonValue): ContractItemDto {
	if (!isJsonObject(val)) throw new Error('Contrato inválido en el expediente')
	return {
		id: typeof val.id === 'number' ? val.id : 0,
		customerId: typeof val.customerId === 'string' ? val.customerId : '',
		code: typeof val.code === 'string' ? val.code : '',
		status: typeof val.status === 'string' ? val.status : '',
		plan: typeof val.plan === 'string' ? val.plan : '',
		planPriceCents: typeof val.planPriceCents === 'number' ? val.planPriceCents : 0,
		branch: typeof val.branch === 'string' ? val.branch : '',
		currency: typeof val.currency === 'string' ? val.currency : '',
		billingDay: typeof val.billingDay === 'number' ? val.billingDay : 0,
		cutoffDay: typeof val.cutoffDay === 'number' ? val.cutoffDay : 0,
		createdAt: typeof val.createdAt === 'string' ? val.createdAt : '',
		updatedAt: typeof val.updatedAt === 'string' ? val.updatedAt : '',
	}
}

function parseInvoiceItem(val: JsonValue): InvoiceItemDto {
	if (!isJsonObject(val)) throw new Error('Factura inválida en el expediente')
	return {
		id: typeof val.id === 'number' ? val.id : 0,
		invoiceNumber: typeof val.invoiceNumber === 'string' ? val.invoiceNumber : '',
		externalDebtId: typeof val.externalDebtId === 'string' ? val.externalDebtId : '',
		contractId: typeof val.contractId === 'number' ? val.contractId : 0,
		customerId: typeof val.customerId === 'string' ? val.customerId : '',
		period: typeof val.period === 'string' ? val.period : '',
		dueDate: typeof val.dueDate === 'string' ? val.dueDate : '',
		cutDate: typeof val.cutDate === 'string' ? val.cutDate : '',
		totalAmountCents: typeof val.totalAmountCents === 'number' ? val.totalAmountCents : 0,
		balanceCents: typeof val.balanceCents === 'number' ? val.balanceCents : 0,
		status: val.status === 'PAID' ? 'PAID' : 'OPEN',
		paidAt: typeof val.paidAt === 'string' ? val.paidAt : null,
		ispPaymentInvoice: typeof val.ispPaymentInvoice === 'string' ? val.ispPaymentInvoice : null,
		createdAt: typeof val.createdAt === 'string' ? val.createdAt : '',
		updatedAt: typeof val.updatedAt === 'string' ? val.updatedAt : '',
	}
}

function parseCustomerEventItem(val: JsonValue): CustomerEventItemDto {
	if (!isJsonObject(val)) throw new Error('Evento inválido en el expediente')
	const rawType = typeof val.eventType === 'string' ? val.eventType : ''
	const eventType: CustomerEventItemDto['eventType'] =
		rawType === 'INVOICE_IMPORTED' ||
		rawType === 'INVOICE_PAID' ||
		rawType === 'PARTIAL_PAYMENT'
			? rawType
			: 'CUSTOMER_CREATED'

	return {
		id: typeof val.id === 'number' ? val.id : 0,
		customerId: typeof val.customerId === 'string' ? val.customerId : '',
		eventType,
		description: typeof val.description === 'string' ? val.description : '',
		metadataJson: typeof val.metadataJson === 'string' ? val.metadataJson : '',
		createdAt: typeof val.createdAt === 'string' ? val.createdAt : '',
	}
}

function parseCustomerDossierResponse(val: JsonValue): CustomerDossierResponseDto {
	if (!isJsonObject(val)) throw new Error('Respuesta del expediente con formato no compatible')
	const rawContracts = Array.isArray(val.contracts) ? val.contracts : []
	const rawInvoices = Array.isArray(val.invoices) ? val.invoices : []
	const rawEvents = Array.isArray(val.events) ? val.events : []

	return {
		customer: parseCustomerDetail(val.customer),
		metrics: parseCustomerMetrics(val.metrics),
		contracts: rawContracts.map(parseContractItem),
		invoices: rawInvoices.map(parseInvoiceItem),
		events: rawEvents.map(parseCustomerEventItem),
	}
}

// ============================================================================
// Funciones públicas del cliente HTTP
// ============================================================================

/**
 * Consulta el directorio de clientes con soporte para búsqueda opcional por nombre, cédula o RIF.
 */
export async function fetchCustomers(search?: string): Promise<CustomerListResponseDto> {
	const params = new URLSearchParams()
	if (search !== undefined && search.trim().length > 0) {
		params.set('search', search.trim())
	}

	const query = params.toString()
	const url = query.length > 0 ? `/api/customers?${query}` : '/api/customers'

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
		},
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseCustomerListResponse(parsed)
}

/**
 * Consulta el expediente completo de un cliente a partir de su identificador normalizado.
 */
export async function fetchCustomerDossier(customerId: string): Promise<CustomerDossierResponseDto> {
	const normalizedId = customerId.trim()
	if (normalizedId.length === 0) {
		throw new ApiClientError('El identificador del cliente no puede estar vacío', 400)
	}

	const encodedId = encodeURIComponent(normalizedId)
	const url = `/api/customers/${encodedId}`

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
		},
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseCustomerDossierResponse(parsed)
}

// ============================================================================
// Validadores y parseadores tipados de sincronización
// ============================================================================

function parseImportRunSummary(val: JsonValue): ImportRunSummaryDto {
	if (!isJsonObject(val)) throw new Error('Resumen de importación inválido')
	return {
		type: 'IMPORT',
		isSimulation: val.isSimulation === true,
		durationMs: typeof val.durationMs === 'number' ? val.durationMs : 0,
		totalContractsInspected: typeof val.totalContractsInspected === 'number' ? val.totalContractsInspected : 0,
		totalInstallmentsEvaluated: typeof val.totalInstallmentsEvaluated === 'number' ? val.totalInstallmentsEvaluated : 0,
		importedInvoicesCount: typeof val.importedInvoicesCount === 'number' ? val.importedInvoicesCount : 0,
		importedAmountCents: typeof val.importedAmountCents === 'number' ? val.importedAmountCents : 0,
		newCustomersCount: typeof val.newCustomersCount === 'number' ? val.newCustomersCount : 0,
		alreadyImportedCount: typeof val.alreadyImportedCount === 'number' ? val.alreadyImportedCount : 0,
		excludedByStatusCount: typeof val.excludedByStatusCount === 'number' ? val.excludedByStatusCount : 0,
		excludedByDocumentTypeCount: typeof val.excludedByDocumentTypeCount === 'number' ? val.excludedByDocumentTypeCount : 0,
		outOfWindowCount: typeof val.outOfWindowCount === 'number' ? val.outOfWindowCount : 0,
		excludedByMaxInstallmentsCount: typeof val.excludedByMaxInstallmentsCount === 'number' ? val.excludedByMaxInstallmentsCount : 0,
		limitReachedCount: typeof val.limitReachedCount === 'number' ? val.limitReachedCount : 0,
		inconsistentCurrencyCount: typeof val.inconsistentCurrencyCount === 'number' ? val.inconsistentCurrencyCount : 0,
		residualBalanceCount: typeof val.residualBalanceCount === 'number' ? val.residualBalanceCount : 0,
		noDebtCount: typeof val.noDebtCount === 'number' ? val.noDebtCount : 0,
		invalidIdentificationCount: typeof val.invalidIdentificationCount === 'number' ? val.invalidIdentificationCount : 0,
		invalidDataCount: typeof val.invalidDataCount === 'number' ? val.invalidDataCount : 0,
	}
}

function parsePaymentSyncSummary(val: JsonValue): PaymentSyncSummaryDto {
	if (!isJsonObject(val)) throw new Error('Resumen de conciliación de pagos inválido')
	return {
		type: 'PAYMENT_UPDATE',
		isSimulation: val.isSimulation === true,
		durationMs: typeof val.durationMs === 'number' ? val.durationMs : 0,
		totalInvoicesInspected: typeof val.totalInvoicesInspected === 'number' ? val.totalInvoicesInspected : 0,
		totalContractsInspected: typeof val.totalContractsInspected === 'number' ? val.totalContractsInspected : 0,
		markedPaidCount: typeof val.markedPaidCount === 'number' ? val.markedPaidCount : 0,
		markedPaidAmountCents: typeof val.markedPaidAmountCents === 'number' ? val.markedPaidAmountCents : 0,
		partialPaymentsCount: typeof val.partialPaymentsCount === 'number' ? val.partialPaymentsCount : 0,
		partialPaymentsAmountCents: typeof val.partialPaymentsAmountCents === 'number' ? val.partialPaymentsAmountCents : 0,
		stillOpenCount: typeof val.stillOpenCount === 'number' ? val.stillOpenCount : 0,
		stillOpenBalanceCents: typeof val.stillOpenBalanceCents === 'number' ? val.stillOpenBalanceCents : 0,
		exemptionCount: typeof val.exemptionCount === 'number' ? val.exemptionCount : 0,
		noEvidenceCount: typeof val.noEvidenceCount === 'number' ? val.noEvidenceCount : 0,
		contradictoryDataCount: typeof val.contradictoryDataCount === 'number' ? val.contradictoryDataCount : 0,
		invalidDataCount: typeof val.invalidDataCount === 'number' ? val.invalidDataCount : 0,
	}
}

export function parseSyncRunItem(val: JsonValue): SyncRunItemDto {
	if (!isJsonObject(val)) throw new Error('Corrida de sincronización inválida')

	const rawType = val.type
	const type: SyncRunTypeDto = rawType === 'PAYMENT_UPDATE' ? 'PAYMENT_UPDATE' : 'IMPORT'
	const rawStatus = val.status
	const status: SyncRunStatusDto = rawStatus === 'FAILED' ? 'FAILED' : 'COMPLETED'

	let summary: SyncRunSummaryDto | null = null
	if (isJsonObject(val.summary)) {
		if (val.summary.type === 'PAYMENT_UPDATE') {
			summary = parsePaymentSyncSummary(val.summary)
		} else {
			summary = parseImportRunSummary(val.summary)
		}
	}

	return {
		id: typeof val.id === 'string' ? val.id : '',
		type,
		isSimulation: val.isSimulation === true,
		status,
		startedAt: typeof val.startedAt === 'string' ? val.startedAt : '',
		finishedAt: typeof val.finishedAt === 'string' ? val.finishedAt : '',
		errorMessage: typeof val.errorMessage === 'string' ? val.errorMessage : null,
		summary,
	}
}

function parseSyncRunListResponse(val: JsonValue): SyncRunListResponseDto {
	if (!isJsonObject(val)) throw new Error('Respuesta de historial de sincronización inválida')
	const rawRuns = Array.isArray(val.runs) ? val.runs : []
	const runs = rawRuns.map(r => parseSyncRunItem(r))
	return {
		runs,
		totalCount: typeof val.totalCount === 'number' ? val.totalCount : runs.length,
	}
}

// ============================================================================
// Funciones públicas de sincronización
// ============================================================================

/**
 * Consulta el historial de corridas de sincronización registradas.
 */
export async function fetchSyncRuns(limit: number = 20): Promise<SyncRunListResponseDto> {
	const safeLimit = Math.max(1, Math.min(limit, 100))
	const url = `/api/sync/runs?limit=${safeLimit}`

	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
		},
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseSyncRunListResponse(parsed)
}

/**
 * Dispara una corrida de importación de facturas y deudas (o su simulación).
 */
export async function triggerImportSync(isSimulation: boolean): Promise<SyncRunItemDto> {
	const requestBody: SyncRunTriggerRequestDto = { isSimulation }

	const response = await fetch('/api/sync/import', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify(requestBody),
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseSyncRunItem(parsed)
}

/**
 * Dispara una corrida de actualización y conciliación de facturas pagadas (o su simulación).
 */
export async function triggerPaymentSync(isSimulation: boolean): Promise<SyncRunItemDto> {
	const requestBody: SyncRunTriggerRequestDto = { isSimulation }

	const response = await fetch('/api/sync/payments', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
		},
		body: JSON.stringify(requestBody),
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseSyncRunItem(parsed)
}

function parseSyncRunDetailItem(val: JsonValue): SyncRunDetailItemDto {
	if (!isJsonObject(val)) throw new Error('Elemento de detalle de corrida inválido')
	return {
		id: typeof val.id === 'number' ? val.id : 0,
		runId: typeof val.runId === 'string' ? val.runId : '',
		contractId: typeof val.contractId === 'number' ? val.contractId : 0,
		debtId: typeof val.debtId === 'string' ? val.debtId : '',
		period: typeof val.period === 'string' ? val.period : '',
		amountCents: typeof val.amountCents === 'number' ? val.amountCents : 0,
		result: typeof val.result === 'string' ? val.result : '',
		reason: typeof val.reason === 'string' ? val.reason : '',
	}
}

function parseSyncRunDetailResponse(val: JsonValue): SyncRunDetailResponseDto {
	if (!isJsonObject(val)) throw new Error('Respuesta de detalle de corrida inválida')
	const rawRun = val.run
	if (!isJsonObject(rawRun)) throw new Error('La respuesta debe contener la cabecera de la corrida (run)')
	const run = parseSyncRunItem(rawRun)

	const rawDetails = Array.isArray(val.details) ? val.details : []
	const details = rawDetails.map(d => parseSyncRunDetailItem(d))

	return {
		run,
		details,
	}
}

/**
 * Obtiene el detalle completo y auditoría de una corrida de sincronización específica por su ID.
 */
export async function fetchSyncRunDetail(runId: string): Promise<SyncRunDetailResponseDto> {
	const sanitizedId = runId.trim()
	if (sanitizedId.length === 0) {
		throw new ApiClientError('Identificador de corrida no especificado', 400)
	}

	const url = `/api/sync/runs/${encodeURIComponent(sanitizedId)}`
	const response = await fetch(url, {
		method: 'GET',
		headers: {
			Accept: 'application/json',
		},
	})

	if (!response.ok) {
		throw await parseErrorResponse(response)
	}

	const rawText = await response.text()
	const parsed: JsonValue = JSON.parse(rawText)
	return parseSyncRunDetailResponse(parsed)
}
