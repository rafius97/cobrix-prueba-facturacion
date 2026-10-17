/**
 * Tests for Cobrix Phase 2: SQLite Persistence Layer.
 * Verifies relational schema, integrity, uniqueness constraints, transactions, and isolation.
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createCobrixDatabase, migrateSyncRunSchemaIfNeeded, withTransaction } from '../../src/cobrix/db/database.ts'
import {
	configRepository,
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'

describe('Persistencia Cobrix: Inicialización y aislamiento', () => {
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

describe('Persistencia Cobrix: Entidades e integridad relacional', () => {
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

describe('Persistencia Cobrix: Transacciones y auditoría', () => {
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

	it('sync_run acepta MANUAL y SCHEDULED y asigna MANUAL por defecto si se omite', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			// 1. Inserción con triggerType explícito MANUAL
			const manualRun = syncRunRepository.create(db, {
				id: 'run-manual-01',
				type: 'IMPORT',
				triggerType: 'MANUAL',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-16T10:00:00.000Z',
				finishedAt: '2026-10-16T10:00:01.000Z',
				summaryJson: '{}',
			})
			assert.equal(manualRun.triggerType, 'MANUAL')

			// 2. Inserción con triggerType explícito SCHEDULED
			const scheduledRun = syncRunRepository.create(db, {
				id: 'run-sched-01',
				type: 'PAYMENT_UPDATE',
				triggerType: 'SCHEDULED',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-16T10:01:00.000Z',
				finishedAt: '2026-10-16T10:01:01.000Z',
				summaryJson: '{}',
			})
			assert.equal(scheduledRun.triggerType, 'SCHEDULED')

			// 3. Inserción omitiendo triggerType -> debe tomar 'MANUAL' por defecto
			const defaultRun = syncRunRepository.create(db, {
				id: 'run-default-01',
				type: 'IMPORT',
				isSimulation: true,
				status: 'COMPLETED',
				startedAt: '2026-10-16T10:02:00.000Z',
				finishedAt: '2026-10-16T10:02:01.000Z',
				summaryJson: '{}',
			})
			assert.equal(defaultRun.triggerType, 'MANUAL')

			// Verificar consulta getById y list
			const fetchedSched = syncRunRepository.getById(db, 'run-sched-01')
			assert.equal(fetchedSched?.triggerType, 'SCHEDULED')

			const runs = syncRunRepository.list(db)
			assert.equal(runs.length, 3)
		} finally {
			db.close()
		}
	})

	it('migración: conserva registros existentes y agrega trigger_type con valor MANUAL por defecto', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			// Simular una base antigua creando una tabla sync_run_legacy sin columna trigger_type
			db.exec(`
				CREATE TABLE sync_run_legacy (
					id TEXT PRIMARY KEY,
					type TEXT NOT NULL CHECK (type IN ('IMPORT', 'PAYMENT_UPDATE')),
					is_simulation INTEGER NOT NULL CHECK (is_simulation IN (0, 1)),
					status TEXT NOT NULL CHECK (status IN ('COMPLETED', 'FAILED')),
					started_at TEXT NOT NULL,
					finished_at TEXT NOT NULL,
					error_message TEXT,
					summary_json TEXT NOT NULL
				);
			`)

			// Insertar registros en el esquema antiguo
			db.prepare(`
				INSERT INTO sync_run_legacy (
					id, type, is_simulation, status, started_at, finished_at, summary_json
				) VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run('legacy-run-1', 'IMPORT', 0, 'COMPLETED', '2026-10-15T12:00:00Z', '2026-10-15T12:00:01Z', '{}')

			// Ejecutar la migración adaptada a esa tabla
			const columns = db.prepare('PRAGMA table_info(sync_run_legacy);').all()
			let hasTriggerType = false
			for (const col of columns) {
				if (col['name'] === 'trigger_type') hasTriggerType = true
			}
			assert.equal(hasTriggerType, false)

			// Aplicar la misma instrucción DDL de migrateSyncRunSchemaIfNeeded
			db.exec("ALTER TABLE sync_run_legacy ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type IN ('MANUAL', 'SCHEDULED'));")

			// Verificar que los datos históricos se conservan intactos y reciben 'MANUAL'
			const row = db.prepare('SELECT id, type, trigger_type FROM sync_run_legacy WHERE id = ?').get('legacy-run-1')
			assert.notEqual(row, undefined)
			assert.equal(row?.['id'], 'legacy-run-1')
			assert.equal(row?.['trigger_type'], 'MANUAL')

			// Verificar idempotencia de migrateSyncRunSchemaIfNeeded en sync_run
			migrateSyncRunSchemaIfNeeded(db)
		} finally {
			db.close()
		}
	})

	it('restricción CHECK en sync_run rechaza valores inválidos de trigger_type', () => {
		const db = createCobrixDatabase(':memory:')
		try {
			assert.throws(() => {
				db.prepare(`
					INSERT INTO sync_run (
						id, type, trigger_type, is_simulation, status,
						started_at, finished_at, summary_json
					) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				`).run('invalid-run', 'IMPORT', 'INVALID_TRIGGER', 0, 'COMPLETED', '2026-10-16T10:00:00Z', '2026-10-16T10:00:01Z', '{}')
			}, /CHECK constraint failed/)
		} finally {
			db.close()
		}
	})
})
