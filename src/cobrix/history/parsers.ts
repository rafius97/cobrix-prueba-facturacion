/**
 * Parsers y validadores fuertemente tipados para el historial y resúmenes de corridas de Cobrix.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import type {
	ImportRunSummary,
	PaymentSyncSummary,
	RawSyncRunInput,
	SyncRun,
	TypedImportSyncRun,
	TypedPaymentSyncRun,
	TypedSyncRun,
	TypedSyncRunSummary,
} from './types.ts'

// ============================================================================
// Tipos seguros para parsing JSON (sin `any`, sin `unknown`)
// ============================================================================

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export interface JsonObject {
	readonly [key: string]: JsonValue | undefined
}
export type JsonArray = readonly JsonValue[]

/**
 * Error de dominio lanzado cuando la deserialización o validación de un resumen falla.
 */
export class HistoryParseError extends Error {
	readonly field?: string
	readonly rawSnippet?: string

	constructor(
		message: string,
		options?: {
			readonly field?: string
			readonly rawSnippet?: string
			readonly cause?: Error
		},
	) {
		super(message, options?.cause !== undefined ? { cause: options.cause } : undefined)
		this.name = 'HistoryParseError'
		this.field = options?.field
		this.rawSnippet = options?.rawSnippet
	}
}

// ============================================================================
// Funciones auxiliares de validación
// ============================================================================

/**
 * Parsea una cadena de texto en un JsonValue fuertemente tipado.
 * Lanza HistoryParseError si la cadena está vacía o el JSON es inválido.
 */
export function safeJsonParse(text: string): JsonValue {
	if (text.trim() === '') {
		throw new HistoryParseError('Summary JSON cannot be empty')
	}

	try {
		const parsed: JsonValue = JSON.parse(text)
		return parsed
	} catch (error) {
		const snippet = text.length > 100 ? `${text.slice(0, 100)}...` : text
		throw new HistoryParseError('Summary JSON is not valid JSON', {
			rawSnippet: snippet,
			cause: error instanceof Error ? error : undefined,
		})
	}
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Asegura que un JsonValue es un objeto JSON no nulo y no arreglo.
 */
export function ensureJsonObject(value: JsonValue): JsonObject {
	if (!isJsonObject(value)) {
		throw new HistoryParseError('Summary JSON must be a JSON object')
	}
	return value
}

function requireString(obj: JsonObject, key: string): string {
	const val = obj[key]
	if (typeof val !== 'string') {
		throw new HistoryParseError(`Property '${key}' must be a string`, { field: key })
	}
	return val
}

function requireNumber(obj: JsonObject, key: string): number {
	const val = obj[key]
	if (typeof val !== 'number' || !Number.isFinite(val)) {
		throw new HistoryParseError(`Property '${key}' must be a valid number`, { field: key })
	}
	return val
}

function requireBoolean(obj: JsonObject, key: string): boolean {
	const val = obj[key]
	if (typeof val !== 'boolean') {
		throw new HistoryParseError(`Property '${key}' must be a boolean`, { field: key })
	}
	return val
}

// ============================================================================
// Parsers específicos por tipo de resumen
// ============================================================================

/**
 * Valida y extrae un ImportRunSummary a partir de un objeto JSON verificado.
 */
export function parseImportRunSummaryFromObject(obj: JsonObject): ImportRunSummary {
	return {
		runId: requireString(obj, 'runId'),
		isSimulation: requireBoolean(obj, 'isSimulation'),
		startedAt: requireString(obj, 'startedAt'),
		finishedAt: requireString(obj, 'finishedAt'),
		durationMs: requireNumber(obj, 'durationMs'),
		totalContractsInspected: requireNumber(obj, 'totalContractsInspected'),
		totalInstallmentsEvaluated: requireNumber(obj, 'totalInstallmentsEvaluated'),
		importedInvoicesCount: requireNumber(obj, 'importedInvoicesCount'),
		importedAmountCents: requireNumber(obj, 'importedAmountCents'),
		newCustomersCount: requireNumber(obj, 'newCustomersCount'),
		alreadyImportedCount: requireNumber(obj, 'alreadyImportedCount'),
		excludedByStatusCount: requireNumber(obj, 'excludedByStatusCount'),
		excludedByDocumentTypeCount: requireNumber(obj, 'excludedByDocumentTypeCount'),
		outOfWindowCount: requireNumber(obj, 'outOfWindowCount'),
		excludedByMaxInstallmentsCount: requireNumber(obj, 'excludedByMaxInstallmentsCount'),
		limitReachedCount: requireNumber(obj, 'limitReachedCount'),
		inconsistentCurrencyCount: requireNumber(obj, 'inconsistentCurrencyCount'),
		residualBalanceCount: requireNumber(obj, 'residualBalanceCount'),
		noDebtCount: requireNumber(obj, 'noDebtCount'),
		invalidIdentificationCount: requireNumber(obj, 'invalidIdentificationCount'),
		invalidDataCount: requireNumber(obj, 'invalidDataCount'),
	}
}

/**
 * Valida y extrae un PaymentSyncSummary a partir de un objeto JSON verificado.
 */
export function parsePaymentSyncSummaryFromObject(obj: JsonObject): PaymentSyncSummary {
	return {
		runId: requireString(obj, 'runId'),
		isSimulation: requireBoolean(obj, 'isSimulation'),
		startedAt: requireString(obj, 'startedAt'),
		finishedAt: requireString(obj, 'finishedAt'),
		durationMs: requireNumber(obj, 'durationMs'),
		totalInvoicesInspected: requireNumber(obj, 'totalInvoicesInspected'),
		totalContractsInspected: requireNumber(obj, 'totalContractsInspected'),
		markedPaidCount: requireNumber(obj, 'markedPaidCount'),
		markedPaidAmountCents: requireNumber(obj, 'markedPaidAmountCents'),
		partialPaymentsCount: requireNumber(obj, 'partialPaymentsCount'),
		partialPaymentsAmountCents: requireNumber(obj, 'partialPaymentsAmountCents'),
		stillOpenCount: requireNumber(obj, 'stillOpenCount'),
		stillOpenBalanceCents: requireNumber(obj, 'stillOpenBalanceCents'),
		exemptionCount: requireNumber(obj, 'exemptionCount'),
		noEvidenceCount: requireNumber(obj, 'noEvidenceCount'),
		contradictoryDataCount: requireNumber(obj, 'contradictoryDataCount'),
		invalidDataCount: requireNumber(obj, 'invalidDataCount'),
	}
}

/**
 * Parsea y valida una cadena JSON como un ImportRunSummary fuertemente tipado.
 */
export function parseImportRunSummary(summaryJson: string): ImportRunSummary {
	const parsed = safeJsonParse(summaryJson)
	const obj = ensureJsonObject(parsed)
	return parseImportRunSummaryFromObject(obj)
}

/**
 * Parsea y valida una cadena JSON como un PaymentSyncSummary fuertemente tipado.
 */
export function parsePaymentSyncSummary(summaryJson: string): PaymentSyncSummary {
	const parsed = safeJsonParse(summaryJson)
	const obj = ensureJsonObject(parsed)
	return parsePaymentSyncSummaryFromObject(obj)
}

/**
 * Parsea y valida una cadena JSON deduciendo o respetando el tipo de corrida.
 * Si se especifica `expectedType`, se valida que sea un tipo conocido ('IMPORT' | 'PAYMENT_UPDATE')
 * y que la estructura sea estrictamente compatible.
 */
export function parseSyncRunSummary(summaryJson: string, expectedType?: string): TypedSyncRunSummary {
	const parsed = safeJsonParse(summaryJson)
	const obj = ensureJsonObject(parsed)

	if (expectedType !== undefined) {
		if (expectedType !== 'IMPORT' && expectedType !== 'PAYMENT_UPDATE') {
			throw new HistoryParseError(`Unknown run type: '${expectedType}'`)
		}

		if (expectedType === 'IMPORT') {
			const typeInObj = obj['type']
			if (typeof typeInObj === 'string' && typeInObj !== 'IMPORT') {
				throw new HistoryParseError(`Summary JSON type '${typeInObj}' is incompatible with expected type 'IMPORT'`)
			}
			const summary = parseImportRunSummaryFromObject(obj)
			return { type: 'IMPORT', summary }
		}

		const typeInObj = obj['type']
		if (typeof typeInObj === 'string' && typeInObj !== 'PAYMENT_UPDATE') {
			throw new HistoryParseError(`Summary JSON type '${typeInObj}' is incompatible with expected type 'PAYMENT_UPDATE'`)
		}
		const summary = parsePaymentSyncSummaryFromObject(obj)
		return { type: 'PAYMENT_UPDATE', summary }
	}

	// Si no se proporcionó un tipo esperado, examinar propiedades explícitas del objeto
	const typeProp = obj['type']
	if (typeProp !== undefined) {
		if (typeof typeProp !== 'string') {
			throw new HistoryParseError("Property 'type' must be a string", { field: 'type' })
		}
		if (typeProp !== 'IMPORT' && typeProp !== 'PAYMENT_UPDATE') {
			throw new HistoryParseError(`Unknown run type: '${typeProp}'`)
		}
		if (typeProp === 'IMPORT') {
			return { type: 'IMPORT', summary: parseImportRunSummaryFromObject(obj) }
		}
		return { type: 'PAYMENT_UPDATE', summary: parsePaymentSyncSummaryFromObject(obj) }
	}

	const runTypeProp = obj['runType']
	if (runTypeProp !== undefined) {
		if (typeof runTypeProp !== 'string') {
			throw new HistoryParseError("Property 'runType' must be a string", { field: 'runType' })
		}
		if (runTypeProp !== 'IMPORT' && runTypeProp !== 'PAYMENT_UPDATE') {
			throw new HistoryParseError(`Unknown run type: '${runTypeProp}'`)
		}
		if (runTypeProp === 'IMPORT') {
			return { type: 'IMPORT', summary: parseImportRunSummaryFromObject(obj) }
		}
		return { type: 'PAYMENT_UPDATE', summary: parsePaymentSyncSummaryFromObject(obj) }
	}

	// Detección estructural basada en campos exclusivos de cada tipo de resumen
	const hasImportMarkers = obj['importedInvoicesCount'] !== undefined || obj['totalInstallmentsEvaluated'] !== undefined
	const hasPaymentMarkers = obj['markedPaidCount'] !== undefined || obj['totalInvoicesInspected'] !== undefined

	if (hasImportMarkers && !hasPaymentMarkers) {
		return { type: 'IMPORT', summary: parseImportRunSummaryFromObject(obj) }
	}

	if (hasPaymentMarkers && !hasImportMarkers) {
		return { type: 'PAYMENT_UPDATE', summary: parsePaymentSyncSummaryFromObject(obj) }
	}

	throw new HistoryParseError('Unable to determine run type from summary JSON: structure is ambiguous or unrecognized')
}

/**
 * Transforma un registro de persistencia SyncRun en un TypedSyncRun fuertemente tipado.
 * Lanza HistoryParseError si el tipo es desconocido o el JSON del resumen es inválido.
 */
export function parseTypedSyncRun(run: RawSyncRunInput | SyncRun): TypedSyncRun {
	if (run.type !== 'IMPORT' && run.type !== 'PAYMENT_UPDATE') {
		throw new HistoryParseError(`Unknown run type: '${run.type}'`)
	}

	if (run.type === 'IMPORT') {
		const summary = parseImportRunSummary(run.summaryJson)
		const typedRun: TypedImportSyncRun = {
			id: run.id,
			type: 'IMPORT',
			isSimulation: run.isSimulation,
			status: run.status,
			startedAt: run.startedAt,
			finishedAt: run.finishedAt,
			errorMessage: run.errorMessage,
			summaryJson: run.summaryJson,
			summary,
		}
		return typedRun
	}

	const summary = parsePaymentSyncSummary(run.summaryJson)
	const typedRun: TypedPaymentSyncRun = {
		id: run.id,
		type: 'PAYMENT_UPDATE',
		isSimulation: run.isSimulation,
		status: run.status,
		startedAt: run.startedAt,
		finishedAt: run.finishedAt,
		errorMessage: run.errorMessage,
		summaryJson: run.summaryJson,
		summary,
	}
	return typedRun
}
