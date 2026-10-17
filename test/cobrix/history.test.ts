/**
 * Pruebas unitarias para el modelo y parser tipado del historial de sincronización.
 * Historial: Validación estricta de ImportRunSummary y PaymentSyncSummary.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { SyncRun } from '../../src/cobrix/db/types.ts'
import {
	HistoryParseError,
	parseImportRunSummary,
	parsePaymentSyncSummary,
	parseSyncRunSummary,
	parseTypedSyncRun,
} from '../../src/cobrix/history/parsers.ts'
import type {
	ImportRunSummary,
	PaymentSyncSummary,
	RawSyncRunInput,
	TypedImportSyncRun,
	TypedPaymentSyncRun,
} from '../../src/cobrix/history/types.ts'

// ============================================================================
// Fixtures de prueba válidos
// ============================================================================

const validImportSummary: ImportRunSummary = {
	runId: 'import-run-001',
	isSimulation: false,
	startedAt: '2026-10-13T10:00:00.000Z',
	finishedAt: '2026-10-13T10:00:05.123Z',
	durationMs: 5123,
	totalContractsInspected: 10,
	totalInstallmentsEvaluated: 15,
	importedInvoicesCount: 8,
	importedAmountCents: 150000,
	newCustomersCount: 5,
	alreadyImportedCount: 2,
	excludedByStatusCount: 1,
	excludedByDocumentTypeCount: 1,
	outOfWindowCount: 1,
	excludedByMaxInstallmentsCount: 0,
	limitReachedCount: 0,
	inconsistentCurrencyCount: 1,
	residualBalanceCount: 1,
	noDebtCount: 0,
	invalidIdentificationCount: 0,
	invalidDataCount: 0,
}

const validPaymentSummary: PaymentSyncSummary = {
	runId: 'payment-run-001',
	isSimulation: true,
	startedAt: '2026-10-13T11:00:00.000Z',
	finishedAt: '2026-10-13T11:00:02.456Z',
	durationMs: 2456,
	totalInvoicesInspected: 8,
	totalContractsInspected: 6,
	markedPaidCount: 5,
	markedPaidAmountCents: 95000,
	partialPaymentsCount: 1,
	partialPaymentsAmountCents: 2000,
	stillOpenCount: 2,
	stillOpenBalanceCents: 35000,
	exemptionCount: 0,
	noEvidenceCount: 0,
	contradictoryDataCount: 0,
	invalidDataCount: 0,
}

const validImportSyncRun: SyncRun = {
	id: 'import-run-001',
	type: 'IMPORT',
	triggerType: 'MANUAL',
	isSimulation: false,
	status: 'COMPLETED',
	startedAt: '2026-10-13T10:00:00.000Z',
	finishedAt: '2026-10-13T10:00:05.123Z',
	errorMessage: null,
	summaryJson: JSON.stringify(validImportSummary),
}

const validPaymentSyncRun: SyncRun = {
	id: 'payment-run-001',
	type: 'PAYMENT_UPDATE',
	triggerType: 'MANUAL',
	isSimulation: true,
	status: 'COMPLETED',
	startedAt: '2026-10-13T11:00:00.000Z',
	finishedAt: '2026-10-13T11:00:02.456Z',
	errorMessage: null,
	summaryJson: JSON.stringify(validPaymentSummary),
}

// ============================================================================
// Helper de verificación sin unknown ni any
// ============================================================================

function expectHistoryParseError(
	fn: () => void,
	expectedSubstring: string,
	expectedField?: string,
): void {
	assert.throws(
		fn,
		(error: Error) => {
			assert.ok(error instanceof HistoryParseError)
			assert.ok(
				error.message.includes(expectedSubstring),
				`Se esperaba que el error incluyera '${expectedSubstring}', pero se obtuvo '${error.message}'`,
			)
			if (expectedField !== undefined) {
				assert.strictEqual(error.field, expectedField)
			}
			return true
		},
	)
}

// ============================================================================
// Casos de prueba
// ============================================================================

describe('Historial: Parsing y validación de resúmenes tipados', () => {
	describe('Casos válidos de importación (IMPORT)', () => {
		it('parsea correctamente un ImportRunSummary válido desde JSON', () => {
			const json = JSON.stringify(validImportSummary)
			const parsed = parseImportRunSummary(json)

			assert.strictEqual(parsed.runId, 'import-run-001')
			assert.strictEqual(parsed.isSimulation, false)
			assert.strictEqual(parsed.totalContractsInspected, 10)
			assert.strictEqual(parsed.totalInstallmentsEvaluated, 15)
			assert.strictEqual(parsed.importedInvoicesCount, 8)
			assert.strictEqual(parsed.importedAmountCents, 150000)
			assert.strictEqual(parsed.durationMs, 5123)
		})

		it('parsea correctamente un resumen de importación mediante parseSyncRunSummary con tipo explícito', () => {
			const json = JSON.stringify(validImportSummary)
			const result = parseSyncRunSummary(json, 'IMPORT')

			assert.strictEqual(result.type, 'IMPORT')
			assert.strictEqual(result.summary.importedInvoicesCount, 8)
			assert.strictEqual(result.summary.runId, 'import-run-001')
		})

		it('autodetecta y parsea correctamente un resumen de importación mediante parseSyncRunSummary', () => {
			const json = JSON.stringify(validImportSummary)
			const result = parseSyncRunSummary(json)

			assert.strictEqual(result.type, 'IMPORT')
			assert.strictEqual(result.summary.importedInvoicesCount, 8)
		})

		it('parsea un SyncRun de persistencia a TypedImportSyncRun preservando todos los campos', () => {
			const typed = parseTypedSyncRun(validImportSyncRun)

			assert.strictEqual(typed.type, 'IMPORT')
			assert.strictEqual(typed.id, 'import-run-001')
			assert.strictEqual(typed.status, 'COMPLETED')
			assert.strictEqual(typed.isSimulation, false)
			assert.strictEqual(typed.summary.importedInvoicesCount, 8)
			assert.strictEqual(typed.summary.durationMs, 5123)

			// Verificación de discriminación estricta de tipos
			const isImportRun = (run: typeof typed): run is TypedImportSyncRun => run.type === 'IMPORT'
			assert.strictEqual(isImportRun(typed), true)
		})
	})

	describe('Casos válidos de conciliación de pagos (PAYMENT_UPDATE)', () => {
		it('parsea correctamente un PaymentSyncSummary válido desde JSON', () => {
			const json = JSON.stringify(validPaymentSummary)
			const parsed = parsePaymentSyncSummary(json)

			assert.strictEqual(parsed.runId, 'payment-run-001')
			assert.strictEqual(parsed.isSimulation, true)
			assert.strictEqual(parsed.totalInvoicesInspected, 8)
			assert.strictEqual(parsed.markedPaidCount, 5)
			assert.strictEqual(parsed.markedPaidAmountCents, 95000)
			assert.strictEqual(parsed.partialPaymentsCount, 1)
			assert.strictEqual(parsed.durationMs, 2456)
		})

		it('parsea correctamente un resumen de pagos mediante parseSyncRunSummary con tipo explícito', () => {
			const json = JSON.stringify(validPaymentSummary)
			const result = parseSyncRunSummary(json, 'PAYMENT_UPDATE')

			assert.strictEqual(result.type, 'PAYMENT_UPDATE')
			assert.strictEqual(result.summary.markedPaidCount, 5)
			assert.strictEqual(result.summary.runId, 'payment-run-001')
		})

		it('autodetecta y parsea correctamente un resumen de pagos mediante parseSyncRunSummary', () => {
			const json = JSON.stringify(validPaymentSummary)
			const result = parseSyncRunSummary(json)

			assert.strictEqual(result.type, 'PAYMENT_UPDATE')
			assert.strictEqual(result.summary.markedPaidCount, 5)
		})

		it('parsea un SyncRun de persistencia a TypedPaymentSyncRun preservando todos los campos', () => {
			const typed = parseTypedSyncRun(validPaymentSyncRun)

			assert.strictEqual(typed.type, 'PAYMENT_UPDATE')
			assert.strictEqual(typed.id, 'payment-run-001')
			assert.strictEqual(typed.status, 'COMPLETED')
			assert.strictEqual(typed.isSimulation, true)
			assert.strictEqual(typed.summary.markedPaidCount, 5)
			assert.strictEqual(typed.summary.stillOpenBalanceCents, 35000)

			// Verificación de discriminación estricta de tipos
			const isPaymentRun = (run: typeof typed): run is TypedPaymentSyncRun => run.type === 'PAYMENT_UPDATE'
			assert.strictEqual(isPaymentRun(typed), true)
		})
	})

	describe('Casos inválidos de sintaxis y estructura vacía', () => {
		it('rechaza JSON sintácticamente inválido con HistoryParseError', () => {
			expectHistoryParseError(() => parseImportRunSummary('{ invalid json'), 'not valid JSON')
			expectHistoryParseError(() => parsePaymentSyncSummary('{ invalid json'), 'not valid JSON')
			expectHistoryParseError(() => parseSyncRunSummary('{ invalid json'), 'not valid JSON')
		})

		it('rechaza cadena vacía o compuesta solo por espacios en blanco con HistoryParseError', () => {
			expectHistoryParseError(() => parseImportRunSummary(''), 'cannot be empty')
			expectHistoryParseError(() => parsePaymentSyncSummary('   '), 'cannot be empty')
			expectHistoryParseError(() => parseSyncRunSummary(''), 'cannot be empty')
		})
	})

	describe('Casos inválidos de tipo de corrida desconocido', () => {
		it('rechaza un tipo de corrida desconocido pasado como expectedType', () => {
			const json = JSON.stringify(validImportSummary)
			expectHistoryParseError(() => parseSyncRunSummary(json, 'UNKNOWN_TYPE'), "Unknown run type: 'UNKNOWN_TYPE'")
		})

		it('rechaza un JSON con propiedad type desconocida', () => {
			const json = JSON.stringify({ ...validImportSummary, type: 'ARBITRARY_TYPE' })
			expectHistoryParseError(() => parseSyncRunSummary(json), "Unknown run type: 'ARBITRARY_TYPE'")
		})

		it('rechaza un JSON con propiedad runType desconocida', () => {
			const json = JSON.stringify({ ...validPaymentSummary, runType: 'INVALID_RUN_TYPE' })
			expectHistoryParseError(() => parseSyncRunSummary(json), "Unknown run type: 'INVALID_RUN_TYPE'")
		})

		it('rechaza un SyncRun cuyo type no es ni IMPORT ni PAYMENT_UPDATE', () => {
			const invalidRun: RawSyncRunInput = {
				id: 'invalid-run-001',
				type: 'OTHER',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-13T10:00:00.000Z',
				finishedAt: '2026-10-13T10:00:05.123Z',
				errorMessage: null,
				summaryJson: JSON.stringify(validImportSummary),
			}
			expectHistoryParseError(() => parseTypedSyncRun(invalidRun), "Unknown run type: 'OTHER'")
		})
	})

	describe('Casos inválidos de campos obligatorios ausentes', () => {
		it('falla cuando a un ImportRunSummary le falta durationMs', () => {
			const { durationMs: _unused, ...incomplete } = validImportSummary
			const json = JSON.stringify(incomplete)
			expectHistoryParseError(() => parseImportRunSummary(json), "Property 'durationMs' must be a valid number", 'durationMs')
		})

		it('falla cuando a un ImportRunSummary le falta un contador requerido como importedInvoicesCount', () => {
			const { importedInvoicesCount: _unused, ...incomplete } = validImportSummary
			const json = JSON.stringify(incomplete)
			expectHistoryParseError(() => parseImportRunSummary(json), "Property 'importedInvoicesCount' must be a valid number", 'importedInvoicesCount')
		})

		it('falla cuando a un PaymentSyncSummary le falta markedPaidCount', () => {
			const { markedPaidCount: _unused, ...incomplete } = validPaymentSummary
			const json = JSON.stringify(incomplete)
			expectHistoryParseError(() => parsePaymentSyncSummary(json), "Property 'markedPaidCount' must be a valid number", 'markedPaidCount')
		})

		it('falla cuando a un PaymentSyncSummary le falta isSimulation', () => {
			const { isSimulation: _unused, ...incomplete } = validPaymentSummary
			const json = JSON.stringify(incomplete)
			expectHistoryParseError(() => parsePaymentSyncSummary(json), "Property 'isSimulation' must be a boolean", 'isSimulation')
		})
	})

	describe('Casos inválidos de tipos de datos incorrectos', () => {
		it('falla cuando durationMs es una cadena en lugar de un número', () => {
			const invalid = { ...validImportSummary, durationMs: '5000' }
			const json = JSON.stringify(invalid)
			expectHistoryParseError(() => parseImportRunSummary(json), "Property 'durationMs' must be a valid number", 'durationMs')
		})

		it('falla cuando isSimulation es un número en lugar de un booleano', () => {
			const invalid = { ...validImportSummary, isSimulation: 1 }
			const json = JSON.stringify(invalid)
			expectHistoryParseError(() => parseImportRunSummary(json), "Property 'isSimulation' must be a boolean", 'isSimulation')
		})

		it('falla cuando un contador numérico es null o no numérico', () => {
			const invalid = { ...validPaymentSummary, markedPaidAmountCents: null }
			const json = JSON.stringify(invalid)
			expectHistoryParseError(() => parsePaymentSyncSummary(json), "Property 'markedPaidAmountCents' must be a valid number", 'markedPaidAmountCents')
		})
	})

	describe('Casos de incompatibilidad estructural entre tipos esperados', () => {
		it('falla al intentar parsear un PaymentSyncSummary como ImportRunSummary', () => {
			const json = JSON.stringify(validPaymentSummary)
			expectHistoryParseError(() => parseImportRunSummary(json), "Property 'totalInstallmentsEvaluated' must be a valid number", 'totalInstallmentsEvaluated')
			expectHistoryParseError(() => parseSyncRunSummary(json, 'IMPORT'), "Property 'totalInstallmentsEvaluated' must be a valid number", 'totalInstallmentsEvaluated')
		})

		it('falla al intentar parsear un ImportRunSummary como PaymentSyncSummary', () => {
			const json = JSON.stringify(validImportSummary)
			expectHistoryParseError(() => parsePaymentSyncSummary(json), "Property 'totalInvoicesInspected' must be a valid number", 'totalInvoicesInspected')
			expectHistoryParseError(() => parseSyncRunSummary(json, 'PAYMENT_UPDATE'), "Property 'totalInvoicesInspected' must be a valid number", 'totalInvoicesInspected')
		})

		it('rechaza una estructura JSON válida pero no correspondiente a ningún resumen conocido', () => {
			const arbitraryJson = JSON.stringify({
				title: 'Random Object',
				count: 42,
				items: ['a', 'b'],
			})
			expectHistoryParseError(() => parseSyncRunSummary(arbitraryJson), 'Unable to determine run type from summary JSON')
		})

		it('falla cuando la propiedad type en el JSON contradice el expectedType solicitado', () => {
			const contradictoryJson = JSON.stringify({
				...validPaymentSummary,
				type: 'PAYMENT_UPDATE',
			})
			expectHistoryParseError(() => parseSyncRunSummary(contradictoryJson, 'IMPORT'), "Summary JSON type 'PAYMENT_UPDATE' is incompatible with expected type 'IMPORT'")
		})
	})

	describe('Seguridad de tipado y no aceptación de estructuras arbitrarias', () => {
		it('rechaza primitivos JSON como cadenas, números, booleanos o null', () => {
			expectHistoryParseError(() => parseImportRunSummary('"solo un string"'), 'Summary JSON must be a JSON object')
			expectHistoryParseError(() => parsePaymentSyncSummary('12345'), 'Summary JSON must be a JSON object')
			expectHistoryParseError(() => parseSyncRunSummary('true'), 'Summary JSON must be a JSON object')
			expectHistoryParseError(() => parseSyncRunSummary('null'), 'Summary JSON must be a JSON object')
		})

		it('rechaza arreglos JSON', () => {
			expectHistoryParseError(() => parseImportRunSummary('[{ "runId": "1" }]'), 'Summary JSON must be a JSON object')
			expectHistoryParseError(() => parseSyncRunSummary('[1, 2, 3]'), 'Summary JSON must be a JSON object')
		})

		it('garantiza que el objeto parseado solo contiene las propiedades del modelo sin inyecciones arbitrarias', () => {
			const source = {
				...validImportSummary,
				maliciousInjectedField: 'danger',
			}
			const json = JSON.stringify(source)
			const parsed = parseImportRunSummary(json)

			assert.strictEqual(parsed.runId, 'import-run-001')
			assert.strictEqual(parsed.importedInvoicesCount, 8)
			assert.strictEqual('maliciousInjectedField' in parsed, false)
		})
	})
})
