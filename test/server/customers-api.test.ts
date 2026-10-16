/**
 * Pruebas de integración HTTP para el directorio y expediente de clientes.
 * Valida los endpoints GET /api/customers y GET /api/customers/:id.
 * Escrito en TypeScript estricto sin `any`, sin `unknown` y sin aserciones inseguras.
 */

import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import { after, before, describe, it } from 'node:test'

import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
} from '../../src/cobrix/db/repositories.ts'
import { createServerApp } from '../../src/server/server-app.ts'
import type {
	ApiErrorResponseDto,
	ContractItemDto,
	CustomerDetailDto,
	CustomerDossierResponseDto,
	CustomerEventItemDto,
	CustomerListItemDto,
	CustomerListResponseDto,
	CustomerMetricsDto,
	InvoiceItemDto,
} from '../../src/shared/api-types.ts'

// ============================================================================
// Tipos seguros y validadores sin `any` ni `unknown`
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

function parseCustomerListItem(val: JsonValue): CustomerListItemDto {
	if (!isJsonObject(val)) throw new Error('CustomerListItem must be an object')
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

function parseCustomerListResponse(json: JsonObject): CustomerListResponseDto {
	const rawList = Array.isArray(json.customers) ? json.customers : []
	const customers: CustomerListItemDto[] = rawList.map(item => parseCustomerListItem(item))
	return {
		totalCount: typeof json.totalCount === 'number' ? json.totalCount : 0,
		customers,
	}
}

function parseCustomerDetail(val: JsonValue): CustomerDetailDto {
	if (!isJsonObject(val)) throw new Error('customer must be an object')
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

function parseCustomerMetrics(val: JsonValue): CustomerMetricsDto {
	if (!isJsonObject(val)) throw new Error('metrics must be an object')
	return {
		totalContractsCount: typeof val.totalContractsCount === 'number' ? val.totalContractsCount : 0,
		openInvoicesCount: typeof val.openInvoicesCount === 'number' ? val.openInvoicesCount : 0,
		paidInvoicesCount: typeof val.paidInvoicesCount === 'number' ? val.paidInvoicesCount : 0,
		openBalanceCents: typeof val.openBalanceCents === 'number' ? val.openBalanceCents : 0,
		oldestOpenDueDate: typeof val.oldestOpenDueDate === 'string' ? val.oldestOpenDueDate : null,
	}
}

function parseContractItem(val: JsonValue): ContractItemDto {
	if (!isJsonObject(val)) throw new Error('contract item must be an object')
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
	if (!isJsonObject(val)) throw new Error('invoice item must be an object')
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
	if (!isJsonObject(val)) throw new Error('event item must be an object')
	const eventType =
		val.eventType === 'INVOICE_IMPORTED' ||
		val.eventType === 'INVOICE_PAID' ||
		val.eventType === 'PARTIAL_PAYMENT'
			? val.eventType
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

function parseCustomerDossier(json: JsonObject): CustomerDossierResponseDto {
	const customerVal = json.customer ?? null
	const metricsVal = json.metrics ?? null
	const rawContracts = Array.isArray(json.contracts) ? json.contracts : []
	const rawInvoices = Array.isArray(json.invoices) ? json.invoices : []
	const rawEvents = Array.isArray(json.events) ? json.events : []

	return {
		customer: parseCustomerDetail(customerVal),
		metrics: parseCustomerMetrics(metricsVal),
		contracts: rawContracts.map(parseContractItem),
		invoices: rawInvoices.map(parseInvoiceItem),
		events: rawEvents.map(parseCustomerEventItem),
	}
}

function parseApiErrorResponse(json: JsonObject): ApiErrorResponseDto {
	return {
		error: typeof json.error === 'string' ? json.error : '',
		statusCode: typeof json.statusCode === 'number' ? json.statusCode : 0,
		path: typeof json.path === 'string' ? json.path : '',
	}
}

// ============================================================================
// Suite de Pruebas
// ============================================================================

describe('API REST: Directorio y expediente de clientes (/api/customers)', () => {
	let server: Server
	let baseUrl: string

	before(async () => {
		const db = createCobrixDatabase(':memory:')

		// Sembrado de Cliente 1: Ana Pérez (múltiples contratos, facturas abiertas y pagadas, eventos)
		customerRepository.create(db, {
			id: 'CLI-A',
			originalDocument: 'V-12.345.678',
			documentType: 'V',
			personType: 'NATURAL',
			name: 'Ana Pérez',
			phone: '04141234567',
			email: 'ana@example.com',
			address: 'Av. Libertador, Caracas',
		})

		contractRepository.upsert(db, {
			id: 101,
			customerId: 'CLI-A',
			code: 'CON-101',
			status: 'ACTIVO',
			plan: 'Plan Residencial 50M',
			planPriceCents: 2500,
			branch: 'Caracas Este',
			currency: 'USD',
			billingDay: 5,
			cutoffDay: 20,
		})

		contractRepository.upsert(db, {
			id: 102,
			customerId: 'CLI-A',
			code: 'CON-102',
			status: 'CORTADO',
			plan: 'Plan Oficina 100M',
			planPriceCents: 5000,
			branch: 'Caracas Centro',
			currency: 'USD',
			billingDay: 10,
			cutoffDay: 25,
		})

		invoiceRepository.create(db, {
			invoiceNumber: 'FAC-001',
			externalDebtId: 'DEBT-001',
			contractId: 101,
			customerId: 'CLI-A',
			period: '2026-07',
			dueDate: '2026-07-01',
			cutDate: '2026-07-06',
			totalAmountCents: 2500,
			balanceCents: 2500,
			status: 'OPEN',
		})

		invoiceRepository.create(db, {
			invoiceNumber: 'FAC-002',
			externalDebtId: 'DEBT-002',
			contractId: 102,
			customerId: 'CLI-A',
			period: '2026-08',
			dueDate: '2026-08-01',
			cutDate: '2026-08-11',
			totalAmountCents: 5000,
			balanceCents: 5000,
			status: 'OPEN',
		})

		invoiceRepository.create(db, {
			invoiceNumber: 'FAC-003',
			externalDebtId: 'DEBT-003',
			contractId: 101,
			customerId: 'CLI-A',
			period: '2026-06',
			dueDate: '2026-06-01',
			cutDate: '2026-06-06',
			totalAmountCents: 2500,
			balanceCents: 0,
			status: 'PAID',
		})

		invoiceRepository.markAsPaid(db, 'DEBT-003', {
			paidAt: '2026-06-15T12:00:00Z',
			ispPaymentInvoice: 'ISP-REC-01',
		})

		customerEventRepository.create(db, {
			customerId: 'CLI-A',
			eventType: 'CUSTOMER_CREATED',
			description: 'Titular registrado en importación inicial',
		})

		customerEventRepository.create(db, {
			customerId: 'CLI-A',
			eventType: 'INVOICE_IMPORTED',
			description: 'Factura FAC-001 importada de deuda DEBT-001',
			metadataJson: JSON.stringify({ invoiceNumber: 'FAC-001' }),
		})

		customerEventRepository.create(db, {
			customerId: 'CLI-A',
			eventType: 'INVOICE_PAID',
			description: 'Factura FAC-003 pagada en ISP',
			metadataJson: JSON.stringify({ ispPaymentInvoice: 'ISP-REC-01' }),
		})

		// Sembrado de Cliente 2: Corporación Beta (persona jurídica con factura saldada)
		customerRepository.create(db, {
			id: 'CLI-B',
			originalDocument: 'J-30000000-0',
			documentType: 'J',
			personType: 'JURIDICA',
			name: 'Corporación Beta, C.A.',
			phone: '02129998877',
			email: 'contacto@beta.com',
			address: 'Torre Empresarial, Valencia',
		})

		contractRepository.upsert(db, {
			id: 201,
			customerId: 'CLI-B',
			code: 'CON-201',
			status: 'ACTIVO',
			plan: 'Plan Fibra Corporativo',
			planPriceCents: 12000,
			branch: 'Valencia',
			currency: 'USD',
			billingDay: 1,
			cutoffDay: 15,
		})

		invoiceRepository.create(db, {
			invoiceNumber: 'FAC-004',
			externalDebtId: 'DEBT-004',
			contractId: 201,
			customerId: 'CLI-B',
			period: '2026-08',
			dueDate: '2026-08-01',
			cutDate: '2026-08-06',
			totalAmountCents: 12000,
			balanceCents: 0,
			status: 'PAID',
		})

		invoiceRepository.markAsPaid(db, 'DEBT-004', {
			paidAt: '2026-08-10T09:00:00Z',
			ispPaymentInvoice: 'ISP-REC-02',
		})

		// Sembrado de Cliente 3: Elena Ruiz (sin contratos ni facturas)
		customerRepository.create(db, {
			id: '9000123',
			originalDocument: '09000123',
			documentType: null,
			personType: 'NATURAL',
			name: 'Elena Ruiz',
			phone: '',
			email: 'elena@ruiz.com',
			address: 'Barquisimeto',
		})

		server = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/ENUNCIADO.md',
			db,
		})

		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0
		baseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		await new Promise(resolve => server.close(resolve))
	})

	it('GET /api/customers devuelve el directorio completo ordenado por nombre con métricas consolidadas', async () => {
		const res = await fetch(`${baseUrl}/api/customers`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 3)
		assert.equal(data.customers.length, 3)

		// 1. Ana Pérez
		const ana = data.customers[0]
		assert.ok(ana !== undefined)
		if (ana !== undefined) {
			assert.equal(ana.customerId, 'CLI-A')
			assert.equal(ana.originalDocument, 'V-12.345.678')
			assert.equal(ana.documentType, 'V')
			assert.equal(ana.personType, 'NATURAL')
			assert.equal(ana.name, 'Ana Pérez')
			assert.equal(ana.totalContractsCount, 2)
			assert.equal(ana.openInvoicesCount, 2)
			assert.equal(ana.paidInvoicesCount, 1)
			assert.equal(ana.openBalanceCents, 7500)
			assert.equal(ana.oldestOpenDueDate, '2026-07-01')
		}

		// 2. Corporación Beta
		const beta = data.customers[1]
		assert.ok(beta !== undefined)
		if (beta !== undefined) {
			assert.equal(beta.customerId, 'CLI-B')
			assert.equal(beta.originalDocument, 'J-30000000-0')
			assert.equal(beta.documentType, 'J')
			assert.equal(beta.personType, 'JURIDICA')
			assert.equal(beta.name, 'Corporación Beta, C.A.')
			assert.equal(beta.totalContractsCount, 1)
			assert.equal(beta.openInvoicesCount, 0)
			assert.equal(beta.paidInvoicesCount, 1)
			assert.equal(beta.openBalanceCents, 0)
			assert.equal(beta.oldestOpenDueDate, null)
		}

		// 3. Elena Ruiz
		const elena = data.customers[2]
		assert.ok(elena !== undefined)
		if (elena !== undefined) {
			assert.equal(elena.customerId, '9000123')
			assert.equal(elena.originalDocument, '09000123')
			assert.equal(elena.documentType, null)
			assert.equal(elena.personType, 'NATURAL')
			assert.equal(elena.name, 'Elena Ruiz')
			assert.equal(elena.totalContractsCount, 0)
			assert.equal(elena.openInvoicesCount, 0)
			assert.equal(elena.paidInvoicesCount, 0)
			assert.equal(elena.openBalanceCents, 0)
			assert.equal(elena.oldestOpenDueDate, null)
		}
	})

	it('GET /api/customers?search=... filtra por nombre insensible a mayúsculas', async () => {
		const res = await fetch(`${baseUrl}/api/customers?search=beta`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 1)
		assert.equal(data.customers.length, 1)
		const first = data.customers[0]
		assert.ok(first !== undefined)
		if (first !== undefined) {
			assert.equal(first.name, 'Corporación Beta, C.A.')
			assert.equal(first.customerId, 'CLI-B')
		}
	})

	it('GET /api/customers?search=... filtra por documento original', async () => {
		const res = await fetch(`${baseUrl}/api/customers?search=12.345.678`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 1)
		assert.equal(data.customers.length, 1)
		const first = data.customers[0]
		assert.ok(first !== undefined)
		if (first !== undefined) {
			assert.equal(first.customerId, 'CLI-A')
			assert.equal(first.name, 'Ana Pérez')
		}
	})

	it('GET /api/customers?search=... filtra por identificador normalizado', async () => {
		const res = await fetch(`${baseUrl}/api/customers?search=9000123`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 1)
		assert.equal(data.customers.length, 1)
		const first = data.customers[0]
		assert.ok(first !== undefined)
		if (first !== undefined) {
			assert.equal(first.customerId, '9000123')
			assert.equal(first.name, 'Elena Ruiz')
		}
	})

	it('GET /api/customers?search=... devuelve lista vacía cuando no hay coincidencias', async () => {
		const res = await fetch(`${baseUrl}/api/customers?search=no_existe_ninguno`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 0)
		assert.equal(data.customers.length, 0)
	})

	it('POST /api/customers rechaza métodos no permitidos con código 405', async () => {
		const res = await fetch(`${baseUrl}/api/customers`, { method: 'POST', body: '{}' })
		assert.equal(res.status, 405)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))
		const errorDto = parseApiErrorResponse(json)
		assert.equal(errorDto.statusCode, 405)
		assert.equal(errorDto.error, 'Method Not Allowed')
	})

	it('GET /api/customers/:id devuelve el expediente completo de un cliente existente', async () => {
		const res = await fetch(`${baseUrl}/api/customers/CLI-A`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const dossier = parseCustomerDossier(json)

		// Titular y contacto
		assert.equal(dossier.customer.id, 'CLI-A')
		assert.equal(dossier.customer.name, 'Ana Pérez')
		assert.equal(dossier.customer.originalDocument, 'V-12.345.678')
		assert.equal(dossier.customer.documentType, 'V')
		assert.equal(dossier.customer.personType, 'NATURAL')
		assert.equal(dossier.customer.phone, '04141234567')
		assert.equal(dossier.customer.email, 'ana@example.com')
		assert.equal(dossier.customer.address, 'Av. Libertador, Caracas')

		// Métricas consolidadas
		assert.equal(dossier.metrics.totalContractsCount, 2)
		assert.equal(dossier.metrics.openInvoicesCount, 2)
		assert.equal(dossier.metrics.paidInvoicesCount, 1)
		assert.equal(dossier.metrics.openBalanceCents, 7500)
		assert.equal(dossier.metrics.oldestOpenDueDate, '2026-07-01')

		// Contratos asociados
		assert.equal(dossier.contracts.length, 2)
		const c1 = dossier.contracts[0]
		const c2 = dossier.contracts[1]
		assert.ok(c1 !== undefined && c2 !== undefined)
		if (c1 !== undefined && c2 !== undefined) {
			assert.equal(c1.id, 101)
			assert.equal(c1.code, 'CON-101')
			assert.equal(c1.status, 'ACTIVO')
			assert.equal(c1.plan, 'Plan Residencial 50M')
			assert.equal(c1.planPriceCents, 2500)
			assert.equal(c1.currency, 'USD')

			assert.equal(c2.id, 102)
			assert.equal(c2.code, 'CON-102')
			assert.equal(c2.status, 'CORTADO')
			assert.equal(c2.planPriceCents, 5000)
		}

		// Facturas asociadas
		assert.equal(dossier.invoices.length, 3)
		const f1 = dossier.invoices.find(inv => inv.externalDebtId === 'DEBT-001')
		const f2 = dossier.invoices.find(inv => inv.externalDebtId === 'DEBT-002')
		const f3 = dossier.invoices.find(inv => inv.externalDebtId === 'DEBT-003')

		assert.ok(f1 !== undefined && f2 !== undefined && f3 !== undefined)
		if (f1 !== undefined && f2 !== undefined && f3 !== undefined) {
			assert.equal(f1.status, 'OPEN')
			assert.equal(f1.balanceCents, 2500)
			assert.equal(f1.paidAt, null)

			assert.equal(f2.status, 'OPEN')
			assert.equal(f2.balanceCents, 5000)

			assert.equal(f3.status, 'PAID')
			assert.equal(f3.balanceCents, 0)
			assert.equal(f3.paidAt, '2026-06-15T12:00:00Z')
			assert.equal(f3.ispPaymentInvoice, 'ISP-REC-01')
		}

		// Eventos de auditoría
		assert.equal(dossier.events.length, 3)
		assert.equal(dossier.events[0]?.eventType, 'CUSTOMER_CREATED')
		assert.equal(dossier.events[1]?.eventType, 'INVOICE_IMPORTED')
		assert.equal(dossier.events[2]?.eventType, 'INVOICE_PAID')

		// Ausencia de secretos en la respuesta
		const dossierObj: object = dossier
		assert.ok(!('apiPassword' in dossierObj))
	})

	it('GET /api/customers/:id responde 404 estructurado cuando el cliente no existe', async () => {
		const res = await fetch(`${baseUrl}/api/customers/INEXISTENTE_999`)
		assert.equal(res.status, 404)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const errorDto = parseApiErrorResponse(json)
		assert.equal(errorDto.statusCode, 404)
		assert.match(errorDto.error, /not found/i)
		assert.equal(errorDto.path, '/api/customers/INEXISTENTE_999')
	})

	it('PUT /api/customers/:id rechaza métodos no permitidos con código 405', async () => {
		const res = await fetch(`${baseUrl}/api/customers/CLI-A`, { method: 'PUT', body: '{}' })
		assert.equal(res.status, 405)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const errorDto = parseApiErrorResponse(json)
		assert.equal(errorDto.statusCode, 405)
		assert.equal(errorDto.error, 'Method Not Allowed')
	})
})

describe('API REST: Directorio con base de datos sin clientes', () => {
	let emptyServer: Server
	let emptyBaseUrl: string

	before(async () => {
		const emptyDb = createCobrixDatabase(':memory:')

		emptyServer = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: '/tmp/ENUNCIADO.md',
			db: emptyDb,
		})

		await new Promise<void>(resolve => emptyServer.listen(0, '127.0.0.1', resolve))
		const address = emptyServer.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0
		emptyBaseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		await new Promise(resolve => emptyServer.close(resolve))
	})

	it('GET /api/customers devuelve totalCount 0 y arreglo vacío cuando no hay clientes', async () => {
		const res = await fetch(`${emptyBaseUrl}/api/customers`)
		assert.equal(res.status, 200)

		const rawText = await res.text()
		const json = parseJsonText(rawText)
		assert.ok(isJsonObject(json))

		const data = parseCustomerListResponse(json)
		assert.equal(data.totalCount, 0)
		assert.equal(data.customers.length, 0)
	})
})
