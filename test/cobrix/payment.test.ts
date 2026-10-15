/**
 * Pruebas de integración y aceptación de PaymentSyncService.
 * Cubre conciliación de pagos, pagos parciales, exenciones, idempotencia,
 * simulación, atomicidad ante fallos y el ciclo completo de aceptación (§5).
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'

import { seedBillingApi } from '../../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../../src/billing-api/server.ts'
import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import { isJsonObject, parseJsonSafe, type JsonValue } from '../../src/cobrix/client/validators.ts'
import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	customerEventRepository,
	customerRepository,
	contractRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import type { Invoice } from '../../src/cobrix/db/types.ts'
import { ImportService } from '../../src/cobrix/sync/import-service.ts'
import { PaymentSyncService } from '../../src/cobrix/sync/payment-sync-service.ts'

// Fijar fecha de la prueba técnica para coincidir con la base sembrada del ISP
process.env.SANDBOX_TODAY = '2026-10-13'

// ============================================================================
// Utilidades para Mock de Billing API en pruebas aisladas
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

function createMockPaymentBookRow(options: {
	id_factura?: number
	num_factura?: string
	fecha_emision?: string
	fecha_vence?: string
	id_contrato?: number
	id_cuota: number
	periodo_cuota?: string
	tarifa?: number
	valor_pago?: number
	saldo_cuota?: number
	total_adicional?: number
	valor_uso?: number
	valor_no_uso?: number
	descuento?: number
	valor_nota_credito?: number
	detalle?: JsonValue[]
}): Record<string, JsonValue> {
	const fechaEmision = options.fecha_emision ?? '2026-10-01'
	const fechaVence = options.fecha_vence ?? fechaEmision
	const idContrato = options.id_contrato ?? 1001
	return {
		id_factura: options.id_factura ?? 8800001,
		cod_empresa: 1,
		cod_sucursal: 1,
		dmcc_cod_empresa: 0,
		dmcc_cod_sucursal: 0,
		cod_tran: '',
		asiento: '',
		identificacion_cliente_factura: 'V-12345678',
		nombre_cliente_factura: 'CLIENTE TEST',
		nombre_cliente: 'CLIENTE TEST',
		identificacion_cliente: 'V-12345678',
		codigo_cliente: 'CLI001',
		tipo_contrato: 'Internet',
		num_factura: options.num_factura ?? '008800001',
		ejercio_fiscal: 43,
		id_cliente: 101,
		fecha_vence: fechaVence,
		fecha_emision: fechaEmision,
		periodo_fecha: fechaEmision.slice(0, 7),
		id_contrato: idContrato,
		fact_cod_contr: String(idContrato),
		compara_id_contrato_1: 'igual',
		compara_id_contrato_2: 'igual',
		detalle_pago: {
			id_contrato: idContrato,
			id_cliente: 101,
			id_cuota: options.id_cuota,
			tipo_contrato: 'Internet',
			periodo_cuota: options.periodo_cuota ?? '2026-08',
			tarifa: options.tarifa ?? 25,
			total_adicional: options.total_adicional ?? 0,
			valor_pago: options.valor_pago ?? 25,
			valor_uso: options.valor_uso ?? 0,
			valor_no_uso: options.valor_no_uso ?? 0,
			descuento: options.descuento ?? 0,
			valor_nota_credito: options.valor_nota_credito ?? 0,
			saldo_cuota: options.saldo_cuota ?? 0,
			detalle: options.detalle ?? [],
			detalle_dfac: `PLAN ${options.periodo_cuota ?? '2026-08'}`,
		},
	}
}

function createMockPendingRow(options: {
	contrato_id?: number
	deuda_id: string
	deuda?: number
	precio_servicio?: string
	detalle_deuda?: string[]
	periodo_cuota?: string
}): Record<string, JsonValue> {
	return {
		dia_cobro: 26,
		dia_corte: 4,
		id_tipo_duracion: 0,
		duracion: 0,
		tipo_duracion: '',
		fecha_cobro_prox: '2026-10-26',
		fecha_corte_prox: '2026-11-04',
		contrato_id: options.contrato_id ?? 1001,
		id_empresa: 0,
		codigo: '01001',
		identificacion_contrato: 'V-12345678',
		nombre_contrato: 'CLIENTE TEST',
		telefono: '04121112233',
		email: 'CLIENTE.TEST@EXAMPLE.COM',
		estado: 'ACTIVO',
		tipo_contrato_de_cobro: 'PREPAGO',
		direccion: 'AVENIDA PRINCIPAL',
		cuotas_vencidad: 1,
		deuda: options.deuda ?? 25,
		detalle_tipo_deuda: ['CUOTA'],
		tipo_deuda: 'cuota',
		deuda_id: options.deuda_id,
		nombre_servicio: 'Internet',
		precio_servicio: options.precio_servicio ?? '25.000000',
		nombre_plan: 'PLAN15MB25',
		nombre_empresa: 'EMPRESA',
		nombre_comercial_empresa: 'EMPRESA COMERCIAL',
		identificacion_empresa: 'J-12345678',
		nombre_sucursal: 'SUCURSAL 1',
		identificacion_sucursal: '',
		sigla_sucursal: 'SUC1',
		informacion_adicional: '',
		detalle_deuda: options.detalle_deuda ?? [`PLAN15MB25 - ${options.periodo_cuota ?? '2026 Agosto'}`],
		detalle: [`PLAN15MB25 - ${options.deuda_id} - 1`],
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
}

function seedCustomer(db: DatabaseSync, id = 'V12345678', name = 'TEST CUSTOMER'): void {
	customerRepository.create(db, {
		id,
		originalDocument: id,
		documentType: 'V',
		personType: 'NATURAL',
		name,
		phone: '04121234567',
		email: 'test@example.com',
		address: 'Caracas',
	})
}

function seedContract(db: DatabaseSync, id = 1001, customerId = 'V12345678'): void {
	contractRepository.upsert(db, {
		id,
		customerId,
		code: `CTR-${id}`,
		status: 'ACTIVO',
		plan: 'PLAN 25',
		planPriceCents: 2500,
		branch: 'SUC1',
		currency: 'USD',
		billingDay: 26,
		cutoffDay: 4,
	})
}

function seedInvoice(
	db: DatabaseSync,
	options: {
		invoiceNumber: string
		externalDebtId: string
		contractId?: number
		customerId?: string
		period?: string
		dueDate?: string
		cutDate?: string
		totalAmountCents: number
		balanceCents: number
		status?: 'OPEN' | 'PAID'
	},
): void {
	invoiceRepository.create(db, {
		invoiceNumber: options.invoiceNumber,
		externalDebtId: options.externalDebtId,
		contractId: options.contractId ?? 1001,
		customerId: options.customerId ?? 'V12345678',
		period: options.period ?? '2026-08',
		dueDate: options.dueDate ?? '2026-08-01',
		cutDate: options.cutDate ?? '2026-08-10',
		totalAmountCents: options.totalAmountCents,
		balanceCents: options.balanceCents,
		status: options.status ?? 'OPEN',
	})
}

function getAllInvoices(db: DatabaseSync): Invoice[] {
	const customers = customerRepository.list(db)
	const result: Invoice[] = []
	for (const c of customers) {
		const customerInvoices = invoiceRepository.listByCustomerId(db, c.id)
		for (const inv of customerInvoices) {
			result.push(inv)
		}
	}
	return result
}

// ============================================================================
// Grupo 1: Conciliación de pagos
// ============================================================================

describe('PaymentSyncService: Conciliación de Pagos', () => {
	it('una cuota con saldo cero y evidencia positiva de pago se marca como pagada', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1001',
			externalDebtId: '80001',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80001,
							saldo_cuota: 0,
							valor_pago: 25,
							id_factura: 8800001,
							num_factura: '008800001',
							fecha_emision: '2026-10-05',
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.markedPaidCount, 1)
		assert.equal(result.summary.markedPaidAmountCents, 2500)
		assert.equal(result.summary.stillOpenCount, 0)

		// Verificar factura en persistencia
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 0)

		const allInvoices = getAllInvoices(db)
		const paidInvoices = allInvoices.filter(i => i.status === 'PAID')
		assert.equal(paidInvoices.length, 1)
		const paidInv = paidInvoices[0]
		assert.ok(paidInv !== undefined)
		assert.equal(paidInv.status, 'PAID')
		assert.equal(paidInv.balanceCents, 0)
		assert.equal(paidInv.paidAt, '2026-10-05')
		assert.equal(paidInv.ispPaymentInvoice, '008800001')

		// Verificar evento de negocio generado
		const events = customerEventRepository.listByCustomerId(db, 'V12345678')
		assert.equal(events.length, 1)
		assert.equal(events[0]?.eventType, 'INVOICE_PAID')

		// Verificar detalle de auditoría
		const runDetails = syncRunRepository.listDetailsByRunId(db, result.runId)
		assert.equal(runDetails.length, 1)
		assert.equal(runDetails[0]?.result, 'MARKED_PAID')
	})

	it('una cuota con saldo positivo menor al saldo local recibe el saldo correcto y permanece abierta', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1002',
			externalDebtId: '80002',
			totalAmountCents: 2000,
			balanceCents: 2000,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80002,
							saldo_cuota: 15, // Quedan 15 USD pendientes (abono de 5 USD)
							valor_pago: 5,
							tarifa: 20,
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.partialPaymentsCount, 1)
		assert.equal(result.summary.partialPaymentsAmountCents, 500)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 1500)

		// Verificar que la factura sigue abierta con el nuevo saldo
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		const inv = openInvoices[0]
		assert.ok(inv !== undefined)
		assert.equal(inv.status, 'OPEN')
		assert.equal(inv.totalAmountCents, 2000)
		assert.equal(inv.balanceCents, 1500)
		assert.equal(inv.paidAt, null)

		// Verificar evento de abono parcial
		const events = customerEventRepository.listByCustomerId(db, 'V12345678')
		assert.equal(events.length, 1)
		assert.equal(events[0]?.eventType, 'PARTIAL_PAYMENT')
		assert.ok(events[0]?.metadataJson.includes('"paidAmountCents":500'))
		assert.ok(events[0]?.metadataJson.includes('"newBalanceCents":1500'))
	})

	it('una cuota con saldo cero y sin pago efectivo no se marca como pagada (EXEMPTION_NOT_PAYMENT)', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1003',
			externalDebtId: '80003',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80003,
							saldo_cuota: 0,
							valor_pago: 0, // Saldo cero pero sin pago efectivo
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.exemptionCount, 1)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 2500)

		// La factura debe permanecer abierta con su saldo íntegro
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.status, 'OPEN')
		assert.equal(openInvoices[0]?.balanceCents, 2500)
		assert.equal(customerEventRepository.listByCustomerId(db, 'V12345678').length, 0)
	})

	it('una cuota sin evidencia permanece abierta (NO_EVIDENCE)', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1004',
			externalDebtId: '80004',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-07',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 0, total: 0, total_pages: 0 },
					errors: [],
					data: [],
				})
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([]) // Tampoco aparece en pendientes
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.noEvidenceCount, 1)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 2500)

		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.balanceCents, 2500)
	})

	it('una cuota del período actual con saldo pendiente en el fallback permanece abierta (STILL_OPEN)', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1005',
			externalDebtId: '80005',
			totalAmountCents: 3000,
			balanceCents: 3000,
			period: '2026-10', // Período actual de la prueba
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 0, total: 0, total_pages: 0 },
					errors: [],
					data: [],
				})
			}
			if (url.includes('/contrato/individual')) {
				return jsonResponse([
					createMockPendingRow({
						contrato_id: 1001,
						deuda_id: '80005',
						deuda: 30,
						periodo_cuota: '2026 Octubre',
					}),
				])
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.noEvidenceCount, 0)
		assert.equal(result.summary.stillOpenBalanceCents, 3000)

		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.balanceCents, 3000)
	})

	it('las filas contradictorias para una misma cuota no producen mutaciones (CONTRADICTORY_DATA)', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1006',
			externalDebtId: '80006',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80006,
							saldo_cuota: 0,
							valor_pago: 25,
							num_factura: 'FAC-1',
						}),
						createMockPaymentBookRow({
							id_cuota: 80006,
							saldo_cuota: 20, // Saldo contradictorio con la fila anterior
							valor_pago: 5,
							num_factura: 'FAC-2',
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.contradictoryDataCount, 1)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 2500)

		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.balanceCents, 2500)
		assert.equal(customerEventRepository.listByCustomerId(db, 'V12345678').length, 0)
	})

	it('los datos monetarios inválidos no generan actualizaciones incorrectas (INVALID_DATA)', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1007',
			externalDebtId: '80007',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 1, total: 1, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80007,
							saldo_cuota: -10, // Saldo negativo inválido
							valor_pago: 35,
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.invalidDataCount, 1)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 2500)

		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.balanceCents, 2500)
	})

	it('las cuotas futuras en el libro de pagos no se concilian indebidamente si no corresponden a facturas abiertas', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1008',
			externalDebtId: '80008',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80008,
							saldo_cuota: 0,
							valor_pago: 25,
							num_factura: '008800008',
						}),
						createMockPaymentBookRow({
							id_cuota: 99999, // Cuota futura no existente en Cobrix
							periodo_cuota: '2026-11',
							saldo_cuota: 0,
							valor_pago: 25,
							num_factura: '008800999',
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.markedPaidCount, 1)
		assert.equal(result.summary.markedPaidAmountCents, 2500)

		// Solo la factura 80008 debe existir y estar pagada; no se debe crear la cuota 99999
		const allInvoices = getAllInvoices(db)
		assert.equal(allInvoices.filter(i => i.status === 'PAID').length, 1)
		assert.equal(invoiceRepository.listOpen(db).length, 0)
	})

	it('maneja múltiples filas de cobro para una cuota y selecciona deterministamente el comprobante más reciente', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-1009',
			externalDebtId: '80009',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 80009,
							saldo_cuota: 0,
							valor_pago: 25,
							id_factura: 8800010,
							num_factura: '008800010',
							fecha_emision: '2026-10-02',
						}),
						createMockPaymentBookRow({
							id_cuota: 80009,
							saldo_cuota: 0,
							valor_pago: 25,
							id_factura: 8800020,
							num_factura: '008800020',
							fecha_emision: '2026-10-06',
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.markedPaidCount, 1)

		const allInvoices = getAllInvoices(db)
		const paidInvoices = allInvoices.filter(i => i.status === 'PAID')
		assert.equal(paidInvoices.length, 1)
		const paidInv = paidInvoices[0]
		assert.ok(paidInv !== undefined)
		// Debe haber seleccionado la emisión más reciente (2026-10-06 y comprobante 008800020)
		assert.equal(paidInv.paidAt, '2026-10-06')
		assert.equal(paidInv.ispPaymentInvoice, '008800020')
	})
})

// ============================================================================
// Grupo 2: Idempotencia
// ============================================================================

describe('PaymentSyncService: Idempotencia', () => {
	it('segunda ejecución no duplica eventos ni vuelve a marcar facturas pagadas o abonos parciales', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-2001',
			externalDebtId: '81001',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})
		seedInvoice(db, {
			invoiceNumber: 'INV-2002',
			externalDebtId: '81002',
			totalAmountCents: 2000,
			balanceCents: 2000,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 81001,
							saldo_cuota: 0,
							valor_pago: 25,
							num_factura: '008800001',
						}),
						createMockPaymentBookRow({
							id_cuota: 81002,
							saldo_cuota: 15,
							valor_pago: 5,
							tarifa: 20,
							num_factura: '008800002',
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)

		// Primera corrida
		const result1 = await service.run()
		assert.equal(result1.status, 'COMPLETED')
		assert.equal(result1.summary.markedPaidCount, 1)
		assert.equal(result1.summary.partialPaymentsCount, 1)
		assert.equal(result1.summary.stillOpenCount, 1)
		assert.equal(result1.summary.stillOpenBalanceCents, 1500)

		const eventsRun1 = customerEventRepository.listByCustomerId(db, 'V12345678')
		assert.equal(eventsRun1.length, 2, 'Debe haber exactamente 2 eventos tras la primera corrida')

		// Segunda corrida sin cambios en la API
		const result2 = await service.run()
		assert.equal(result2.status, 'COMPLETED')
		assert.equal(result2.summary.markedPaidCount, 0, 'No debe volver a marcar como pagada ninguna factura')
		assert.equal(result2.summary.partialPaymentsCount, 0, 'No debe volver a aplicar abonos parciales ya reflejados')
		assert.equal(result2.summary.stillOpenCount, 1, 'La factura con saldo 1500 sigue abierta')
		assert.equal(result2.summary.stillOpenBalanceCents, 1500)

		// Verificar que el estado persistido de las facturas no cambió
		const openInvoicesAfter = invoiceRepository.listOpen(db)
		assert.equal(openInvoicesAfter.length, 1)
		assert.equal(openInvoicesAfter[0]?.externalDebtId, '81002')
		assert.equal(openInvoicesAfter[0]?.balanceCents, 1500)

		const allInvoicesAfter = getAllInvoices(db)
		const paidInvoicesAfter = allInvoicesAfter.filter(i => i.status === 'PAID')
		assert.equal(paidInvoicesAfter.length, 1)
		assert.equal(paidInvoicesAfter[0]?.externalDebtId, '81001')

		// Verificar que no se duplicaron eventos en customer_event
		const eventsRun2 = customerEventRepository.listByCustomerId(db, 'V12345678')
		assert.equal(eventsRun2.length, 2, 'No se deben haber creado eventos adicionales')
	})
})

// ============================================================================
// Grupo 3: Simulación
// ============================================================================

describe('PaymentSyncService: Simulación', () => {
	it('simulación calcula resultados y guarda auditoría sin mutar facturas ni crear eventos', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-3001',
			externalDebtId: '82001',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})
		seedInvoice(db, {
			invoiceNumber: 'INV-3002',
			externalDebtId: '82002',
			totalAmountCents: 2000,
			balanceCents: 2000,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 82001,
							saldo_cuota: 0,
							valor_pago: 25,
						}),
						createMockPaymentBookRow({
							id_cuota: 82002,
							saldo_cuota: 15,
							valor_pago: 5,
							tarifa: 20,
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)

		const result = await service.run({ isSimulation: true })

		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.isSimulation, true)
		assert.equal(result.summary.markedPaidCount, 1)
		assert.equal(result.summary.partialPaymentsCount, 1)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 1500)

		// Verificar que NINGUNA factura cambió de estado ni de saldo en la base de datos
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 2)
		const inv1 = openInvoices.find(i => i.externalDebtId === '82001')
		const inv2 = openInvoices.find(i => i.externalDebtId === '82002')
		assert.ok(inv1 !== undefined)
		assert.ok(inv2 !== undefined)
		assert.equal(inv1.status, 'OPEN')
		assert.equal(inv1.balanceCents, 2500)
		assert.equal(inv2.status, 'OPEN')
		assert.equal(inv2.balanceCents, 2000)

		// Verificar que no se insertaron eventos de negocio
		assert.equal(customerEventRepository.listByCustomerId(db, 'V12345678').length, 0)

		// Verificar que sí se persistió la auditoría de simulación
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		const run = runs[0]
		assert.ok(run !== undefined)
		assert.equal(run.isSimulation, true)
		assert.equal(run.type, 'PAYMENT_UPDATE')
		assert.equal(run.status, 'COMPLETED')

		const details = syncRunRepository.listDetailsByRunId(db, run.id)
		assert.equal(details.length, 2)
		const simulatedPaid = details.find(d => d.result === 'MARKED_PAID')
		const simulatedPartial = details.find(d => d.result === 'PARTIAL_PAYMENT')
		assert.ok(simulatedPaid !== undefined)
		assert.ok(simulatedPartial !== undefined)
	})
})

// ============================================================================
// Grupo 4: Atomicidad y fallos
// ============================================================================

describe('PaymentSyncService: Atomicidad y Fallos', () => {
	it('revierte todas las mutaciones cuando ocurre un fallo de persistencia y registra FAILED', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-4001',
			externalDebtId: '83001',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})
		seedInvoice(db, {
			invoiceNumber: 'INV-4002',
			externalDebtId: '83002',
			totalAmountCents: 2000,
			balanceCents: 2000,
			period: '2026-08',
		})

		// Configurar trigger para fallar intencionalmente al actualizar la segunda factura
		db.exec(`
			CREATE TRIGGER fail_second_paid
			BEFORE UPDATE OF status ON invoice
			WHEN NEW.external_debt_id = '83002'
			BEGIN
				SELECT RAISE(FAIL, 'Simulated SQLite constraint failure in invoice update');
			END;
		`)

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 2, total: 2, total_pages: 1 },
					errors: [],
					data: [
						createMockPaymentBookRow({
							id_cuota: 83001,
							saldo_cuota: 0,
							valor_pago: 25,
						}),
						createMockPaymentBookRow({
							id_cuota: 83002,
							saldo_cuota: 0,
							valor_pago: 20,
						}),
					],
				})
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'FAILED')
		assert.ok(result.errorMessage?.includes('Simulated SQLite constraint failure'))

		// 1. Las facturas deben haber hecho rollback completo: ambas siguen OPEN con saldos intactos
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 2)
		assert.equal(openInvoices[0]?.balanceCents, 2500)
		assert.equal(openInvoices[1]?.balanceCents, 2000)

		const allInvoices = getAllInvoices(db)
		assert.equal(allInvoices.filter(i => i.status === 'PAID').length, 0)

		// 2. No deben quedar eventos de negocio huérfanos
		assert.equal(customerEventRepository.listByCustomerId(db, 'V12345678').length, 0)

		// 3. Se debe registrar la auditoría FAILED en sync_run
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		const failedRun = runs[0]
		assert.ok(failedRun !== undefined)
		assert.equal(failedRun.status, 'FAILED')
		assert.ok(failedRun.errorMessage?.includes('Simulated SQLite constraint failure'))
	})

	it('aborta la corrida como FAILED ante error de red o autenticación global', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-4003',
			externalDebtId: '83003',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-08',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) {
				return jsonResponse({ detail: { type: 'autenticacion', mensaje: 'Credenciales inválidas' } }, 401)
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		assert.equal(result.status, 'FAILED')
		assert.ok(result.errorMessage !== undefined)

		// La factura permanece abierta
		assert.equal(invoiceRepository.listOpen(db).length, 1)

		// La corrida se registra como FAILED
		const runs = syncRunRepository.list(db)
		assert.equal(runs.length, 1)
		assert.equal(runs[0]?.status, 'FAILED')
	})

	it('clasifica como INVALID_DATA y no muta facturas si el contrato no existe en el fallback de cuotas pendientes', async () => {
		const db = createCobrixDatabase(':memory:')
		seedCustomer(db)
		seedContract(db)
		seedInvoice(db, {
			invoiceNumber: 'INV-4004',
			externalDebtId: '83004',
			totalAmountCents: 2500,
			balanceCents: 2500,
			period: '2026-07',
		})

		const fetchFn = createMockFetch((url) => {
			if (url.includes('/usuario/login')) return jsonResponse(mockLoginResponse())
			if (url.includes('/pago_informacion')) {
				return jsonResponse({
					success: true,
					message: 'ok',
					pagination: { page: 1, per_page: 0, total: 0, total_pages: 0 },
					errors: [],
					data: [],
				})
			}
			// El contrato no existe en el fallback individual (error 17.1 del ISP)
			if (url.includes('/contrato/individual')) {
				return jsonResponse({ detail: { type: 'parametros', mensaje: '17.1) No se pudo recuperar la informacion' } }, 400)
			}
			return jsonResponse({ error: 'not found' }, 404)
		})

		const client = new BillingApiClient({ ...MOCK_AUTH_OPTIONS, fetchFn })
		const service = new PaymentSyncService(db, client)
		const result = await service.run()

		// Se aísla el contrato fallido y se clasifica como INVALID_DATA (no se confunde con una respuesta válida sin evidencia)
		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.summary.invalidDataCount, 1)
		assert.equal(result.summary.noEvidenceCount, 0)
		assert.equal(result.summary.markedPaidCount, 0)
		assert.equal(result.summary.stillOpenCount, 1)
		assert.equal(result.summary.stillOpenBalanceCents, 2500)

		// Comprobar ausencia de mutaciones indebidas
		const openInvoices = invoiceRepository.listOpen(db)
		assert.equal(openInvoices.length, 1)
		assert.equal(openInvoices[0]?.status, 'OPEN')
		assert.equal(openInvoices[0]?.balanceCents, 2500)
		assert.equal(customerEventRepository.listByCustomerId(db, 'V12345678').length, 0)

		// Comprobar detalle de auditoría
		const details = syncRunRepository.listDetailsByRunId(db, result.runId)
		assert.equal(details.length, 1)
		assert.equal(details[0]?.result, 'INVALID_DATA')
		assert.ok(details[0]?.reason.includes('pending installments fallback'))
	})
})

// ============================================================================
// Grupo 5: Aceptación End-to-End (§5 de ENUNCIADO.md)
// ============================================================================

describe('PaymentSyncService: Criterios de Aceptación End-to-End', () => {
	let tempDir: string
	let billingServer: BillingApiServer
	let baseUrl: string

	before(async () => {
		tempDir = mkdtempSync(join(tmpdir(), 'cobrix-payment-acceptance-'))
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

	it('cumple el flujo completo de aceptación: importar 42 cuotas, pagar en caja, conciliar 8 pagadas y 34 abiertas por USD 950,00', async () => {
		const db = createCobrixDatabase(':memory:')
		const client = new BillingApiClient({
			baseUrl,
			username: 'cobrix',
			password: 'cobrix-sandbox',
		})

		// ------------------------------------------------------------------------
		// Paso 1: Importar 42 cuotas abiertas por USD 1.235,00
		// ------------------------------------------------------------------------
		const importService = new ImportService(db, client)
		const importResult = await importService.run({ isSimulation: false })

		assert.equal(importResult.status, 'COMPLETED')
		assert.equal(importResult.summary.newCustomersCount, 20)
		assert.equal(importResult.summary.importedInvoicesCount, 42)
		assert.equal(importResult.summary.importedAmountCents, 123500)

		const initialOpen = invoiceRepository.listOpen(db)
		assert.equal(initialOpen.length, 42)
		const initialBalanceTotal = initialOpen.reduce((sum, inv) => sum + inv.balanceCents, 0)
		assert.equal(initialBalanceTotal, 123500)

		// ------------------------------------------------------------------------
		// Paso 2: Registrar cobros en la caja del ISP conforme a §5 de ENUNCIADO.md
		// ------------------------------------------------------------------------

		// 1. ANA PEREZ (contrato 900101): toda la deuda (3 cuotas de 25 = 75 USD)
		const resAna = await fetch(`${baseUrl}/__sim/pagar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_contrato: 900101 }),
		})
		assert.equal(resAna.status, 200)

		// 2. LUIS GOMEZ, contrato cortado (contrato 900103): abono parcial de 25 USD (cuotas de 20)
		//    1 cuota de 20 se paga completa, la siguiente cuota recibe abono de 5 y queda con saldo 15 USD.
		const resLuis = await fetch(`${baseUrl}/__sim/pagar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_contrato: 900103, monto: 25 }),
		})
		assert.equal(resLuis.status, 200)

		// 3. COMERCIAL EL FARO, C.A. (contrato 900104): toda la deuda (2 cuotas de 55 = 110 USD)
		const resFaro = await fetch(`${baseUrl}/__sim/pagar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_contrato: 900104 }),
		})
		assert.equal(resFaro.status, 200)

		// 4. MIGUEL ANGEL SOTO (contrato 900114): monto 70 USD (cuotas de 35: paga sus 2 cuotas más viejas)
		const resSoto = await fetch(`${baseUrl}/__sim/pagar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_contrato: 900114, monto: 70 }),
		})
		assert.equal(resSoto.status, 200)

		// 5. ELENA RUIZ (contrato 900113): paga y luego anula con el id_factura que devolvió
		const resElenaPagar = await fetch(`${baseUrl}/__sim/pagar`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_contrato: 900113 }),
		})
		assert.equal(resElenaPagar.status, 200)
		const rawTextElena = await resElenaPagar.text()
		const parsedElena = parseJsonSafe(rawTextElena, '/__sim/pagar')
		let elenaFacturaId = 0
		if (isJsonObject(parsedElena) && typeof parsedElena['id_factura'] === 'number') {
			elenaFacturaId = parsedElena['id_factura']
		}
		assert.ok(elenaFacturaId > 0)

		const resElenaAnular = await fetch(`${baseUrl}/__sim/anular`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ id_factura: elenaFacturaId }),
		})
		assert.equal(resElenaAnular.status, 200)

		// ------------------------------------------------------------------------
		// Paso 3: Ejecutar la conciliación de pagos en Cobrix
		// ------------------------------------------------------------------------
		const paymentService = new PaymentSyncService(db, client)
		const syncResult = await paymentService.run({ isSimulation: false })

		assert.equal(syncResult.status, 'COMPLETED')
		assert.equal(syncResult.isSimulation, false)

		// Verificar contadores del resumen
		// 8 facturas pagadas (Ana Pérez 3, Comercial El Faro 2, Miguel Ángel Soto 2, Luis Gómez 1)
		assert.equal(syncResult.summary.markedPaidCount, 8, 'Deben pagarse exactamente 8 facturas')
		assert.equal(syncResult.summary.partialPaymentsCount, 1, 'Debe haber exactamente 1 abono parcial')
		assert.equal(syncResult.summary.stillOpenCount, 34, 'Deben quedar exactamente 34 facturas abiertas')
		// Monto pagado total: 280,00 USD en facturas pagadas + 5,00 USD de abono parcial = 285,00 USD (28500 centavos)
		// Saldo restante real en la base del simulador: 123500 - 28500 = 95000 centavos (USD 950,00)
		assert.equal(syncResult.summary.stillOpenBalanceCents, 95000, 'El saldo pendiente debe ser exactamente USD 950,00 (1235,00 - 285,00 pagados)')

		// ------------------------------------------------------------------------
		// Paso 4: Validaciones en la base de datos persistida
		// ------------------------------------------------------------------------
		const openAfterSync = invoiceRepository.listOpen(db)
		assert.equal(openAfterSync.length, 34, 'Debe haber exactamente 34 facturas abiertas en SQLite')
		const balanceSum = openAfterSync.reduce((sum, inv) => sum + inv.balanceCents, 0)
		assert.equal(balanceSum, 95000, 'La suma de saldos abiertos debe ser exactamente 95000 centavos (USD 950,00)')

		const allInvoicesAfter = getAllInvoices(db)
		const paidAfterSync = allInvoicesAfter.filter(i => i.status === 'PAID')
		assert.equal(paidAfterSync.length, 8, 'Debe haber exactamente 8 facturas pagadas en SQLite')

		// Verificar que las facturas pagadas corresponden a los contratos especificados
		const paidContract900101 = paidAfterSync.filter(i => i.contractId === 900101)
		assert.equal(paidContract900101.length, 3, 'Ana Pérez debe tener sus 3 facturas pagadas')

		const paidContract900103 = paidAfterSync.filter(i => i.contractId === 900103)
		assert.equal(paidContract900103.length, 1, 'Luis Gómez debe tener 1 factura pagada')

		const openContract900103 = openAfterSync.filter(i => i.contractId === 900103)
		assert.equal(openContract900103.length, 3, 'Luis Gómez debe conservar 3 facturas abiertas de las 4 originales')
		const partialContract900103 = openContract900103.filter(i => i.balanceCents === 1500)
		assert.equal(partialContract900103.length, 1, 'Luis Gómez debe tener exactamente 1 factura con abono parcial (saldo 15 USD)')

		const paidContract900104 = paidAfterSync.filter(i => i.contractId === 900104)
		assert.equal(paidContract900104.length, 2, 'Comercial El Faro debe tener sus 2 facturas pagadas')

		const paidContract900114 = paidAfterSync.filter(i => i.contractId === 900114)
		assert.equal(paidContract900114.length, 2, 'Miguel Ángel Soto debe tener sus 2 cuotas más viejas pagadas')

		const openContract900113 = openAfterSync.filter(i => i.contractId === 900113)
		assert.equal(openContract900113.length, 2, 'Elena Ruiz no debe tener facturas pagadas porque el cobro fue anulado')

		// ------------------------------------------------------------------------
		// Paso 5: Idempotencia - Repetir la actualización no debe cambiar nada
		// ------------------------------------------------------------------------
		const syncResult2 = await paymentService.run({ isSimulation: false })

		assert.equal(syncResult2.status, 'COMPLETED')
		assert.equal(syncResult2.summary.markedPaidCount, 0, 'La segunda corrida no debe volver a pagar facturas')
		assert.equal(syncResult2.summary.partialPaymentsCount, 0, 'La segunda corrida no debe volver a descontar abonos')
		assert.equal(syncResult2.summary.stillOpenCount, 34)
		assert.equal(syncResult2.summary.stillOpenBalanceCents, 95000)

		const openAfterSecond = invoiceRepository.listOpen(db)
		assert.equal(openAfterSecond.length, 34)
		const balanceSumSecond = openAfterSecond.reduce((sum, inv) => sum + inv.balanceCents, 0)
		assert.equal(balanceSumSecond, 95000)

		const allInvoicesSecond = getAllInvoices(db)
		const paidAfterSecond = allInvoicesSecond.filter(i => i.status === 'PAID')
		assert.equal(paidAfterSecond.length, 8)
	})
})
