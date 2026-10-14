/**
 * Tests for Cobrix Phase 2: SQLite Persistence Layer.
 * Verifies relational schema, integrity, uniqueness constraints, transactions, and isolation.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCobrixDatabase, withTransaction } from '../../src/cobrix/db/database.ts'
import {
	configRepository,
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'

describe('Persistencia Cobrix: Inicialización y aislamiento de la base de datos', () => {
	it('inicializa correctamente una base de datos vacía con configuración por defecto y llaves foráneas', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			// Check foreign keys status
			const fkRow = db.prepare('PRAGMA foreign_keys;').get()
			assert.notEqual(fkRow, undefined)
			const fkEnabled = fkRow?.['foreign_keys']
			assert.equal(fkEnabled, 1)

			// Check default configuration
			const config = configRepository.get(db)
			assert.equal(config.id, 1)
			assert.equal(config.companyName, 'Cobrix Telecom')
			assert.equal(config.apiUsername, 'cobrix')
			assert.equal(config.apiPassword, 'cobrix-sandbox')
			assert.deepEqual(config.importableStatuses, ['ACTIVO', 'CORTADO'])
			assert.equal(config.graceDays, 0)
		} finally {
			db.close()
		}
	})

	it('garantiza aislamiento completo entre bases de datos utilizadas por distintos tests', () => {
		const db1 = createCobrixDatabase(':memory:')
		const db2 = createCobrixDatabase(':memory:')
		try {
			customerRepository.create(db1, {
				id: 'V12345678',
				originalDocument: 'V-12345678',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'ANA PEREZ',
			})

			assert.notEqual(customerRepository.getById(db1, 'V12345678'), null)
			assert.equal(customerRepository.getById(db2, 'V12345678'), null)
		} finally {
			db1.close()
			db2.close()
		}
	})
})

describe('Persistencia Cobrix: Entidades CRUD e integridad relacional', () => {
	it('creación y consulta de clientes, contratos y facturas', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			// Create customer
			const customer = customerRepository.create(db, {
				id: 'V12345678',
				originalDocument: 'V-12345678',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'ANA PEREZ',
				email: 'ana@example.com',
				phone: '04141234567',
			})
			assert.equal(customer.id, 'V12345678')
			assert.equal(customer.name, 'ANA PEREZ')

			// Create contract
			const contract = contractRepository.upsert(db, {
				id: 900101,
				customerId: customer.id,
				code: 'CTR-001',
				status: 'ACTIVO',
				plan: 'PLAN15MB25',
				planPriceCents: 2500, // $25.00
				branch: 'CCS',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			assert.equal(contract.id, 900101)
			assert.equal(contract.customerId, 'V12345678')

			// Create invoice
			const invoice = invoiceRepository.create(db, {
				invoiceNumber: 'CBX-000001',
				externalDebtId: '7000008',
				contractId: contract.id,
				customerId: customer.id,
				period: '2026-08',
				dueDate: '2026-08-01',
				cutDate: '2026-08-01',
				totalAmountCents: 2000, // $20.00
				balanceCents: 2000,
			})
			assert.equal(invoice.invoiceNumber, 'CBX-000001')
			assert.equal(invoice.externalDebtId, '7000008')
			assert.equal(invoice.status, 'OPEN')
			assert.equal(invoice.balanceCents, 2000)

			// Retrieve and check lists
			const openInvoices = invoiceRepository.listOpen(db)
			assert.equal(openInvoices.length, 1)
			assert.equal(openInvoices[0]?.invoiceNumber, 'CBX-000001')

			// Mark paid
			const paid = invoiceRepository.markAsPaid(db, '7000008', {
				paidAt: '2026-10-13',
				ispPaymentInvoice: '008800007',
			})
			assert.equal(paid.status, 'PAID')
			assert.equal(paid.balanceCents, 0)
			assert.equal(paid.ispPaymentInvoice, '008800007')

			const openAfter = invoiceRepository.listOpen(db)
			assert.equal(openAfter.length, 0)
		} finally {
			db.close()
		}
	})

	it('restricciones de unicidad para evitar facturas duplicadas (external_debt_id e invoice_number)', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			customerRepository.create(db, {
				id: 'V12345678',
				originalDocument: 'V-12345678',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'ANA PEREZ',
			})
			contractRepository.upsert(db, {
				id: 900101,
				customerId: 'V12345678',
				code: 'CTR-001',
				status: 'ACTIVO',
				plan: 'PLAN15MB25',
				planPriceCents: 2500,
				branch: 'CCS',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})

			// Insert first invoice
			invoiceRepository.create(db, {
				invoiceNumber: 'CBX-000001',
				externalDebtId: '7000008',
				contractId: 900101,
				customerId: 'V12345678',
				period: '2026-08',
				dueDate: '2026-08-01',
				cutDate: '2026-08-01',
				totalAmountCents: 2000,
				balanceCents: 2000,
			})

			// Attempt duplicate externalDebtId -> must throw SQLite constraint error
			assert.throws(() => {
				invoiceRepository.create(db, {
					invoiceNumber: 'CBX-000002',
					externalDebtId: '7000008', // DUPLICATE EXTERNAL ID
					contractId: 900101,
					customerId: 'V12345678',
					period: '2026-08',
					dueDate: '2026-08-01',
					cutDate: '2026-08-01',
					totalAmountCents: 2000,
					balanceCents: 2000,
				})
			}, /UNIQUE constraint failed: invoice\.external_debt_id/)

			// Attempt duplicate invoiceNumber -> must throw SQLite constraint error
			assert.throws(() => {
				invoiceRepository.create(db, {
					invoiceNumber: 'CBX-000001', // DUPLICATE NUMBER
					externalDebtId: '7000009',
					contractId: 900101,
					customerId: 'V12345678',
					period: '2026-09',
					dueDate: '2026-09-01',
					cutDate: '2026-09-01',
					totalAmountCents: 2500,
					balanceCents: 2500,
				})
			}, /UNIQUE constraint failed: invoice\.invoice_number/)
		} finally {
			db.close()
		}
	})

	it('integridad de claves foráneas rechaza relaciones con registros inexistentes', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			// Contract referencing non-existent customer -> must fail
			assert.throws(() => {
				contractRepository.upsert(db, {
					id: 999999,
					customerId: 'NO_EXISTE',
					code: 'CTR-X',
					status: 'ACTIVO',
					plan: 'PLAN',
					planPriceCents: 1000,
					branch: 'CCS',
					currency: 'USD',
					billingDay: 1,
					cutoffDay: 1,
				})
			}, /FOREIGN KEY constraint failed/)

			// Invoice referencing non-existent contract -> must fail
			customerRepository.create(db, {
				id: 'V12345678',
				originalDocument: 'V-12345678',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'ANA PEREZ',
			})

			assert.throws(() => {
				invoiceRepository.create(db, {
					invoiceNumber: 'CBX-000001',
					externalDebtId: '7000008',
					contractId: 999999, // NON EXISTENT CONTRACT
					customerId: 'V12345678',
					period: '2026-08',
					dueDate: '2026-08-01',
					cutDate: '2026-08-01',
					totalAmountCents: 2000,
					balanceCents: 2000,
				})
			}, /FOREIGN KEY constraint failed/)
		} finally {
			db.close()
		}
	})
})

describe('Persistencia Cobrix: Transacciones y registros de auditoría', () => {
	it('rollback revierte los cambios cuando una operación transaccional falla', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			assert.throws(() => {
				withTransaction(db, () => {
					customerRepository.create(db, {
						id: 'V12345678',
						originalDocument: 'V-12345678',
						documentType: 'V',
						personType: 'NATURAL',
						name: 'ANA PEREZ',
					})
					// Force an error inside the transaction
					throw new Error('Fallo intencional para verificar rollback')
				})
			}, /Fallo intencional para verificar rollback/)

			// Customer must NOT exist because transaction was rolled back
			const customer = customerRepository.getById(db, 'V12345678')
			assert.equal(customer, null)
		} finally {
			db.close()
		}
	})

	it('persistencia y consulta de corridas de sincronización con detalles de cuotas', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			const run = syncRunRepository.create(db, {
				id: 'run-001',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-13T10:00:00.000Z',
				finishedAt: '2026-10-13T10:00:02.000Z',
				summaryJson: JSON.stringify({ imported: 42, total: 42 }),
			})
			assert.equal(run.id, 'run-001')
			assert.equal(run.type, 'IMPORT')
			assert.equal(run.isSimulation, false)

			syncRunRepository.addDetails(db, [
				{
					runId: 'run-001',
					contractId: 900101,
					debtId: '7000008',
					period: '2026-08',
					amountCents: 2000,
					result: 'IMPORTED',
					reason: 'Pending installment meeting criteria',
				},
				{
					runId: 'run-001',
					contractId: 900105,
					debtId: '7000015',
					period: '2026-08',
					amountCents: 2000,
					result: 'EXCLUDED_STATUS',
					reason: 'Contract status CORTESIA not importable',
				},
			])

			const details = syncRunRepository.listDetailsByRunId(db, 'run-001')
			assert.equal(details.length, 2)
			assert.equal(details[0]?.result, 'IMPORTED')
			assert.equal(details[1]?.result, 'EXCLUDED_STATUS')
		} finally {
			db.close()
		}
	})

	it('persistencia de historial de cliente sin almacenar tokens ni contraseñas', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			customerRepository.create(db, {
				id: 'V12345678',
				originalDocument: 'V-12345678',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'ANA PEREZ',
			})

			customerEventRepository.create(db, {
				customerId: 'V12345678',
				eventType: 'CUSTOMER_CREATED',
				description: 'Customer imported from invoice manager',
				metadataJson: JSON.stringify({ origin: 'ISP', initialContract: 900101 }),
			})

			const events = customerEventRepository.listByCustomerId(db, 'V12345678')
			assert.equal(events.length, 1)
			assert.equal(events[0]?.eventType, 'CUSTOMER_CREATED')
			assert.doesNotMatch(events[0]?.metadataJson ?? '', /password|token/i)
		} finally {
			db.close()
		}
	})
})
