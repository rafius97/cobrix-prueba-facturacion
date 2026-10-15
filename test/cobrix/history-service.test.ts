/**
 * Pruebas unitarias y de integración para HistoryService y consultas de métricas agregadas.
 * Fase 6.2: Historial tipado, métricas globales y métricas por cliente en SQLite.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import assert from 'node:assert/strict'
import type { DatabaseSync } from 'node:sqlite'
import { beforeEach, describe, it } from 'node:test'

import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	contractRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import { HistoryService } from '../../src/cobrix/history/history-service.ts'
import { HistoryParseError } from '../../src/cobrix/history/parsers.ts'
import type {
	ImportRunSummary,
	PaymentSyncSummary,
	TypedImportSyncRun,
	TypedPaymentSyncRun,
} from '../../src/cobrix/history/types.ts'

// ============================================================================
// Fixtures auxiliares para pruebas
// ============================================================================

const sampleImportSummary: ImportRunSummary = {
	runId: 'run-imp-001',
	isSimulation: false,
	startedAt: '2026-10-14T08:00:00.000Z',
	finishedAt: '2026-10-14T08:00:03.000Z',
	durationMs: 3000,
	totalContractsInspected: 10,
	totalInstallmentsEvaluated: 12,
	importedInvoicesCount: 8,
	importedAmountCents: 16000,
	newCustomersCount: 4,
	alreadyImportedCount: 2,
	excludedByStatusCount: 1,
	excludedByDocumentTypeCount: 0,
	outOfWindowCount: 1,
	excludedByMaxInstallmentsCount: 0,
	limitReachedCount: 0,
	inconsistentCurrencyCount: 0,
	residualBalanceCount: 0,
	noDebtCount: 0,
	invalidIdentificationCount: 0,
	invalidDataCount: 0,
}

const samplePaymentSummary: PaymentSyncSummary = {
	runId: 'run-pay-001',
	isSimulation: true,
	startedAt: '2026-10-14T09:00:00.000Z',
	finishedAt: '2026-10-14T09:00:02.000Z',
	durationMs: 2000,
	totalInvoicesInspected: 8,
	totalContractsInspected: 5,
	markedPaidCount: 5,
	markedPaidAmountCents: 10000,
	partialPaymentsCount: 1,
	partialPaymentsAmountCents: 1500,
	stillOpenCount: 2,
	stillOpenBalanceCents: 4500,
	exemptionCount: 0,
	noEvidenceCount: 0,
	contradictoryDataCount: 0,
	invalidDataCount: 0,
}

// ============================================================================
// Suite de pruebas de HistoryService
// ============================================================================

describe('Fase 6.2 — HistoryService y Métricas Agregadas', () => {
	let db: DatabaseSync
	let service: HistoryService

	beforeEach(() => {
		db = createCobrixDatabase(':memory:')
		service = new HistoryService(db)
	})

	describe('Historial tipado de sincronizaciones', () => {
		it('lista corridas de sincronización ordenadas descendentemente por started_at', () => {
			syncRunRepository.create(db, {
				id: 'run-1',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T10:00:00.000Z',
				finishedAt: '2026-10-14T10:00:05.000Z',
				summaryJson: JSON.stringify({ ...sampleImportSummary, runId: 'run-1' }),
			})

			syncRunRepository.create(db, {
				id: 'run-2',
				type: 'PAYMENT_UPDATE',
				isSimulation: true,
				status: 'COMPLETED',
				startedAt: '2026-10-14T12:00:00.000Z',
				finishedAt: '2026-10-14T12:00:02.000Z',
				summaryJson: JSON.stringify({ ...samplePaymentSummary, runId: 'run-2' }),
			})

			syncRunRepository.create(db, {
				id: 'run-3',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T11:00:00.000Z',
				finishedAt: '2026-10-14T11:00:04.000Z',
				summaryJson: JSON.stringify({ ...sampleImportSummary, runId: 'run-3' }),
			})

			const allRuns = service.listRuns()
			assert.strictEqual(allRuns.length, 3)
			assert.strictEqual(allRuns[0]?.id, 'run-2') // 12:00
			assert.strictEqual(allRuns[1]?.id, 'run-3') // 11:00
			assert.strictEqual(allRuns[2]?.id, 'run-1') // 10:00

			// Respetar parámetro limit
			const limited = service.listRuns(2)
			assert.strictEqual(limited.length, 2)
			assert.strictEqual(limited[0]?.id, 'run-2')
			assert.strictEqual(limited[1]?.id, 'run-3')
		})

		it('distingue correctamente corridas IMPORT y PAYMENT_UPDATE devolviendo summaries tipados', () => {
			syncRunRepository.create(db, {
				id: 'run-import',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:03.000Z',
				summaryJson: JSON.stringify(sampleImportSummary),
			})

			syncRunRepository.create(db, {
				id: 'run-payment',
				type: 'PAYMENT_UPDATE',
				isSimulation: true,
				status: 'COMPLETED',
				startedAt: '2026-10-14T09:00:00.000Z',
				finishedAt: '2026-10-14T09:00:02.000Z',
				summaryJson: JSON.stringify(samplePaymentSummary),
			})

			const importRun = service.getRunById('run-import')
			assert.notStrictEqual(importRun, null)
			if (importRun !== null) {
				assert.strictEqual(importRun.type, 'IMPORT')
				assert.strictEqual(importRun.isSimulation, false)
				assert.strictEqual(importRun.summary.importedInvoicesCount, 8)
				assert.strictEqual(importRun.summary.totalInstallmentsEvaluated, 12)

				// Verificación de type narrowing
				const isImport = (r: typeof importRun): r is TypedImportSyncRun => r.type === 'IMPORT'
				assert.strictEqual(isImport(importRun), true)
			}

			const paymentRun = service.getRunById('run-payment')
			assert.notStrictEqual(paymentRun, null)
			if (paymentRun !== null) {
				assert.strictEqual(paymentRun.type, 'PAYMENT_UPDATE')
				assert.strictEqual(paymentRun.isSimulation, true)
				assert.strictEqual(paymentRun.summary.markedPaidCount, 5)
				assert.strictEqual(paymentRun.summary.stillOpenBalanceCents, 4500)

				// Verificación de type narrowing
				const isPayment = (r: typeof paymentRun): r is TypedPaymentSyncRun => r.type === 'PAYMENT_UPDATE'
				assert.strictEqual(isPayment(paymentRun), true)
			}
		})

		it('distingue correctamente corridas en modo simulación de ejecuciones reales', () => {
			syncRunRepository.create(db, {
				id: 'run-sim',
				type: 'IMPORT',
				isSimulation: true,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:02.000Z',
				summaryJson: JSON.stringify({ ...sampleImportSummary, isSimulation: true, runId: 'run-sim' }),
			})

			syncRunRepository.create(db, {
				id: 'run-real',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:30:00.000Z',
				finishedAt: '2026-10-14T08:30:03.000Z',
				summaryJson: JSON.stringify({ ...sampleImportSummary, isSimulation: false, runId: 'run-real' }),
			})

			const simRun = service.getRunById('run-sim')
			assert.strictEqual(simRun?.isSimulation, true)
			assert.strictEqual(simRun?.summary.isSimulation, true)

			const realRun = service.getRunById('run-real')
			assert.strictEqual(realRun?.isSimulation, false)
			assert.strictEqual(realRun?.summary.isSimulation, false)
		})

		it('devuelve null cuando la corrida solicitada no existe', () => {
			const run = service.getRunById('inexistent-run')
			assert.strictEqual(run, null)
		})

		it('lanza HistoryParseError si una corrida en base de datos contiene summary_json corrupto o inválido', () => {
			syncRunRepository.create(db, {
				id: 'run-corrupt',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:02.000Z',
				summaryJson: '{ invalid json syntax',
			})

			assert.throws(
				() => service.getRunById('run-corrupt'),
				(error: Error) => {
					assert.ok(error instanceof HistoryParseError)
					assert.ok(error.message.includes('not valid JSON'))
					return true
				},
			)

			assert.throws(
				() => service.listRuns(),
				(error: Error) => {
					assert.ok(error instanceof HistoryParseError)
					return true
				},
			)
		})

		it('obtiene los detalles asociados a una corrida de sincronización', () => {
			syncRunRepository.create(db, {
				id: 'run-with-details',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:02.000Z',
				summaryJson: JSON.stringify(sampleImportSummary),
			})

			syncRunRepository.addDetails(db, [
				{
					runId: 'run-with-details',
					contractId: 101,
					debtId: 'D-001',
					period: '2026-08',
					amountCents: 2000,
					result: 'IMPORTED',
					reason: 'Factura importada exitosamente',
				},
				{
					runId: 'run-with-details',
					contractId: 102,
					debtId: 'D-002',
					period: '2026-08',
					amountCents: 3500,
					result: 'ALREADY_IMPORTED',
					reason: 'Ya existe en la base de datos',
				},
			])

			const details = service.listRunDetails('run-with-details')
			assert.strictEqual(details.length, 2)
			assert.strictEqual(details[0]?.contractId, 101)
			assert.strictEqual(details[0]?.result, 'IMPORTED')
			assert.strictEqual(details[0]?.amountCents, 2000)
			assert.strictEqual(details[1]?.contractId, 102)
			assert.strictEqual(details[1]?.result, 'ALREADY_IMPORTED')
		})

		it('devuelve un arreglo vacío cuando la corrida existe pero no tiene detalles registrados', () => {
			syncRunRepository.create(db, {
				id: 'run-empty-details',
				type: 'PAYMENT_UPDATE',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:02.000Z',
				summaryJson: JSON.stringify(samplePaymentSummary),
			})

			const details = service.listRunDetails('run-empty-details')
			assert.deepStrictEqual(details, [])
		})
	})

	describe('Métricas globales del sistema', () => {
		it('calcula métricas en cero y fecha nula cuando la base de datos está vacía', () => {
			const metrics = service.getGlobalMetrics()

			assert.strictEqual(metrics.totalCustomersCount, 0)
			assert.strictEqual(metrics.totalContractsCount, 0)
			assert.strictEqual(metrics.openInvoicesCount, 0)
			assert.strictEqual(metrics.paidInvoicesCount, 0)
			assert.strictEqual(metrics.totalOpenBalanceCents, 0)
			assert.strictEqual(metrics.oldestOpenDueDate, null)
			assert.strictEqual(metrics.recentRuns.length, 0)
		})

		it('calcula correctamente todas las métricas globales con datos controlados', () => {
			// 1. Crear clientes
			customerRepository.create(db, {
				id: 'V100',
				originalDocument: 'V-100',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'Cliente Uno',
			})
			customerRepository.create(db, {
				id: 'V200',
				originalDocument: 'V-200',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'Cliente Dos',
			})
			customerRepository.create(db, {
				id: 'J300',
				originalDocument: 'J-300',
				documentType: 'J',
				personType: 'JURIDICA',
				name: 'Empresa Tres',
			})

			// 2. Crear contratos
			contractRepository.upsert(db, {
				id: 101,
				customerId: 'V100',
				code: 'CTR-101',
				status: 'ACTIVO',
				plan: 'Plan Básico',
				planPriceCents: 2000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			contractRepository.upsert(db, {
				id: 102,
				customerId: 'V100',
				code: 'CTR-102',
				status: 'ACTIVO',
				plan: 'Plan Turbo',
				planPriceCents: 4000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			contractRepository.upsert(db, {
				id: 201,
				customerId: 'V200',
				code: 'CTR-201',
				status: 'ACTIVO',
				plan: 'Plan Básico',
				planPriceCents: 2000,
				branch: 'Valencia',
				currency: 'USD',
				billingDay: 5,
				cutoffDay: 20,
			})
			contractRepository.upsert(db, {
				id: 301,
				customerId: 'J300',
				code: 'CTR-301',
				status: 'ACTIVO',
				plan: 'Plan Corporativo',
				planPriceCents: 10000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})

			// 3. Crear facturas con diferentes estados y fechas de vencimiento
			// Factura 1: OPEN, balance 1.000 centavos, vencimiento 2026-08-01
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-001',
				externalDebtId: 'D-001',
				contractId: 101,
				customerId: 'V100',
				period: '2026-08',
				dueDate: '2026-08-01',
				cutDate: '2026-08-15',
				totalAmountCents: 1000,
				balanceCents: 1000,
				status: 'OPEN',
			})

			// Factura 2: OPEN, balance 2.500 centavos, vencimiento 2026-06-01 (¡Más antigua de las abiertas!)
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-002',
				externalDebtId: 'D-002',
				contractId: 102,
				customerId: 'V100',
				period: '2026-06',
				dueDate: '2026-06-01',
				cutDate: '2026-06-15',
				totalAmountCents: 2500,
				balanceCents: 2500,
				status: 'OPEN',
			})

			// Factura 3: OPEN, balance 1.500 centavos, vencimiento 2026-07-01
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-003',
				externalDebtId: 'D-003',
				contractId: 201,
				customerId: 'V200',
				period: '2026-07',
				dueDate: '2026-07-01',
				cutDate: '2026-07-20',
				totalAmountCents: 1500,
				balanceCents: 1500,
				status: 'OPEN',
			})

			// Factura 4: PAID, balance 0 centavos, vencimiento 2026-04-01 (anterior a 2026-06-01, pero pagada!)
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-004',
				externalDebtId: 'D-004',
				contractId: 301,
				customerId: 'J300',
				period: '2026-04',
				dueDate: '2026-04-01',
				cutDate: '2026-04-15',
				totalAmountCents: 2000,
				balanceCents: 0,
				status: 'PAID',
			})

			// Factura 5: PAID, balance 0 centavos, vencimiento 2026-05-01
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-005',
				externalDebtId: 'D-005',
				contractId: 301,
				customerId: 'J300',
				period: '2026-05',
				dueDate: '2026-05-01',
				cutDate: '2026-05-15',
				totalAmountCents: 3000,
				balanceCents: 0,
				status: 'PAID',
			})

			// 4. Crear corrida de sincronización
			syncRunRepository.create(db, {
				id: 'run-recent',
				type: 'IMPORT',
				isSimulation: false,
				status: 'COMPLETED',
				startedAt: '2026-10-14T08:00:00.000Z',
				finishedAt: '2026-10-14T08:00:03.000Z',
				summaryJson: JSON.stringify(sampleImportSummary),
			})

			const metrics = service.getGlobalMetrics(5)

			assert.strictEqual(metrics.totalCustomersCount, 3)
			assert.strictEqual(metrics.totalContractsCount, 4)
			assert.strictEqual(metrics.openInvoicesCount, 3)
			assert.strictEqual(metrics.paidInvoicesCount, 2)
			// Total balance abierto: 1.000 + 2.500 + 1.500 = 5.000 centavos
			assert.strictEqual(metrics.totalOpenBalanceCents, 5000)
			// La fecha de vencimiento más antigua entre las abiertas es 2026-06-01 (no 2026-04-01 que está pagada)
			assert.strictEqual(metrics.oldestOpenDueDate, '2026-06-01')
			assert.strictEqual(metrics.recentRuns.length, 1)
			assert.strictEqual(metrics.recentRuns[0]?.id, 'run-recent')
		})
	})

	describe('Métricas agregadas por cliente', () => {
		it('calcula correctamente la agrupación por cliente con contratos, deudas abiertas y pagadas', () => {
			// Cliente A: 2 contratos, 2 facturas abiertas por 3.500 centavos, 1 pagada
			customerRepository.create(db, {
				id: 'CLI-A',
				originalDocument: 'V-11111',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'Ana Pérez',
			})
			contractRepository.upsert(db, {
				id: 11,
				customerId: 'CLI-A',
				code: 'CTR-11',
				status: 'ACTIVO',
				plan: 'Plan A',
				planPriceCents: 2000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			contractRepository.upsert(db, {
				id: 12,
				customerId: 'CLI-A',
				code: 'CTR-12',
				status: 'ACTIVO',
				plan: 'Plan B',
				planPriceCents: 3000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-A1',
				externalDebtId: 'D-A1',
				contractId: 11,
				customerId: 'CLI-A',
				period: '2026-07',
				dueDate: '2026-07-01',
				cutDate: '2026-07-15',
				totalAmountCents: 2000,
				balanceCents: 2000,
				status: 'OPEN',
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-A2',
				externalDebtId: 'D-A2',
				contractId: 12,
				customerId: 'CLI-A',
				period: '2026-08',
				dueDate: '2026-08-01',
				cutDate: '2026-08-15',
				totalAmountCents: 1500,
				balanceCents: 1500,
				status: 'OPEN',
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-A3',
				externalDebtId: 'D-A3',
				contractId: 11,
				customerId: 'CLI-A',
				period: '2026-06',
				dueDate: '2026-06-01',
				cutDate: '2026-06-15',
				totalAmountCents: 2000,
				balanceCents: 0,
				status: 'PAID',
			})

			// Cliente B: 1 contrato, 0 abiertas, 2 pagadas
			customerRepository.create(db, {
				id: 'CLI-B',
				originalDocument: 'V-22222',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'Bernardo Gómez',
			})
			contractRepository.upsert(db, {
				id: 21,
				customerId: 'CLI-B',
				code: 'CTR-21',
				status: 'ACTIVO',
				plan: 'Plan C',
				planPriceCents: 5000,
				branch: 'Valencia',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-B1',
				externalDebtId: 'D-B1',
				contractId: 21,
				customerId: 'CLI-B',
				period: '2026-06',
				dueDate: '2026-06-01',
				cutDate: '2026-06-15',
				totalAmountCents: 5000,
				balanceCents: 0,
				status: 'PAID',
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-B2',
				externalDebtId: 'D-B2',
				contractId: 21,
				customerId: 'CLI-B',
				period: '2026-07',
				dueDate: '2026-07-01',
				cutDate: '2026-07-15',
				totalAmountCents: 5000,
				balanceCents: 0,
				status: 'PAID',
			})

			// Cliente C: Sin contratos ni facturas
			customerRepository.create(db, {
				id: 'CLI-C',
				originalDocument: 'J-33333',
				documentType: 'J',
				personType: 'JURIDICA',
				name: 'Comercializadora Zeta',
			})

			const customerMetricsList = service.listCustomerMetrics()
			assert.strictEqual(customerMetricsList.length, 3)

			// Verificar Cliente A (Ana Pérez)
			const aMetrics = customerMetricsList.find(c => c.customerId === 'CLI-A')
			assert.notStrictEqual(aMetrics, undefined)
			if (aMetrics !== undefined) {
				assert.strictEqual(aMetrics.name, 'Ana Pérez')
				assert.strictEqual(aMetrics.totalContractsCount, 2)
				assert.strictEqual(aMetrics.openInvoicesCount, 2)
				assert.strictEqual(aMetrics.paidInvoicesCount, 1)
				assert.strictEqual(aMetrics.openBalanceCents, 3500)
				assert.strictEqual(aMetrics.oldestOpenDueDate, '2026-07-01')
			}

			// Verificar Cliente B (Bernardo Gómez)
			const bMetrics = customerMetricsList.find(c => c.customerId === 'CLI-B')
			assert.notStrictEqual(bMetrics, undefined)
			if (bMetrics !== undefined) {
				assert.strictEqual(bMetrics.name, 'Bernardo Gómez')
				assert.strictEqual(bMetrics.totalContractsCount, 1)
				assert.strictEqual(bMetrics.openInvoicesCount, 0)
				assert.strictEqual(bMetrics.paidInvoicesCount, 2)
				assert.strictEqual(bMetrics.openBalanceCents, 0)
				assert.strictEqual(bMetrics.oldestOpenDueDate, null)
			}

			// Verificar Cliente C (Comercializadora Zeta: sin contratos ni facturas)
			const cMetrics = customerMetricsList.find(c => c.customerId === 'CLI-C')
			assert.notStrictEqual(cMetrics, undefined)
			if (cMetrics !== undefined) {
				assert.strictEqual(cMetrics.name, 'Comercializadora Zeta')
				assert.strictEqual(cMetrics.totalContractsCount, 0)
				assert.strictEqual(cMetrics.openInvoicesCount, 0)
				assert.strictEqual(cMetrics.paidInvoicesCount, 0)
				assert.strictEqual(cMetrics.openBalanceCents, 0)
				assert.strictEqual(cMetrics.oldestOpenDueDate, null)
			}
		})

		it('obtiene métricas de un cliente individual por ID y devuelve null si no existe', () => {
			customerRepository.create(db, {
				id: 'CLI-SOLO',
				originalDocument: 'V-999',
				documentType: 'V',
				personType: 'NATURAL',
				name: 'Cliente Solitario',
			})
			contractRepository.upsert(db, {
				id: 99,
				customerId: 'CLI-SOLO',
				code: 'CTR-99',
				status: 'ACTIVO',
				plan: 'Plan Unico',
				planPriceCents: 1000,
				branch: 'Caracas',
				currency: 'USD',
				billingDay: 1,
				cutoffDay: 15,
			})
			invoiceRepository.create(db, {
				invoiceNumber: 'INV-99',
				externalDebtId: 'D-99',
				contractId: 99,
				customerId: 'CLI-SOLO',
				period: '2026-08',
				dueDate: '2026-08-01',
				cutDate: '2026-08-15',
				totalAmountCents: 1000,
				balanceCents: 1000,
				status: 'OPEN',
			})

			const metrics = service.getCustomerMetricsById('CLI-SOLO')
			assert.notStrictEqual(metrics, null)
			if (metrics !== null) {
				assert.strictEqual(metrics.customerId, 'CLI-SOLO')
				assert.strictEqual(metrics.name, 'Cliente Solitario')
				assert.strictEqual(metrics.totalContractsCount, 1)
				assert.strictEqual(metrics.openInvoicesCount, 1)
				assert.strictEqual(metrics.paidInvoicesCount, 0)
				assert.strictEqual(metrics.openBalanceCents, 1000)
				assert.strictEqual(metrics.oldestOpenDueDate, '2026-08-01')
			}

			const notFound = service.getCustomerMetricsById('CLI-NO-EXISTE')
			assert.strictEqual(notFound, null)
		})
	})
})
