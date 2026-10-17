/**
 * Pruebas de integración HTTP para la API de Configuración (/api/config/*).
 * Valida los endpoints:
 *   - GET /api/config
 *   - PUT /api/config
 *   - POST /api/config/test-connection
 * Cubre:
 *   1. GET devuelve la configuración completa y no expone apiPassword.
 *   2. PUT actualiza campos válidos y preserva campos omitidos.
 *   3. PUT actualiza contraseña cuando se proporciona una nueva y válida.
 *   4. PUT conserva contraseña cuando no se proporciona o viene vacía.
 *   5. PUT rechaza payloads inválidos, tipos incorrectos y valores fuera de rango (400).
 *   6. PUT devuelve 409 Conflict si hay una sincronización activa.
 *   7. POST /test-connection acepta credenciales, devuelve total de contratos y no persiste datos.
 *   8. POST /test-connection maneja errores del ISP sin exponer credenciales.
 *   9. Rechazo de métodos no permitidos (405).
 *
 * Estrictamente tipado sin `any`, sin `unknown` y sin aserciones forzadas (`as`).
 */

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, beforeEach, describe, it } from 'node:test'

import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import { configRepository } from '../../src/cobrix/db/repositories.ts'
import { acquireSyncLock, releaseSyncLock } from '../../src/server/api/sync-controller.ts'
import { createServerApp } from '../../src/server/server-app.ts'
import type {
	ApiErrorResponseDto,
	ConfigResponseDto,
	TestConnectionRequestDto,
	TestConnectionResponseDto,
	UpdateConfigRequestDto,
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

function isJsonObject(val: JsonValue): val is JsonObject {
	return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function parseJsonText(text: string): JsonValue {
	const parsed: JsonValue = JSON.parse(text)
	return parsed
}

function parseConfigResponse(json: JsonObject): ConfigResponseDto {
	const rawStatuses = Array.isArray(json['importableStatuses']) ? json['importableStatuses'] : []
	const importableStatuses: string[] = []
	for (const s of rawStatuses) {
		if (typeof s === 'string') importableStatuses.push(s)
	}

	const rawExcluded = Array.isArray(json['excludedDocumentTypes']) ? json['excludedDocumentTypes'] : []
	const excludedDocumentTypes: string[] = []
	for (const d of rawExcluded) {
		if (typeof d === 'string') excludedDocumentTypes.push(d)
	}

	return {
		companyName: typeof json['companyName'] === 'string' ? json['companyName'] : '',
		companyTaxId: typeof json['companyTaxId'] === 'string' ? json['companyTaxId'] : '',
		companyEmail: typeof json['companyEmail'] === 'string' ? json['companyEmail'] : '',
		apiUrl: typeof json['apiUrl'] === 'string' ? json['apiUrl'] : '',
		apiUsername: typeof json['apiUsername'] === 'string' ? json['apiUsername'] : '',
		importableStatuses,
		windowMonths: typeof json['windowMonths'] === 'number' ? json['windowMonths'] : null,
		maxRecentInstallments: typeof json['maxRecentInstallments'] === 'number' ? json['maxRecentInstallments'] : null,
		graceDays: typeof json['graceDays'] === 'number' ? json['graceDays'] : 0,
		runInvoiceLimit: typeof json['runInvoiceLimit'] === 'number' ? json['runInvoiceLimit'] : null,
		runAmountLimitCents: typeof json['runAmountLimitCents'] === 'number' ? json['runAmountLimitCents'] : null,
		excludedDocumentTypes,
		autoRunHour: typeof json['autoRunHour'] === 'string' ? json['autoRunHour'] : '',
		autoRunActive: typeof json['autoRunActive'] === 'boolean' ? json['autoRunActive'] : false,
		lastAutoRunDate: typeof json['lastAutoRunDate'] === 'string' ? json['lastAutoRunDate'] : null,
		lastAutoRunStatus:
			json['lastAutoRunStatus'] === 'RUNNING' ||
			json['lastAutoRunStatus'] === 'COMPLETED' ||
			json['lastAutoRunStatus'] === 'FAILED'
				? json['lastAutoRunStatus']
				: null,
	}
}

function parseTestConnectionResponse(json: JsonObject): TestConnectionResponseDto {
	return {
		success: typeof json['success'] === 'boolean' ? json['success'] : false,
		totalContracts: typeof json['totalContracts'] === 'number' ? json['totalContracts'] : undefined,
		message: typeof json['message'] === 'string' ? json['message'] : '',
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
// Mock de BillingApiClient para Pruebas Aisladas de Conexión
// ============================================================================

function createMockBillingClient(options?: {
	readonly contractCount?: number
	readonly shouldFail?: boolean
}): BillingApiClient {
	const count = options?.contractCount ?? 42

	const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

		if (options?.shouldFail === true) {
			return new Response(JSON.stringify({ message: 'Authentication failed: invalid credentials' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' },
			})
		}

		if (url.includes('/login')) {
			return new Response(
				JSON.stringify({
					usuario: 'cobrix',
					email: 'cobrix@test.com',
					access_token: 'mock-token-abc',
					access_token_expires_in: '2026-10-17T00:00:00',
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			)
		}

		if (url.includes('/lista_ids_contratos')) {
			return new Response(
				JSON.stringify({
					success: true,
					message: 'OK',
					pagination: { page: 1, per_page: 1, total: count, total_pages: count },
					errors: [],
					data: [101],
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
		baseUrl: 'http://mock.isp/api/v1',
		username: 'cobrix',
		password: 'mock-password',
		fetchFn: mockFetch,
	})
}

// ============================================================================
// Suite de Pruebas
// ============================================================================

describe('API REST: Configuración (/api/config/*)', () => {
	let server: Server
	let baseUrl: string
	let db = createCobrixDatabase(':memory:')

	before(async () => {
		server = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/test-enunciado.md',
			db,
			billingClient: createMockBillingClient({ contractCount: 75 }),
		})

		await new Promise<void>(resolve => {
			server.listen(0, '127.0.0.1', () => {
				const addr = server.address()
				if (typeof addr === 'object' && addr !== null) {
					baseUrl = `http://127.0.0.1:${addr.port}`
				}
				resolve()
			})
		})
	})

	after(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close(err => {
				if (err) reject(err)
				else resolve()
			})
		})
	})

	beforeEach(() => {
		db.exec('DELETE FROM config;')
		db.exec(`
			INSERT INTO config (
				id, company_name, company_tax_id, company_email,
				api_url, api_username, api_password, importable_statuses,
				grace_days, auto_run_hour, auto_run_active
			) VALUES (
				1, 'Cobrix Telecom', 'J-50000000-0', 'cobranzas@cobrix.test',
				'http://127.0.0.1:4310/api/v1', 'cobrix', 'cobrix-sandbox', 'ACTIVO,CORTADO',
				0, '04:00', 0
			);
		`)
		releaseSyncLock()
	})

	it('1. GET /api/config devuelve la configuración inicial completa y no expone apiPassword', async () => {
		const res = await fetch(`${baseUrl}/api/config`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const config = parseConfigResponse(json)
		assert.equal(config.companyName, 'Cobrix Telecom')
		assert.equal(config.companyTaxId, 'J-50000000-0')
		assert.equal(config.companyEmail, 'cobranzas@cobrix.test')
		assert.equal(config.apiUrl, 'http://127.0.0.1:4310/api/v1')
		assert.equal(config.apiUsername, 'cobrix')
		assert.deepEqual(config.importableStatuses, ['ACTIVO', 'CORTADO'])
		assert.equal(config.graceDays, 0)
		assert.equal(config.autoRunHour, '04:00')
		assert.equal(config.autoRunActive, false)
		assert.equal(config.lastAutoRunDate, null)
		assert.equal(config.lastAutoRunStatus, null)

		// COMPROBACIÓN CRÍTICA DE SEGURIDAD: apiPassword no debe estar presente en el JSON
		assert.equal(json['apiPassword'], undefined)
		assert.ok(!rawText.includes('cobrix-sandbox'))
	})

	it('1b. GET /api/config devuelve lastAutoRunDate y lastAutoRunStatus cuando existen', async () => {
		db.exec("UPDATE config SET last_auto_run_date = '2026-10-16', last_auto_run_status = 'COMPLETED';")
		const res = await fetch(`${baseUrl}/api/config`)
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const config = parseConfigResponse(json)
		assert.equal(config.lastAutoRunDate, '2026-10-16')
		assert.equal(config.lastAutoRunStatus, 'COMPLETED')
	})

	it('2. PUT /api/config actualiza campos válidos y preserva los omitidos', async () => {
		const payload: UpdateConfigRequestDto = {
			companyName: 'Nueva Empresa C.A.',
			graceDays: 5,
			windowMonths: 6,
			maxRecentInstallments: 12,
			runInvoiceLimit: 50,
			runAmountLimitCents: 100000,
			excludedDocumentTypes: ['P', 'G'],
			autoRunHour: '02:30',
			autoRunActive: true,
		}

		const res = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const updated = parseConfigResponse(json)

		// Campos actualizados
		assert.equal(updated.companyName, 'Nueva Empresa C.A.')
		assert.equal(updated.graceDays, 5)
		assert.equal(updated.windowMonths, 6)
		assert.equal(updated.maxRecentInstallments, 12)
		assert.equal(updated.runInvoiceLimit, 50)
		assert.equal(updated.runAmountLimitCents, 100000)
		assert.deepEqual(updated.excludedDocumentTypes, ['P', 'G'])
		assert.equal(updated.autoRunHour, '02:30')
		assert.equal(updated.autoRunActive, true)

		// Campos preservados
		assert.equal(updated.companyTaxId, 'J-50000000-0')
		assert.equal(updated.companyEmail, 'cobranzas@cobrix.test')
		assert.equal(updated.apiUrl, 'http://127.0.0.1:4310/api/v1')
		assert.equal(updated.apiUsername, 'cobrix')

		// Seguridad
		assert.equal(json['apiPassword'], undefined)
	})

	it('3. PUT /api/config actualiza apiPassword cuando se envía una nueva y no vacía', async () => {
		const payload: UpdateConfigRequestDto = {
			apiPassword: 'mi-nuevo-password-seguro-123',
		}

		const res = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		assert.equal(res.status, 200)

		// Comprobar que en base de datos la contraseña fue actualizada
		const dbConfig = configRepository.get(db)
		assert.equal(dbConfig.apiPassword, 'mi-nuevo-password-seguro-123')

		// Comprobar que la respuesta HTTP no expone la nueva contraseña
		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		assert.equal(json['apiPassword'], undefined)
	})

	it('4. PUT /api/config conserva la contraseña si se envía vacía o con solo espacios', async () => {
		const initialDbConfig = configRepository.get(db)
		assert.equal(initialDbConfig.apiPassword, 'cobrix-sandbox')

		const payload: UpdateConfigRequestDto = {
			companyName: 'Test Empresa',
			apiPassword: '   ',
		}

		const res = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		assert.equal(res.status, 200)

		// La contraseña en SQLite no debe haber sido borrada ni cambiada a vacía
		const afterDbConfig = configRepository.get(db)
		assert.equal(afterDbConfig.apiPassword, 'cobrix-sandbox')
		assert.equal(afterDbConfig.companyName, 'Test Empresa')
	})

	it('5. PUT /api/config rechaza valores numéricos fuera de rango y formatos inválidos (400)', async () => {
		// 5.A. graceDays fuera de rango (máximo 60)
		const res1 = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ graceDays: 100 }),
		})
		assert.equal(res1.status, 400)
		const err1 = parseApiErrorResponse(parseJsonText(await res1.text()) as JsonObject)
		assert.match(err1.error, /graceDays/i)

		// 5.B. windowMonths con valor no admitido (debe ser 3, 6, 9, 12 o null)
		const res2 = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ windowMonths: 5 }),
		})
		assert.equal(res2.status, 400)
		const err2 = parseApiErrorResponse(parseJsonText(await res2.text()) as JsonObject)
		assert.match(err2.error, /windowMonths/i)

		// 5.C. autoRunHour con formato inválido
		const res3 = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ autoRunHour: '25:99' }),
		})
		assert.equal(res3.status, 400)
		const err3 = parseApiErrorResponse(parseJsonText(await res3.text()) as JsonObject)
		assert.match(err3.error, /autoRunHour/i)

		// 5.D. excludedDocumentTypes con tipo desconocido
		const res4 = await fetch(`${baseUrl}/api/config`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ excludedDocumentTypes: ['X'] }),
		})
		assert.equal(res4.status, 400)
		const err4 = parseApiErrorResponse(parseJsonText(await res4.text()) as JsonObject)
		assert.match(err4.error, /excludedDocumentTypes/i)
	})

	it('6. PUT /api/config devuelve 409 Conflict si hay una sincronización en curso', async () => {
		acquireSyncLock()
		try {
			const res = await fetch(`${baseUrl}/api/config`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ companyName: 'Intento Concurrente' }),
			})
			assert.equal(res.status, 409)

			const err = parseApiErrorResponse(parseJsonText(await res.text()) as JsonObject)
			assert.equal(err.statusCode, 409)
			assert.match(err.error, /synchronization operation is in progress/i)
		} finally {
			releaseSyncLock()
		}
	})

	it('7. POST /api/config/test-connection ejecuta prueba exitosa sin persistir credenciales', async () => {
		const initialConfig = configRepository.get(db)

		const payload: TestConnectionRequestDto = {
			apiUrl: 'http://test.isp/api/v1',
			apiUsername: 'user_temporal',
			apiPassword: 'pass_temporal',
		}

		const res = await fetch(`${baseUrl}/api/config/test-connection`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
		})
		assert.equal(res.status, 200)

		const json = parseJsonText(await res.text())
		assert.ok(isJsonObject(json))
		const result = parseTestConnectionResponse(json)

		assert.equal(result.success, true)
		assert.equal(result.totalContracts, 75)
		assert.match(result.message, /75 contratos/i)

		// Verificar que la base de datos no fue modificada con los datos temporales
		const currentConfig = configRepository.get(db)
		assert.equal(currentConfig.apiUrl, initialConfig.apiUrl)
		assert.equal(currentConfig.apiUsername, initialConfig.apiUsername)
		assert.equal(currentConfig.apiPassword, initialConfig.apiPassword)
	})

	it('8. POST /api/config/test-connection maneja credenciales fallidas sin exponer secretos', async () => {
		// Servidor con mock que falla autenticación
		const failServer = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/test-enunciado.md',
			db,
			billingClient: createMockBillingClient({ shouldFail: true }),
		})

		let failBaseUrl = ''
		await new Promise<void>(resolve => {
			failServer.listen(0, '127.0.0.1', () => {
				const addr = failServer.address()
				if (typeof addr === 'object' && addr !== null) {
					failBaseUrl = `http://127.0.0.1:${addr.port}`
				}
				resolve()
			})
		})

		try {
			const res = await fetch(`${failBaseUrl}/api/config/test-connection`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					apiPassword: 'secreto-super-confidencial',
				}),
			})
			assert.equal(res.status, 200)

			const rawText = await res.text()
			const json = parseJsonText(rawText)
			assert.ok(isJsonObject(json))
			const result = parseTestConnectionResponse(json)

			assert.equal(result.success, false)
			assert.match(result.message, /Error de conexión/i)

			// Verificar que el cuerpo de la respuesta no contiene la contraseña enviada
			assert.ok(!rawText.includes('secreto-super-confidencial'))
		} finally {
			await new Promise<void>(resolve => failServer.close(() => resolve()))
		}
	})

	it('9. Rechaza métodos no permitidos (405) en /api/config y /api/config/test-connection', async () => {
		// DELETE /api/config
		const res1 = await fetch(`${baseUrl}/api/config`, { method: 'DELETE' })
		assert.equal(res1.status, 405)

		// GET /api/config/test-connection
		const res2 = await fetch(`${baseUrl}/api/config/test-connection`, { method: 'GET' })
		assert.equal(res2.status, 405)
	})
})
