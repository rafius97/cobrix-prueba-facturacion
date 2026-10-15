/**
 * Pruebas de integración de ImportService.
 * Cubre simulación, criterios de aceptación, idempotencia, exclusiones,
 * límites de corrida y atomicidad ante fallos.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { seedBillingApi } from '../../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../../src/billing-api/server.ts'
import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import type { JsonValue } from '../../src/cobrix/client/validators.ts'
import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	configRepository,
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import { ImportService } from '../../src/cobrix/sync/import-service.ts'

// Fijar fecha de la prueba técnica para coincidir con la base sembrada
process.env.SANDBOX_TODAY = '2026-10-13'

// ============================================================================
// Utilidades para Mock de Billing API en pruebas unitarias/aisladas
// ============================================================================

const MOCK_AUTH_OPTIONS = {
	baseUrl: 'http://billing.test',
	username: 'cobrix',
	password: 'cobrix-sandbox',
} as const

function jsonResponse(data: JsonValue, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
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

function mockLoginResponse(): JsonValue {
	return {
		usuario: 'cobrix',
		email: 'cobrix@example.com',
		access_token: 'fake-jwt-token-xyz',
		access_token_expires_in: new Date(Date.now() + 7_200_000).toISOString().slice(0, 19),
	}
}

function createMockPendingRow(overrides?: Partial<Record<string, JsonValue>>): Record<string, JsonValue> {
	return {
		dia_cobro: 26,
		dia_corte: 4,
		id_tipo_duracion: 0,
		duracion: 0,
		tipo_duracion: '',
		fecha_cobro_prox: '2026-10-26',
		fecha_corte_prox: '2026-11-04',
		contrato_id: 1001,
		id_empresa: 0,
		codigo: '01001',
		identificacion_contrato: 'V-12345678',
		nombre_contrato: 'JUAN PEREZ',
		telefono: '04121112233',
		email: 'JUAN.PEREZ@EXAMPLE.COM',
		estado: 'ACTIVO',
		tipo_contrato_de_cobro: 'PREPAGO',
		direccion: 'AVENIDA PRINCIPAL',
		cuotas_vencidad: 1,
		deuda: 25,
		detalle_tipo_deuda: ['CUOTA'],
		tipo_deuda: 'cuota',
		deuda_id: '8000001',
		nombre_servicio: 'Internet',
		precio_servicio: '25.000000',
		nombre_plan: 'PLAN15MB25',
		nombre_empresa: 'EMPRESA',
		nombre_comercial_empresa: 'EMPRESA COMERCIAL',
		identificacion_empresa: 'J-12345678',
		nombre_sucursal: 'SUCURSAL 1',
		identificacion_sucursal: '',
		sigla_sucursal: 'SUC1',
		informacion_adicional: '',
		detalle_deuda: ['PLAN15MB25 - 2026 Agosto'],
		detalle: ['PLAN15MB25 - 8000001 - 1'],
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
		...overrides,
	}
}

// ============================================================================
// Suites de Pruebas
// ============================================================================

describe('ImportService: Criterios de aceptación e idempotencia', () => {
	let tempDir: string
	let billingServer: BillingApiServer
	let baseUrl: string

	before(async () => {
		tempDir = mkdtempSync(join(tmpdir(), 'cobrix-import-test-'))
		const dbPath = join(tempDir, 'billing-api.sqlite')
		seedBillingApi(dbPath)
		billingServer = createBillingApiServer(dbPath)
		const port = await billingServer.listen(0)
		baseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		await billingServer.close()
		rmSync(tempDir, { recursive: true, force: true })
	})

	it('simulación evalúa las 42 cuotas sin persistir registros de negocio', async () => {
		const db = createCobrixDatabase(':memory:')
		const client = new BillingApiClient({
			baseUrl,
			username: 'cobrix',
			password: 'cobrix-sandbox',
		})
		const service = new ImportService(db, client)

		const result = await service.run({ isSimulation: true })

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.isSimulation, true)
		assert.equal(result.summary.importedInvoicesCount, 42)
		assert.equal(result.summary.importedAmountCents, 123500)
		assert.equal(result.summary.newCustomersCount, 20)

		// Verificar que no se creó ningún registro en las tablas de negocio
		assert.equal(customerRepository.list(db).length, 0)
		assert.equal(contractRepository.listByCustomerId(db, 'V12345678').length, 0)
		assert.equal(invoiceRepository.listOpen(db).length, 0)

		// Verificar que sí se guardó el registro de auditoría de la corrida
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		const run = runs[0]
		assert.ok(run !== undefined)
		assert.equal(run.isSimulation, true)
		assert.equal(run.status, 'COMPLETED')

		const details = syncRunRepository.listDetailsByRunId(db, run.id)
		assert.ok(details.length > 0)
		const importedDetails = details.filter(d => d.result === 'IMPORTED')
		assert.equal(importedDetails.length, 42)
	})

	it('importación real genera exactamente 20 clientes, 42 facturas y USD 1.235,00', async () => {
		const db = createCobrixDatabase(':memory:')
		const client = new BillingApiClient({
			baseUrl,
			username: 'cobrix',
			password: 'cobrix-sandbox',
		})
		const service = new ImportService(db, client)

		const result = await service.run({ isSimulation: false })

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.isSimulation, false)
		assert.equal(result.summary.importedInvoicesCount, 42)
		assert.equal(result.summary.importedAmountCents, 123500)
		assert.equal(result.summary.newCustomersCount, 20)

		// Comprobar clientes en SQLite
		const customers = customerRepository.list(db)
		assert.equal(customers.length, 20)

		// Comprobar facturas en SQLite
		const invoices = invoiceRepository.listOpen(db)
		assert.equal(invoices.length, 42)
		const totalCents = invoices.reduce((acc: number, inv) => acc + inv.totalAmountCents, 0)
		assert.equal(totalCents, 123500)

		// Caso especial: Luis Gómez tiene dos contratos en un único cliente
		const luis = customerRepository.getById(db, 'V9876543')
		assert.ok(luis !== null)
		assert.equal(luis.name, 'LUIS GOMEZ')
		const luisContracts = contractRepository.listByCustomerId(db, 'V9876543')
		assert.equal(luisContracts.length, 2)

		// Caso especial: Elena Ruiz normalizada sin letra y sin ceros a la izquierda (9000123)
		const elena = customerRepository.getById(db, '9000123')
		assert.ok(elena !== null)
		assert.equal(elena.name, 'ELENA RUIZ')

		// Titulares excluidos según el enunciado: no deben estar en clientes
		assert.equal(customerRepository.getById(db, 'V15111222'), null, 'Carlos Rojas debe estar excluido')
		assert.equal(customerRepository.getById(db, 'V16222333'), null, 'Rosa Díaz debe estar excluida')
		assert.equal(customerRepository.getById(db, 'V17333444'), null, 'Pedro León debe estar excluido')
		assert.equal(customerRepository.getById(db, 'V18444555'), null, 'Laura Méndez no tiene deuda')
		assert.equal(customerRepository.getById(db, 'V19555666'), null, 'Jorge Castillo tiene moneda incoherente')
		assert.equal(customerRepository.getById(db, 'V21777888'), null, 'Andrés Vargas debe estar excluido')

		// Sofía Torres: su cuota residual se excluye pero su cuota activa se importa
		const sofia = customerRepository.getById(db, 'V20666777')
		assert.ok(sofia !== null, 'Sofía Torres debe ser importada')
		assert.equal(sofia.name, 'SOFIA TORRES')

		const sofiaContracts = contractRepository.listByCustomerId(db, 'V20666777')
		assert.equal(sofiaContracts.length, 1)
		const sofiaContract = sofiaContracts[0]
		assert.ok(sofiaContract !== undefined)

		const residualItem = result.details.find(d => d.result === 'RESIDUAL_BALANCE' && d.contractId === sofiaContract.id)
		assert.ok(residualItem !== undefined, 'Sofía Torres debe tener una evaluación RESIDUAL_BALANCE')
		assert.equal(result.summary.residualBalanceCount, 1)

		// Eventos de auditoría de clientes
		const luisEvents = customerEventRepository.listByCustomerId(db, 'V9876543')
		const createdEvents = luisEvents.filter(e => e.eventType === 'CUSTOMER_CREATED')
		assert.equal(createdEvents.length, 1, 'Luis Gómez debe tener un solo evento CUSTOMER_CREATED')
	})

	it('idempotencia: segunda corrida no duplica facturas y clasifica 42 ALREADY_IMPORTED', async () => {
		const db = createCobrixDatabase(':memory:')
		const client = new BillingApiClient({
			baseUrl,
			username: 'cobrix',
			password: 'cobrix-sandbox',
		})
		const service = new ImportService(db, client)

		// Primera corrida
		const firstResult = await service.run({ isSimulation: false })
		assert.equal(firstResult.summary.importedInvoicesCount, 42)

		// Segunda corrida
		const secondResult = await service.run({ isSimulation: false })
		assert.equal(secondResult.status, 'COMPLETED')
		assert.equal(secondResult.summary.importedInvoicesCount, 0)
		assert.equal(secondResult.summary.importedAmountCents, 0)
		assert.equal(secondResult.summary.newCustomersCount, 0)
		assert.equal(secondResult.summary.alreadyImportedCount, 42)

		// La base de datos sigue teniendo exactamente 20 clientes y 42 facturas
		assert.equal(customerRepository.list(db).length, 20)
		assert.equal(invoiceRepository.listOpen(db).length, 42)
	})
})

describe('ImportService: Reglas de exclusión', () => {
	it('excluye contrato por estado no importable (EXCLUDED_STATUS)', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [2001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 2001, estado: 'SUSPENDIDO' })])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.excludedByStatusCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
		assert.equal(invoiceRepository.listOpen(db).length, 0)
	})

	it('excluye titular por tipo de documento configurado (EXCLUDED_DOCUMENT_TYPE)', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { excludedDocumentTypes: ['J', 'G'] })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [3001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([createMockPendingRow({
					contrato_id: 3001,
					identificacion_contrato: 'J-40123456-7',
					nombre_contrato: 'EMPRESA EJEMPLO S.A.',
				})])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.excludedByDocumentTypeCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})

	it('excluye cuotas más antiguas que la ventana configurada (OUT_OF_WINDOW)', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { windowMonths: 3 })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [4001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([
					createMockPendingRow({
						contrato_id: 4001,
						deuda_id: '9100001',
						detalle_deuda: ['PLAN15MB25 - 2026 Enero'], // Enero 2026 está fuera de la ventana de 3 meses para 2026-10
					}),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.outOfWindowCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})

	it('conserva cuotas más recientes al superar maxRecentInstallments (EXCLUDED_MAX_INSTALLMENTS)', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { maxRecentInstallments: 2 })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [5001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([
					createMockPendingRow({ contrato_id: 5001, deuda_id: '9200001', detalle_deuda: ['PLAN15MB25 - 2026 Agosto'] }),
					createMockPendingRow({ contrato_id: 5001, deuda_id: '9200002', detalle_deuda: ['PLAN15MB25 - 2026 Septiembre'] }),
					createMockPendingRow({ contrato_id: 5001, deuda_id: '9200003', detalle_deuda: ['PLAN15MB25 - 2026 Octubre'] }),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.importedInvoicesCount, 2)
		assert.equal(result.summary.excludedByMaxInstallmentsCount, 1)

		// Las cuotas importadas deben ser las más recientes (Octubre y Septiembre)
		const invoices = invoiceRepository.listOpen(db)
		assert.equal(invoices.length, 2)
		const periods = invoices.map(i => i.period)
		assert.ok(periods.includes('2026-10'))
		assert.ok(periods.includes('2026-09'))
		assert.ok(!periods.includes('2026-08'))
	})

	it('detecta moneda incoherente cuando la deuda es menor al 1% del precio del plan (INCONSISTENT_CURRENCY)', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [6001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([
					createMockPendingRow({
						contrato_id: 6001,
						precio_servicio: '30.000000',
						deuda: 0.05, // 0.05 < 0.30 (1 % de 30)
						deuda_id: '9300001',
					}),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.inconsistentCurrencyCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})

	it('clasifica cuota de saldo residual sin descartar el contrato (RESIDUAL_BALANCE)', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [7001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([
					createMockPendingRow({ contrato_id: 7001, deuda_id: '9400001', deuda: 0.001317 }),
					createMockPendingRow({ contrato_id: 7001, deuda_id: '9400002', deuda: 25.0 }),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.residualBalanceCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 1)
		assert.equal(invoiceRepository.listOpen(db).length, 1)
	})

	it('clasifica cuota con deuda_id 0 como NO_DEBT', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [8001] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 8001, deuda_id: '0', deuda: 0 })])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.noDebtCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})

	it('detecta respuestas contradictorias y las clasifica como INVALID_DATA', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [9001] })
			}
			if (url.includes('/contrato/individual')) {
				// Dos filas con el mismo deuda_id en un contrato
				return jsonResponse([
					createMockPendingRow({ contrato_id: 9001, deuda_id: '9999999' }),
					createMockPendingRow({ contrato_id: 9001, deuda_id: '9999999' }),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.invalidDataCount, 2)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})

	it('descarta contratos con identificación no normalizable (INVALID_IDENTIFICATION)', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [9501] })
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 9501, identificacion_contrato: 'INVALIDA-SIN-DIGITOS' })])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.invalidIdentificationCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 0)
	})
})

describe('ImportService: Límites de corrida', () => {
	it('frena secuencialmente ante runInvoiceLimit', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { runInvoiceLimit: 2 })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [1101, 1102, 1103, 1104] })
			}
			if (url.includes('id_contrato=1101')) return jsonResponse([createMockPendingRow({ contrato_id: 1101, deuda_id: '10001' })])
			if (url.includes('id_contrato=1102')) return jsonResponse([createMockPendingRow({ contrato_id: 1102, deuda_id: '10002' })])
			if (url.includes('id_contrato=1103')) return jsonResponse([createMockPendingRow({ contrato_id: 1103, deuda_id: '10003' })])
			if (url.includes('id_contrato=1104')) return jsonResponse([createMockPendingRow({ contrato_id: 1104, deuda_id: '10004' })])
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.importedInvoicesCount, 2)
		assert.equal(result.summary.limitReachedCount, 2)
		assert.equal(invoiceRepository.listOpen(db).length, 2)

		// Las cuotas 10003 y 10004 deben tener resultado LIMIT_REACHED con limitType INVOICE_LIMIT
		const limited = result.details.filter(d => d.result === 'LIMIT_REACHED')
		assert.equal(limited.length, 2)
		for (const item of limited) {
			if (item.result === 'LIMIT_REACHED') {
				assert.equal(item.limitType, 'INVOICE_LIMIT')
			}
		}
	})

	it('frena secuencialmente ante runAmountLimitCents sin permitir cuotas menores posteriores', async () => {
		const db = createCobrixDatabase(':memory:')
		// Límite de 5000 centavos ($50,00)
		configRepository.update(db, { runAmountLimitCents: 5000 })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [1201, 1202, 1203] })
			}
			// Cuota 1: $30 (acumulado $30) -> Entra
			if (url.includes('id_contrato=1201')) return jsonResponse([createMockPendingRow({ contrato_id: 1201, deuda_id: '20001', deuda: 30 })])
			// Cuota 2: $35 ($30 + $35 = $65 > $50) -> Frena la corrida
			if (url.includes('id_contrato=1202')) return jsonResponse([createMockPendingRow({ contrato_id: 1202, deuda_id: '20002', deuda: 35 })])
			// Cuota 3: $5 (cabría en los $20 restantes, pero la corrida ya frenó) -> LIMIT_REACHED
			if (url.includes('id_contrato=1203')) return jsonResponse([createMockPendingRow({ contrato_id: 1203, deuda_id: '20003', deuda: 5 })])
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.summary.importedInvoicesCount, 1)
		assert.equal(result.summary.importedAmountCents, 3000)
		assert.equal(result.summary.limitReachedCount, 2)
		assert.equal(invoiceRepository.listOpen(db).length, 1)

		const limited = result.details.filter(d => d.result === 'LIMIT_REACHED')
		assert.equal(limited.length, 2)
		for (const item of limited) {
			if (item.result === 'LIMIT_REACHED') {
				assert.equal(item.limitType, 'AMOUNT_LIMIT')
			}
		}
	})

	it('cuotas ya importadas siguen reconociéndose como ALREADY_IMPORTED al alcanzar un límite', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { runInvoiceLimit: 1 })

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [1301, 1302] })
			}
			if (url.includes('id_contrato=1301')) return jsonResponse([createMockPendingRow({ contrato_id: 1301, deuda_id: '30001' })])
			if (url.includes('id_contrato=1302')) return jsonResponse([createMockPendingRow({ contrato_id: 1302, deuda_id: '30002' })])
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)

		// Primera corrida: importa 1301, 1302 queda frenada por límite de 1
		const run1 = await service.run()
		assert.equal(run1.summary.importedInvoicesCount, 1)
		assert.equal(run1.summary.limitReachedCount, 1)

		// Segunda corrida con límite de 0 (o sin límite): 1301 es ALREADY_IMPORTED y 1302 es IMPORTED
		configRepository.update(db, { runInvoiceLimit: 0 })
		const run2 = await service.run()
		assert.equal(run2.summary.alreadyImportedCount, 1)
		assert.equal(run2.summary.importedInvoicesCount, 1)
		assert.equal(invoiceRepository.listOpen(db).length, 2)
	})
})

describe('ImportService: Atomicidad y recuperación', () => {
	it('rollback completo revierte todas las mutaciones cuando falla la persistencia', async () => {
		const db = createCobrixDatabase(':memory:')

		// Crear un disparador (trigger) en SQLite que fuerce un error de persistencia
		// en la segunda factura que intente insertarse
		db.exec(`
			CREATE TRIGGER fail_second_invoice
			BEFORE INSERT ON invoice
			WHEN NEW.external_debt_id = 'ERR_DEBT'
			BEGIN
				SELECT RAISE(FAIL, 'Simulated SQLite constraint failure in invoice table');
			END;
		`)

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [1401, 1402] })
			}
			if (url.includes('id_contrato=1401')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 1401, deuda_id: 'OK_DEBT', identificacion_contrato: 'V-11111111' })])
			}
			if (url.includes('id_contrato=1402')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 1402, deuda_id: 'ERR_DEBT', identificacion_contrato: 'V-22222222' })])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)

		const result = await service.run()

		// 1. La corrida debe registrarse como fallida
		assert.equal(result.status, 'FAILED')
		assert.ok(result.errorMessage?.includes('Simulated SQLite constraint failure'))

		// 2. Ninguna factura ni cliente de esta corrida debe persistir en la base de datos
		assert.equal(customerRepository.list(db).length, 0, 'No debe quedar ningún cliente persistido tras el rollback')
		assert.equal(invoiceRepository.listOpen(db).length, 0, 'No debe quedar ninguna factura tras el rollback')
		assert.equal(customerEventRepository.listByCustomerId(db, 'V11111111').length, 0)

		// 3. Los contadores no deben indicar facturas importadas
		assert.equal(result.summary.importedInvoicesCount, 0)
		assert.equal(result.summary.importedAmountCents, 0)
		assert.equal(result.summary.newCustomersCount, 0)

		// 4. Se debe registrar el registro de auditoría FAILED en sync_run
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		const failedRun = runs[0]
		assert.ok(failedRun !== undefined)
		assert.equal(failedRun.status, 'FAILED')
		assert.ok(failedRun.errorMessage?.includes('Simulated SQLite constraint failure'))
	})

	it('maneja BillingApiNotFoundError (error 17.1 contrato no encontrado) sin abortar la corrida', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/lista_ids_contratos')) {
				return jsonResponse({ success: true, message: 'ok', pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 }, errors: [], data: [1501, 1502] })
			}
			// Contrato 1501 devuelve error 17.1 del ISP
			if (url.includes('id_contrato=1501')) {
				return jsonResponse({ detail: { type: 'parametros', mensaje: '17.1) No se pudo recuperar la informacion' } }, 400)
			}
			// Contrato 1502 es válido
			if (url.includes('id_contrato=1502')) {
				return jsonResponse([createMockPendingRow({ contrato_id: 1502, deuda_id: '50002' })])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.invalidDataCount, 1)
		assert.equal(result.summary.importedInvoicesCount, 1)
		assert.equal(invoiceRepository.listOpen(db).length, 1)
	})

	it('maneja errores de red o autenticación global abortando la corrida como FAILED', async () => {
		const db = createCobrixDatabase(':memory:')
		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) {
				return jsonResponse({ detail: { type: 'autenticacion', mensaje: 'Credenciales invalidas' } }, 401)
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new ImportService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'FAILED')
		assert.ok(result.errorMessage !== undefined)
		assert.equal(result.summary.importedInvoicesCount, 0)
		assert.equal(invoiceRepository.listOpen(db).length, 0)

		// sync_run debe quedar guardada como FAILED
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		assert.equal(runs[0]?.status, 'FAILED')
	})
})
