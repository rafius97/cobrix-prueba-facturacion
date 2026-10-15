/**
 * Unit tests for BillingApiClient.
 * Strictly typed without `any` or `unknown`.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import {
	BillingApiAuthError,
	BillingApiNetworkError,
	BillingApiNotFoundError,
	BillingApiResponseError,
	BillingApiValidationError,
} from '../../src/cobrix/client/errors.ts'
import type { JsonValue } from '../../src/cobrix/client/validators.ts'

// ============================================================================
// Test Fixtures
// ============================================================================

function mockLoginResponse(expiresIn?: string): JsonValue {
	return {
		usuario: 'cobrix',
		email: 'cobrix@example.com',
		access_token: 'fake-jwt-token-123',
		access_token_expires_in: expiresIn ?? new Date(Date.now() + 7_200_000).toISOString().slice(0, 19),
	}
}

const MOCK_CONTRACT_IDS_RESPONSE: JsonValue = {
	success: true,
	message: 'Lista de ids de contratos',
	pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
	errors: [{ id: 0, message: '', code: '', uuid_code: '' }],
	data: [900101, 900102],
}

const MOCK_PENDING_ROW: JsonValue = {
	dia_cobro: 26,
	dia_corte: 4,
	id_tipo_duracion: 0,
	duracion: 0,
	tipo_duracion: '',
	fecha_cobro_prox: '2026-10-26',
	fecha_corte_prox: '2026-11-04',
	contrato_id: 900101,
	id_empresa: 0,
	codigo: '0900101',
	identificacion_contrato: 'V-12345678',
	nombre_contrato: 'ANA PEREZ',
	telefono: '04121000000',
	email: 'ANA.PEREZ@EXAMPLE.COM',
	estado: 'ACTIVO',
	tipo_contrato_de_cobro: 'PREPAGO',
	direccion: 'CALLE 1',
	cuotas_vencidad: 1,
	deuda: 20,
	detalle_tipo_deuda: ['CUOTA'],
	tipo_deuda: 'cuota',
	deuda_id: '7000008',
	nombre_servicio: 'Internet',
	precio_servicio: '25.000000',
	nombre_plan: 'PLAN15MB25',
	nombre_empresa: 'EMPRESA',
	nombre_comercial_empresa: 'EMPRESA COMERCIAL',
	identificacion_empresa: 'J-12345678',
	nombre_sucursal: 'SUCURSAL',
	identificacion_sucursal: '',
	sigla_sucursal: 'VLN',
	informacion_adicional: '',
	detalle_deuda: ['PLAN15MB25 - 2026 Agosto'],
	detalle: ['PLAN15MB25 - 7000008 - 1'],
	moneda: 'DOLAR',
	moneda_sigla: 'USD',
	tipo_servicio: 'INTERNET',
	id_tipo_cont_serv: 8,
	saldo_a_f_v: 0,
	saldo_a_f_sn: 'N',
	fecha_contrato: '2025-01-01',
	fecha_instalacion: '2025-01-01',
	fecha_ultimo_corte: '2026-07-13',
	sector: '',
	barrio: '',
	ruta: '',
	vendedor_contrato: 'VENDEDOR',
	id_tipo_factura: 1,
	tipo_factura: 'FACTURA DIGITAL',
	coordenadas: null,
}

const MOCK_PAYMENT_BOOK_RESPONSE: JsonValue = {
	success: false, // confirmed ISP API quirk
	message: 'Lista de la informacion general de los pagos por contrato',
	pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 },
	errors: [{ id: 0, message: '', code: '', uuid_code: '' }],
	data: [
		{
			id_factura: 8800007,
			cod_empresa: 1,
			cod_sucursal: 2,
			dmcc_cod_empresa: 0,
			dmcc_cod_sucursal: 0,
			cod_tran: '',
			asiento: '',
			identificacion_cliente_factura: 'V-12345678',
			nombre_cliente_factura: 'ANA PEREZ',
			nombre_cliente: 'ANA PEREZ',
			identificacion_cliente: 'V-12345678',
			codigo_cliente: '0900101',
			tipo_contrato: 'Internet',
			num_factura: '008800007',
			ejercio_fiscal: 43,
			id_cliente: 1,
			fecha_vence: '2026-08-06',
			fecha_emision: '2026-08-06',
			periodo_fecha: '2026-08',
			id_contrato: 900101,
			fact_cod_contr: '900101',
			compara_id_contrato_1: 'igual',
			compara_id_contrato_2: 'igual',
			detalle_pago: {
				id_contrato: 900101,
				id_cliente: 1,
				id_cuota: 7000008,
				tipo_contrato: 'Internet',
				periodo_cuota: '2026-08',
				tarifa: 25,
				total_adicional: 0,
				valor_pago: 25,
				valor_uso: 0,
				valor_no_uso: 0,
				descuento: 0,
				valor_nota_credito: 0,
				saldo_cuota: 0,
				detalle: [
					{
						id_contrato: 900101,
						id_cliente: 1,
						id_cuota: 7000008,
						id_detalle_cuota: 1,
						tipo: 'M',
						periodo_detalle_cuota: '2026-08',
						tipo_nombre: 'MENSUALIDAD',
						codigo_producto: 'PLAN15MB25',
						detalle_producto: 'PLAN15MB25',
						nombre_producto: 'MENSUALIDAD',
						nombre_paquete: 'PLAN15MB25',
						nombre_tipo_producto: 'INTERNET',
						tarifa: 25,
						dias_uso: 30,
						valor_uso: 0,
						valor_no_uso: 0,
						valor_pago: 25,
						valor_nota_credito: 0,
						descuento: 0,
						saldo_cuota: 0,
					},
				],
				detalle_dfac: 'PLAN15MB25 Agosto',
			},
		},
	],
}

function jsonResponse(data: JsonValue, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

function textResponse(text: string, status = 200, contentType = 'text/plain'): Response {
	return new Response(text, {
		status,
		headers: { 'Content-Type': contentType },
	})
}

function createMockFetch(
	handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
): typeof fetch {
	const mockFetch: typeof fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
		return handler(url, init)
	}
	return mockFetch
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Cliente API: Autenticación y ciclo de vida de sesión', () => {
	it('inicio de sesión correcto y almacenamiento de sesión en memoria', async () => {
		let loginCalls = 0
		const fetchFn = createMockFetch(async (url, init) => {
			if (url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				assert.equal(init?.method, 'POST')
				return jsonResponse(mockLoginResponse())
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		const session = await client.login()
		assert.equal(loginCalls, 1)
		assert.equal(session.accessToken, 'fake-jwt-token-123')
		assert.equal(session.username, 'cobrix')
		assert.equal(client.getSession()?.accessToken, 'fake-jwt-token-123')
	})

	it('reutilización de un token válido sin repetir petición de login', async () => {
		let loginCalls = 0
		let contractCalls = 0

		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				return jsonResponse(mockLoginResponse())
			}
			if (url.includes('/api/v1/isp/lista_ids_contratos')) {
				contractCalls++
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		const firstResult = await client.listContractIds()
		const secondResult = await client.listContractIds()

		assert.equal(loginCalls, 1)
		assert.equal(contractCalls, 2)
		assert.deepEqual(firstResult, [900101, 900102])
		assert.deepEqual(secondResult, [900101, 900102])
	})

	it('interpretación de access_token_expires_in como UTC independientemente de la zona horaria', async () => {
		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				return jsonResponse({
					usuario: 'cobrix',
					email: 'cobrix@example.com',
					access_token: 'fake-jwt-token-123',
					access_token_expires_in: '2026-10-13T10:00:00',
				})
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		const session = await client.login()
		const expectedUtcTimestamp = Date.parse('2026-10-13T10:00:00Z')
		assert.equal(session.expiresAtMs, expectedUtcTimestamp)
	})

	it('renovación preventiva de un token próximo a expirar', async () => {
		let loginCalls = 0

		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				// Simulate token expiring in 30 seconds (within the 60-second preemptive renewal window)
				const soonIso = new Date(Date.now() + 30_000).toISOString().slice(0, 19)
				return jsonResponse({
					usuario: 'cobrix',
					email: 'cobrix@example.com',
					access_token: `token-attempt-${loginCalls}`,
					access_token_expires_in: soonIso,
				})
			}
			if (url.includes('/api/v1/isp/lista_ids_contratos')) {
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		await client.listContractIds()
		assert.equal(loginCalls, 1)

		// Next call detects token is within preemptive renewal window (< 60s remaining) and renews it
		await client.listContractIds()
		assert.equal(loginCalls, 2)
	})

	it('prevención de inicios de sesión simultáneos redundantes ante peticiones concurrentes', async () => {
		let loginCalls = 0

		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				await new Promise<void>(resolve => setTimeout(resolve, 20))
				return jsonResponse(mockLoginResponse())
			}
			if (url.includes('/api/v1/isp/lista_ids_contratos')) {
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		// Launch 5 concurrent calls without existing session
		const promises = [
			client.listContractIds(),
			client.listContractIds(),
			client.listContractIds(),
			client.listContractIds(),
			client.listContractIds(),
		]

		const results = await Promise.all(promises)
		assert.equal(loginCalls, 1)
		for (const res of results) {
			assert.deepEqual(res, [900101, 900102])
		}
	})
})

describe('Cliente API: Manejo de errores y reintentos', () => {
	it('recuperación ante HTTP 401 con un solo reintento', async () => {
		let loginCalls = 0
		let contractCalls = 0

		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				return jsonResponse({
					usuario: 'cobrix',
					email: 'cobrix@example.com',
					access_token: `token-${loginCalls}`,
					access_token_expires_in: '2026-10-13T12:00:00',
				})
			}
			if (url.includes('/api/v1/isp/lista_ids_contratos')) {
				contractCalls++
				if (contractCalls === 1) {
					// First attempt fails with 401 expired token
					return jsonResponse({ detail: { type: 'auth_api', mensaje: 'MissingTokenError, Token expirado' } }, 401)
				}
				// Second attempt succeeds after re-login
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		const result = await client.listContractIds()
		assert.equal(contractCalls, 2)
		assert.equal(loginCalls, 2)
		assert.deepEqual(result, [900101, 900102])
	})

	it('ausencia de reintentos infinitos cuando la segunda petición devuelve HTTP 401', async () => {
		let contractCalls = 0

		const fetchFn = createMockFetch(async url => {
			if (url.endsWith('/api/v1/usuario/login')) {
				return jsonResponse(mockLoginResponse())
			}
			if (url.includes('/api/v1/isp/lista_ids_contratos')) {
				contractCalls++
				return jsonResponse({ detail: { type: 'auth_api', mensaje: 'Token inválido' } }, 401)
			}
			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		await assert.rejects(
			async () => client.listContractIds(),
			(error: Error) => {
				assert.ok(error instanceof BillingApiAuthError)
				assert.equal(error.statusCode, 401)
				return true
			},
		)

		// Max 2 attempts (initial + 1 retry)
		assert.equal(contractCalls, 2)
	})

	it('no invalida una sesión renovada (T2) cuando una petición previa en vuelo con T1 recibe HTTP 401', async () => {
		let loginCalls = 0
		let contractCallsT1 = 0
		let contractCallsT2 = 0

		let releaseRequestBFirstFetch: () => void = () => {}
		const requestBFirstFetchGate = new Promise<void>(resolve => {
			releaseRequestBFirstFetch = resolve
		})

		const fetchFn = createMockFetch(async (_url, init) => {
			if (_url.endsWith('/api/v1/usuario/login')) {
				loginCalls++
				return jsonResponse({
					usuario: 'cobrix',
					email: 'cobrix@example.com',
					access_token: `T${loginCalls}`,
					access_token_expires_in: new Date(Date.now() + 7_200_000).toISOString().slice(0, 19),
				})
			}

			if (_url.includes('/api/v1/isp/lista_ids_contratos')) {
				const authHeader = init?.headers ? new Headers(init.headers).get('Authorization') : null

				if (authHeader === 'Bearer T1') {
					contractCallsT1++
					if (contractCallsT1 === 1) {
						// Request A receives 401 immediately
						return jsonResponse({ detail: { type: 'auth_api', mensaje: 'Token expirado' } }, 401)
					}
					// Request B waits until Request A has completed renewal and retried
					await requestBFirstFetchGate
					return jsonResponse({ detail: { type: 'auth_api', mensaje: 'Token expirado' } }, 401)
				}

				if (authHeader === 'Bearer T2') {
					contractCallsT2++
					return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
				}
			}

			return textResponse('Not Found', 404)
		})

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})

		// 1. Establish initial session with T1
		const initialSession = await client.login()
		assert.equal(initialSession.accessToken, 'T1')
		assert.equal(loginCalls, 1)

		// 2. Launch Request A and Request B concurrently using T1
		const promiseA = client.listContractIds()
		const promiseB = client.listContractIds()

		// 3. Await Request A, which receives 401, invalidates T1, logs in to get T2, and succeeds with T2
		const resultA = await promiseA
		assert.deepEqual(resultA, [900101, 900102])
		assert.equal(loginCalls, 2)
		assert.equal(client.getSession()?.accessToken, 'T2')

		// 4. Release Request B's in-flight request that used T1
		// When B receives 401, the current session is already T2 (not T1), so B must NOT clear T2
		releaseRequestBFirstFetch()
		const resultB = await promiseB
		assert.deepEqual(resultB, [900101, 900102])

		// 5. Verify that no additional login was triggered and session remains T2
		assert.equal(loginCalls, 2)
		assert.equal(client.getSession()?.accessToken, 'T2')
		assert.equal(contractCallsT1, 2)
		assert.equal(contractCallsT2, 2)
	})

	it('manejo de errores de red y timeout', async () => {
		const clientTimeout = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			timeoutMs: 10,
			fetchFn: createMockFetch(async (_url, init) => {
				await new Promise<void>((_, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new Error('The operation was aborted'))
					})
				})
				return textResponse('never', 200)
			}),
		})

		await assert.rejects(
			async () => clientTimeout.login(),
			(error: Error) => {
				assert.ok(error instanceof BillingApiNetworkError)
				assert.match(error.message, /Request timed out/i)
				return true
			},
		)

		const clientNetwork = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async () => {
				throw new TypeError('fetch failed: ECONNREFUSED')
			}),
		})

		await assert.rejects(
			async () => clientNetwork.login(),
			(error: Error) => {
				assert.ok(error instanceof BillingApiNetworkError)
				assert.match(error.message, /Network error/i)
				return true
			},
		)
	})

	it('clasificación correcta de los errores HTTP 400', async () => {
		// 1. Parameter validation error (array of objects)
		const clientValidation = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse([{ source: 'query', field: 'page', message: 'value is not a valid integer' }], 400)
			}),
		})

		await assert.rejects(
			async () => clientValidation.listContractIds({ page: Number('abc') }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiValidationError)
				assert.equal(error.statusCode, 400)
				assert.equal(error.validationErrors?.length, 1)
				assert.equal(error.validationErrors?.[0]?.field, 'page')
				return true
			},
		)

		// 2. Non-existent contract error ("17.1) No se pudo recuperar la informacion")
		const clientNotFound = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse({ detail: { type: 'parametros', mensaje: '17.1) No se pudo recuperar la informacion' } }, 400)
			}),
		})

		await assert.rejects(
			async () => clientNotFound.getPendingInstallments({ id_contrato: 999999 }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiNotFoundError)
				assert.equal(error.statusCode, 400)
				assert.equal(error.detail?.type, 'parametros')
				return true
			},
		)

		// 3. Invalid credentials on login
		const clientAuth400 = new BillingApiClient({
			baseUrl: 'http://api.test',
			fetchFn: createMockFetch(async () => {
				return jsonResponse({ detail: { type: 'password', mensaje: 'Contraseña Incorrecta' } }, 400)
			}),
		})

		await assert.rejects(
			async () => clientAuth400.login({ username: 'cobrix', password: 'bad-password' }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiAuthError)
				assert.equal(error.statusCode, 400)
				assert.equal(error.detail?.type, 'password')
				return true
			},
		)
	})
})

describe('Cliente API: Validación de respuestas', () => {
	it('validación de una respuesta JSON malformada', async () => {
		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			fetchFn: createMockFetch(async () => {
				return textResponse('<html><body>Internal error</body></html>', 200, 'text/html')
			}),
		})

		await assert.rejects(
			async () => client.login({ username: 'cobrix', password: 'secret' }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiResponseError)
				assert.match(error.message, /Response is not valid JSON/i)
				return true
			},
		)
	})

	it('validación de respuestas con propiedades obligatorias ausentes o tipos incorrectos', async () => {
		// Missing access_token
		const clientMissingProps = new BillingApiClient({
			baseUrl: 'http://api.test',
			fetchFn: createMockFetch(async () => {
				return jsonResponse({ usuario: 'cobrix', email: 'cobrix@example.com' })
			}),
		})

		await assert.rejects(
			async () => clientMissingProps.login({ username: 'cobrix', password: 'secret' }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiResponseError)
				assert.match(error.message, /Incomplete login structure/i)
				return true
			},
		)

		// Malformed expiry date
		const clientBadDate = new BillingApiClient({
			baseUrl: 'http://api.test',
			fetchFn: createMockFetch(async () => {
				return jsonResponse({
					usuario: 'cobrix',
					email: 'cobrix@example.com',
					access_token: 'fake-jwt',
					access_token_expires_in: 'fecha-invalida',
				})
			}),
		})

		await assert.rejects(
			async () => clientBadDate.login({ username: 'cobrix', password: 'secret' }),
			(error: Error) => {
				assert.ok(error instanceof BillingApiResponseError)
				assert.match(error.message, /Invalid token expiration date/i)
				return true
			},
		)
	})

	it('lectura correcta de la lista de contratos dentro de su envolvente', async () => {
		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}),
		})

		const ids = await client.listContractIds()
		assert.deepEqual(ids, [900101, 900102])

		const envelope = await client.listContractIdsEnvelope()
		assert.equal(envelope.success, true)
		assert.equal(envelope.pagination.total, 2)
		assert.deepEqual(envelope.data, [900101, 900102])
	})

	it('lectura correcta del arreglo plano de contratos', async () => {
		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse([MOCK_PENDING_ROW])
			}),
		})

		const rows = await client.getPendingInstallments({ id_contrato: 900101 })
		assert.equal(rows.length, 1)
		assert.equal(rows[0]?.contrato_id, 900101)
		assert.equal(rows[0]?.identificacion_contrato, 'V-12345678')
		assert.equal(rows[0]?.deuda, 20)
		assert.equal(rows[0]?.deuda_id, '7000008')
	})

	it('lectura correcta de la envolvente de pagos aunque success sea false y los datos sean válidos', async () => {
		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse(MOCK_PAYMENT_BOOK_RESPONSE)
			}),
		})

		const rows = await client.getPaymentBook({
			id_contrato: 900101,
			tipo_busqueda: 'CUOTA',
			fecha_inicio: '2026-03-01',
			fecha_fin: '2026-10-31',
		})

		assert.equal(rows.length, 1)
		assert.equal(rows[0]?.id_factura, 8800007)
		assert.equal(rows[0]?.detalle_pago.id_cuota, 7000008)
		assert.equal(rows[0]?.detalle_pago.saldo_cuota, 0)
		assert.equal(rows[0]?.detalle_pago.valor_pago, 25)
	})

	it('envío de todos los parámetros obligatorios del endpoint de pagos', async () => {
		let capturedUrl = ''

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				capturedUrl = url
				return jsonResponse(MOCK_PAYMENT_BOOK_RESPONSE)
			}),
		})

		await client.getPaymentBook({
			id_contrato: 900101,
			tipo_busqueda: 'CUOTA',
			fecha_inicio: '2026-03-01',
			fecha_fin: '2026-10-31',
		})

		const urlObj = new URL(capturedUrl)
		assert.equal(urlObj.searchParams.get('id_contrato'), '900101')
		assert.equal(urlObj.searchParams.get('tipo_busqueda'), 'CUOTA')
		assert.equal(urlObj.searchParams.get('fecha_inicio'), '2026-03-01')
		assert.equal(urlObj.searchParams.get('fecha_fin'), '2026-10-31')
	})

	it('omisión del parámetro estado al consultar todos los contratos', async () => {
		let capturedUrl = ''

		const client = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				capturedUrl = url
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}),
		})

		await client.listContractIds()
		const urlObj = new URL(capturedUrl)
		assert.equal(urlObj.searchParams.has('estado'), false)
	})

	it('testConnection valida conectividad correctamente', async () => {
		const clientSuccess = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn: createMockFetch(async url => {
				if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
				return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
			}),
		})

		const successResult = await clientSuccess.testConnection()
		assert.equal(successResult.ok, true)
		assert.equal(successResult.totalContracts, 2)
		assert.match(successResult.message, /Connection successful/i)

		const clientFailure = new BillingApiClient({
			baseUrl: 'http://api.test',
			username: 'cobrix',
			password: 'bad-password',
			fetchFn: createMockFetch(async () => {
				return jsonResponse({ detail: { type: 'password', mensaje: 'Contraseña Incorrecta' } }, 400)
			}),
		})

		const failureResult = await clientFailure.testConnection()
		assert.equal(failureResult.ok, false)
		assert.equal(failureResult.totalContracts, 0)
		assert.match(failureResult.message, /Contraseña Incorrecta/)
	})
})

describe('Cliente API: Normalización de URL', () => {
	it('normaliza baseUrl tanto con prefijo /api/v1 como sin él sin duplicar rutas', async () => {
		const capturedUrls: string[] = []

		const fetchFn = createMockFetch(async url => {
			capturedUrls.push(url)
			if (url.endsWith('/api/v1/usuario/login')) return jsonResponse(mockLoginResponse())
			return jsonResponse(MOCK_CONTRACT_IDS_RESPONSE)
		})

		// 1. baseUrl sin prefijo /api/v1
		const clientWithoutPrefix = new BillingApiClient({
			baseUrl: 'http://127.0.0.1:4310',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})
		await clientWithoutPrefix.listContractIds()

		// 2. baseUrl con prefijo /api/v1
		const clientWithPrefix = new BillingApiClient({
			baseUrl: 'http://127.0.0.1:4310/api/v1',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})
		await clientWithPrefix.listContractIds()

		// 3. baseUrl con barra diagonal final y prefijo /api/v1/
		const clientWithTrailingSlash = new BillingApiClient({
			baseUrl: 'http://127.0.0.1:4310/api/v1/',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})
		await clientWithTrailingSlash.listContractIds()

		// 4. baseUrl con barra diagonal final sin /api/v1
		const clientRootWithSlash = new BillingApiClient({
			baseUrl: 'http://127.0.0.1:4310/',
			username: 'cobrix',
			password: 'cobrix-sandbox',
			fetchFn,
		})
		await clientRootWithSlash.listContractIds()

		assert.equal(capturedUrls.length, 8)

		// 1. Demostrar que baseUrl = "http://127.0.0.1:4310" produce http://127.0.0.1:4310/api/v1/...
		assert.equal(capturedUrls[0], 'http://127.0.0.1:4310/api/v1/usuario/login')
		assert.equal(capturedUrls[1], 'http://127.0.0.1:4310/api/v1/isp/lista_ids_contratos')

		// 2. Demostrar que baseUrl = "http://127.0.0.1:4310/api/v1" produce http://127.0.0.1:4310/api/v1/...
		assert.equal(capturedUrls[2], 'http://127.0.0.1:4310/api/v1/usuario/login')
		assert.equal(capturedUrls[3], 'http://127.0.0.1:4310/api/v1/isp/lista_ids_contratos')

		// 3. Demostrar que las variantes con barra final funcionan idénticamente
		assert.equal(capturedUrls[4], 'http://127.0.0.1:4310/api/v1/usuario/login')
		assert.equal(capturedUrls[5], 'http://127.0.0.1:4310/api/v1/isp/lista_ids_contratos')
		assert.equal(capturedUrls[6], 'http://127.0.0.1:4310/api/v1/usuario/login')
		assert.equal(capturedUrls[7], 'http://127.0.0.1:4310/api/v1/isp/lista_ids_contratos')

		// 4. Demostrar que no se genera nunca /api/v1/api/v1/
		for (const capturedUrl of capturedUrls) {
			assert.equal(capturedUrl.includes('/api/v1/api/v1/'), false)
		}
	})
})

