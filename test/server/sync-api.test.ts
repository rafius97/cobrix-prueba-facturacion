/**
 * Pruebas de integración HTTP para la API de Sincronización (/api/sync/*).
 * Valida los endpoints:
 *   - GET /api/sync/runs
 *   - GET /api/sync/runs/:id
 *   - POST /api/sync/import
 *   - POST /api/sync/payments
 * Cubre:
 *   1. Historial vacío.
 *   2. Historial con corridas existentes.
 *   3. Detalle de una corrida existente.
 *   4. 404 para un ID inexistente.
 *   5. Importación real invocada mediante servicio simulado/aislado.
 *   6. Simulación de importación.
 *   7. Actualización real de pagos con dependencias aisladas.
 *   8. Simulación de actualización de pagos.
 *   9. Rechazo de cuerpos inválidos (400) y métodos no permitidos (405).
 *   10. Respuesta 409 Conflict ante operaciones concurrentes.
 *   11. Liberación del bloqueo después de una operación fallida.
 *
 * Estrictamente tipado sin `any`, sin `unknown` y sin aserciones forzadas (`as`).
 */

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'

import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	configRepository,
	contractRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import {
	acquireSyncLock,
	isSyncRunning,
	releaseSyncLock,
} from '../../src/server/api/sync-controller.ts'
import { createServerApp } from '../../src/server/server-app.ts'
import type {
	ApiErrorResponseDto,
	ImportRunSummaryDto,
	PaymentSyncSummaryDto,
	SyncRunDetailItemDto,
	SyncRunDetailResponseDto,
	SyncRunItemDto,
	SyncRunListResponseDto,
} from '../../src/shared/api-types.ts'

// ============================================================================
// Tipos seguros para parsing JSON en pruebas sin `any` ni `unknown`
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

function parseJsonText(text: string): JsonValue {
	const parsed: JsonValue = JSON.parse(text)
	return parsed
}

function parseSyncRunItem(val: JsonValue): SyncRunItemDto {
	if (!isJsonObject(val)) throw new Error('SyncRunItem must be an object')

	const rawType = val['type']
	const type = rawType === 'PAYMENT_UPDATE' ? 'PAYMENT_UPDATE' : 'IMPORT'
	const triggerType = val['triggerType'] === 'SCHEDULED' ? 'SCHEDULED' : 'MANUAL'
	const status = val['status'] === 'FAILED' ? 'FAILED' : 'COMPLETED'
	const rawSummary = val['summary']

	let summary: ImportRunSummaryDto | PaymentSyncSummaryDto | null = null
	if (isJsonObject(rawSummary)) {
		if (rawSummary['type'] === 'IMPORT') {
			summary = {
				type: 'IMPORT',
				isSimulation: rawSummary['isSimulation'] === true,
				durationMs: typeof rawSummary['durationMs'] === 'number' ? rawSummary['durationMs'] : 0,
				totalContractsInspected: typeof rawSummary['totalContractsInspected'] === 'number' ? rawSummary['totalContractsInspected'] : 0,
				totalInstallmentsEvaluated: typeof rawSummary['totalInstallmentsEvaluated'] === 'number' ? rawSummary['totalInstallmentsEvaluated'] : 0,
				importedInvoicesCount: typeof rawSummary['importedInvoicesCount'] === 'number' ? rawSummary['importedInvoicesCount'] : 0,
				importedAmountCents: typeof rawSummary['importedAmountCents'] === 'number' ? rawSummary['importedAmountCents'] : 0,
				newCustomersCount: typeof rawSummary['newCustomersCount'] === 'number' ? rawSummary['newCustomersCount'] : 0,
				alreadyImportedCount: typeof rawSummary['alreadyImportedCount'] === 'number' ? rawSummary['alreadyImportedCount'] : 0,
				excludedByStatusCount: typeof rawSummary['excludedByStatusCount'] === 'number' ? rawSummary['excludedByStatusCount'] : 0,
				excludedByDocumentTypeCount: typeof rawSummary['excludedByDocumentTypeCount'] === 'number' ? rawSummary['excludedByDocumentTypeCount'] : 0,
				outOfWindowCount: typeof rawSummary['outOfWindowCount'] === 'number' ? rawSummary['outOfWindowCount'] : 0,
				excludedByMaxInstallmentsCount: typeof rawSummary['excludedByMaxInstallmentsCount'] === 'number' ? rawSummary['excludedByMaxInstallmentsCount'] : 0,
				limitReachedCount: typeof rawSummary['limitReachedCount'] === 'number' ? rawSummary['limitReachedCount'] : 0,
				inconsistentCurrencyCount: typeof rawSummary['inconsistentCurrencyCount'] === 'number' ? rawSummary['inconsistentCurrencyCount'] : 0,
				residualBalanceCount: typeof rawSummary['residualBalanceCount'] === 'number' ? rawSummary['residualBalanceCount'] : 0,
				noDebtCount: typeof rawSummary['noDebtCount'] === 'number' ? rawSummary['noDebtCount'] : 0,
				invalidIdentificationCount: typeof rawSummary['invalidIdentificationCount'] === 'number' ? rawSummary['invalidIdentificationCount'] : 0,
				invalidDataCount: typeof rawSummary['invalidDataCount'] === 'number' ? rawSummary['invalidDataCount'] : 0,
			}
		} else if (rawSummary['type'] === 'PAYMENT_UPDATE') {
			summary = {
				type: 'PAYMENT_UPDATE',
				isSimulation: rawSummary['isSimulation'] === true,
				durationMs: typeof rawSummary['durationMs'] === 'number' ? rawSummary['durationMs'] : 0,
				totalInvoicesInspected: typeof rawSummary['totalInvoicesInspected'] === 'number' ? rawSummary['totalInvoicesInspected'] : 0,
				totalContractsInspected: typeof rawSummary['totalContractsInspected'] === 'number' ? rawSummary['totalContractsInspected'] : 0,
				markedPaidCount: typeof rawSummary['markedPaidCount'] === 'number' ? rawSummary['markedPaidCount'] : 0,
				markedPaidAmountCents: typeof rawSummary['markedPaidAmountCents'] === 'number' ? rawSummary['markedPaidAmountCents'] : 0,
				partialPaymentsCount: typeof rawSummary['partialPaymentsCount'] === 'number' ? rawSummary['partialPaymentsCount'] : 0,
				partialPaymentsAmountCents: typeof rawSummary['partialPaymentsAmountCents'] === 'number' ? rawSummary['partialPaymentsAmountCents'] : 0,
				stillOpenCount: typeof rawSummary['stillOpenCount'] === 'number' ? rawSummary['stillOpenCount'] : 0,
				stillOpenBalanceCents: typeof rawSummary['stillOpenBalanceCents'] === 'number' ? rawSummary['stillOpenBalanceCents'] : 0,
				exemptionCount: typeof rawSummary['exemptionCount'] === 'number' ? rawSummary['exemptionCount'] : 0,
				noEvidenceCount: typeof rawSummary['noEvidenceCount'] === 'number' ? rawSummary['noEvidenceCount'] : 0,
				contradictoryDataCount: typeof rawSummary['contradictoryDataCount'] === 'number' ? rawSummary['contradictoryDataCount'] : 0,
				invalidDataCount: typeof rawSummary['invalidDataCount'] === 'number' ? rawSummary['invalidDataCount'] : 0,
			}
		}
	}

	return {
		id: typeof val['id'] === 'string' ? val['id'] : '',
		type,
		triggerType,
		isSimulation: val['isSimulation'] === true,
		status,
		startedAt: typeof val['startedAt'] === 'string' ? val['startedAt'] : '',
		finishedAt: typeof val['finishedAt'] === 'string' ? val['finishedAt'] : '',
		errorMessage: typeof val['errorMessage'] === 'string' ? val['errorMessage'] : null,
		summary,
	}
}

function parseSyncRunListResponse(json: JsonObject): SyncRunListResponseDto {
	const rawRuns = Array.isArray(json['runs']) ? json['runs'] : []
	const runs = rawRuns.map(r => parseSyncRunItem(r))
	return {
		runs,
		totalCount: typeof json['totalCount'] === 'number' ? json['totalCount'] : runs.length,
	}
}

function parseSyncRunDetailItem(val: JsonValue): SyncRunDetailItemDto {
	if (!isJsonObject(val)) throw new Error('SyncRunDetailItem must be an object')
	return {
		id: typeof val['id'] === 'number' ? val['id'] : 0,
		runId: typeof val['runId'] === 'string' ? val['runId'] : '',
		contractId: typeof val['contractId'] === 'number' ? val['contractId'] : 0,
		debtId: typeof val['debtId'] === 'string' ? val['debtId'] : '',
		period: typeof val['period'] === 'string' ? val['period'] : '',
		amountCents: typeof val['amountCents'] === 'number' ? val['amountCents'] : 0,
		result: typeof val['result'] === 'string' ? val['result'] : '',
		reason: typeof val['reason'] === 'string' ? val['reason'] : '',
	}
}

function parseSyncRunDetailResponse(json: JsonObject): SyncRunDetailResponseDto {
	const rawRun = json['run']
	if (!isJsonObject(rawRun)) throw new Error('Response must include run object')
	const rawDetails = Array.isArray(json['details']) ? json['details'] : []
	return {
		run: parseSyncRunItem(rawRun),
		details: rawDetails.map(d => parseSyncRunDetailItem(d)),
	}
}

function parseApiErrorResponse(json: JsonObject): ApiErrorResponseDto {
	return {
		error: typeof json['error'] === 'string' ? json['error'] : '',
		statusCode: typeof json['statusCode'] === 'number' ? json['statusCode'] : 0,
		path: typeof json['path'] === 'string' ? json['path'] : '',
	}
}

// ============================================================================
// Mock de BillingApiClient para Pruebas Aisladas
// ============================================================================

function createMockBillingClient(options?: {
	readonly contractIds?: readonly number[]
	readonly shouldFail?: boolean
}): BillingApiClient {
	const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

		if (options?.shouldFail === true) {
			return new Response(JSON.stringify({ message: 'Simulated network outage' }), {
				status: 500,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		// Auth login endpoint
		if (url.includes('/login')) {
			return new Response(
				JSON.stringify({
					usuario: 'cobrix',
					email: 'cobrix@test.com',
					access_token: 'mock-token-12345',
					access_token_expires_in: '2026-10-15T00:00:00',
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		}

		// List contract IDs endpoint
		if (url.includes('/lista_ids_contratos')) {
			const ids = options?.contractIds ?? []
			return new Response(
				JSON.stringify({
					success: true,
					message: 'OK',
					pagination: { page: 1, per_page: 50, total: ids.length, total_pages: 1 },
					errors: [],
					data: ids,
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		}

		// Payment book endpoint
		if (url.includes('/cobros/list_libro_cobros_cuotas')) {
			return new Response(
				JSON.stringify({
					success: true,
					message: 'OK',
					pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
					errors: [],
					data: [],
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		}

		return new Response(JSON.stringify({ message: 'Not Found' }), {
			status: 404,
			headers: { 'Content-Type': 'application/json' },
		})
	}

	return new BillingApiClient({
		baseUrl: 'http://billing.mock/api/v1',
		username: 'cobrix',
		password: 'mock-password',
		fetchFn: mockFetch,
	})
}

// ============================================================================
// Suite de Pruebas de Integración
// ============================================================================

describe('API REST: Sincronización e Historial (/api/sync/*)', () => {
	let server: Server
	let baseUrl: string
	let db: ReturnType<typeof createCobrixDatabase>

	before(async () => {
		db = createCobrixDatabase(':memory:')

		server = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/ENUNCIADO.md',
			db,
			billingClient: createMockBillingClient({ contractIds: [] }),
		})

		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0
		baseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		await new Promise(resolve => server.close(resolve))
	})

	beforeEach(() => {
		// Asegurarse de que el lock en memoria esté liberado antes de cada prueba
		if (isSyncRunning()) {
			releaseSyncLock()
		}
	})

	it('1. GET /api/sync/runs devuelve historial vacío inicialmente', async () => {
		const res = await fetch(`${baseUrl}/api/sync/runs`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const dto = parseSyncRunListResponse(json)
		assert.equal(dto.totalCount, 0)
		assert.equal(dto.runs.length, 0)
	})

	it('2. GET /api/sync/runs devuelve corridas existentes ordenadas cronológicamente inverso', async () => {
		// Insertar dos corridas previas en SQLite
		syncRunRepository.create(db, {
			id: 'RUN-001',
			type: 'IMPORT',
			isSimulation: false,
			status: 'COMPLETED',
			startedAt: '2026-10-14T08:00:00Z',
			finishedAt: '2026-10-14T08:00:05Z',
			errorMessage: null,
			summaryJson: JSON.stringify({
				runId: 'RUN-001',
				isSimulation: false,
				startedAt: '2026-10-14T08:00:00Z',
				finishedAt: '2026-10-14T08:00:05Z',
				durationMs: 5000,
				totalContractsInspected: 10,
				totalInstallmentsEvaluated: 20,
				importedInvoicesCount: 15,
				importedAmountCents: 45000,
				newCustomersCount: 5,
				alreadyImportedCount: 5,
				excludedByStatusCount: 0,
				excludedByDocumentTypeCount: 0,
				outOfWindowCount: 0,
				excludedByMaxInstallmentsCount: 0,
				limitReachedCount: 0,
				inconsistentCurrencyCount: 0,
				residualBalanceCount: 0,
				noDebtCount: 0,
				invalidIdentificationCount: 0,
				invalidDataCount: 0,
			}),
		})

		syncRunRepository.create(db, {
			id: 'RUN-002',
			type: 'PAYMENT_UPDATE',
			isSimulation: true,
			status: 'COMPLETED',
			startedAt: '2026-10-14T09:00:00Z',
			finishedAt: '2026-10-14T09:00:02Z',
			errorMessage: null,
			summaryJson: JSON.stringify({
				runId: 'RUN-002',
				isSimulation: true,
				startedAt: '2026-10-14T09:00:00Z',
				finishedAt: '2026-10-14T09:00:02Z',
				durationMs: 2000,
				totalInvoicesInspected: 15,
				totalContractsInspected: 10,
				markedPaidCount: 5,
				markedPaidAmountCents: 15000,
				partialPaymentsCount: 0,
				partialPaymentsAmountCents: 0,
				stillOpenCount: 10,
				stillOpenBalanceCents: 30000,
				exemptionCount: 0,
				noEvidenceCount: 0,
				contradictoryDataCount: 0,
				invalidDataCount: 0,
			}),
		})

		const res = await fetch(`${baseUrl}/api/sync/runs`)
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const dto = parseSyncRunListResponse(json)
		assert.equal(dto.totalCount, 2)
		assert.equal(dto.runs.length, 2)

		// Primera debe ser RUN-002 (más reciente)
		assert.equal(dto.runs[0]?.id, 'RUN-002')
		assert.equal(dto.runs[0]?.type, 'PAYMENT_UPDATE')
		assert.equal(dto.runs[0]?.triggerType, 'MANUAL')
		assert.equal(dto.runs[0]?.isSimulation, true)
		assert.equal(dto.runs[0]?.summary?.type, 'PAYMENT_UPDATE')

		// Segunda debe ser RUN-001
		assert.equal(dto.runs[1]?.id, 'RUN-001')
		assert.equal(dto.runs[1]?.type, 'IMPORT')
		assert.equal(dto.runs[1]?.triggerType, 'MANUAL')
		assert.equal(dto.runs[1]?.isSimulation, false)
		assert.equal(dto.runs[1]?.summary?.type, 'IMPORT')
	})

	it('3. GET /api/sync/runs/:id devuelve el detalle y desgloses de una corrida existente', async () => {
		syncRunRepository.addDetails(db, [
			{
				runId: 'RUN-001',
				contractId: 101,
				debtId: 'DEBT-801',
				period: '2026-08',
				amountCents: 2500,
				result: 'IMPORTED',
				reason: 'Cuota importada exitosamente',
			},
			{
				runId: 'RUN-001',
				contractId: 101,
				debtId: 'DEBT-802',
				period: '2026-07',
				amountCents: 2500,
				result: 'ALREADY_IMPORTED',
				reason: 'Ya registrada',
			},
		])

		const res = await fetch(`${baseUrl}/api/sync/runs/RUN-001`)
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const detail = parseSyncRunDetailResponse(json)

		assert.equal(detail.run.id, 'RUN-001')
		assert.equal(detail.run.type, 'IMPORT')
		assert.equal(detail.run.triggerType, 'MANUAL')
		assert.equal(detail.details.length, 2)
		assert.equal(detail.details[0]?.debtId, 'DEBT-801')
		assert.equal(detail.details[0]?.result, 'IMPORTED')
		assert.equal(detail.details[1]?.debtId, 'DEBT-802')
		assert.equal(detail.details[1]?.result, 'ALREADY_IMPORTED')
	})

	it('4. GET /api/sync/runs/:id devuelve 404 para un ID inexistente', async () => {
		const res = await fetch(`${baseUrl}/api/sync/runs/INEXISTENTE-999`)
		assert.equal(res.status, 404)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const err = parseApiErrorResponse(json)
		assert.equal(err.statusCode, 404)
		assert.match(err.error, /not found/i)
	})

	it('5. POST /api/sync/import ejecuta importación real y devuelve el resultado tipado', async () => {
		const res = await fetch(`${baseUrl}/api/sync/import`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isSimulation: false }),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const runItem = parseSyncRunItem(json)

		assert.equal(runItem.type, 'IMPORT')
		assert.equal(runItem.triggerType, 'MANUAL')
		assert.equal(runItem.isSimulation, false)
		assert.equal(runItem.status, 'COMPLETED')
		assert.ok(runItem.id.length > 0)
		assert.equal(runItem.summary?.type, 'IMPORT')
	})

	it('6. POST /api/sync/import en modo simulación (isSimulation: true)', async () => {
		const res = await fetch(`${baseUrl}/api/sync/import`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isSimulation: true }),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const runItem = parseSyncRunItem(json)

		assert.equal(runItem.type, 'IMPORT')
		assert.equal(runItem.triggerType, 'MANUAL')
		assert.equal(runItem.isSimulation, true)
		assert.equal(runItem.status, 'COMPLETED')
	})

	it('7. POST /api/sync/payments ejecuta actualización de pagos y devuelve resultado tipado', async () => {
		const res = await fetch(`${baseUrl}/api/sync/payments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isSimulation: false }),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const runItem = parseSyncRunItem(json)

		assert.equal(runItem.type, 'PAYMENT_UPDATE')
		assert.equal(runItem.triggerType, 'MANUAL')
		assert.equal(runItem.isSimulation, false)
		assert.equal(runItem.status, 'COMPLETED')
		assert.equal(runItem.summary?.type, 'PAYMENT_UPDATE')
	})

	it('8. POST /api/sync/payments en modo simulación (isSimulation: true)', async () => {
		const res = await fetch(`${baseUrl}/api/sync/payments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isSimulation: true }),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const runItem = parseSyncRunItem(json)

		assert.equal(runItem.type, 'PAYMENT_UPDATE')
		assert.equal(runItem.triggerType, 'MANUAL')
		assert.equal(runItem.isSimulation, true)
		assert.equal(runItem.status, 'COMPLETED')
	})

	it('9. Rechazo de cuerpos inválidos (400) y métodos no permitidos (405)', async () => {
		// Cuerpo no JSON en POST /api/sync/import
		const badJsonRes = await fetch(`${baseUrl}/api/sync/import`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: 'not a valid json {',
		})
		assert.equal(badJsonRes.status, 400)

		// Propiedad isSimulation inválida (número en vez de boolean)
		const invalidTypeRes = await fetch(`${baseUrl}/api/sync/payments`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ isSimulation: 123 }),
		})
		assert.equal(invalidTypeRes.status, 400)

		// Método GET no permitido en /api/sync/import
		const methodNotAllowed = await fetch(`${baseUrl}/api/sync/import`, {
			method: 'GET',
		})
		assert.equal(methodNotAllowed.status, 405)
	})

	it('10. Respuesta 409 Conflict ante operaciones concurrentes (bloqueo en memoria activo)', async () => {
		acquireSyncLock()
		assert.equal(isSyncRunning(), true)

		try {
			const res = await fetch(`${baseUrl}/api/sync/import`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isSimulation: false }),
			})
			assert.equal(res.status, 409)

			const json = parseJsonText(await res.text())
			assert.ok(isJsonObject(json))
			const err = parseApiErrorResponse(json)
			assert.equal(err.statusCode, 409)
			assert.match(err.error, /already in progress/i)
		} finally {
			releaseSyncLock()
		}

		assert.equal(isSyncRunning(), false)
	})

	it('11. Liberación del bloqueo en memoria después de una operación fallida', async () => {
		// Crear un servidor aislado cuyo cliente de BillingAPI falle intencionalmente
		const failingBillingClient = createMockBillingClient({ shouldFail: true })
		const failingServer = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/ENUNCIADO.md',
			db,
			billingClient: failingBillingClient,
		})

		await new Promise<void>(resolve => failingServer.listen(0, '127.0.0.1', resolve))
		const address = failingServer.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0
		const failingBaseUrl = `http://127.0.0.1:${port}`

		try {
			const res = await fetch(`${failingBaseUrl}/api/sync/import`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isSimulation: false }),
			})

			// La corrida debe responder con el resumen fallido o status 200 con corrida FAILED
			// o un error 500 si fue un fallo crítico
			assert.ok(res.status === 200 || res.status === 500)

			// El bloqueo en memoria DEBE haber sido liberado
			assert.equal(isSyncRunning(), false)
		} finally {
			await new Promise(resolve => failingServer.close(resolve))
			if (isSyncRunning()) {
				releaseSyncLock()
			}
		}
	})
})
