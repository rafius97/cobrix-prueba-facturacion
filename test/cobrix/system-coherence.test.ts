/**
 * Sistema Cobrix: Coherencia integral del ciclo de vida.
 * Valida la coherencia de punta a punta entre importación, simulación,
 * sincronización de pagos, idempotencia, auditoría, historial y métricas agregadas.
 *
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 * Títulos y descripciones de pruebas en español.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { after, before, describe, it } from 'node:test'

import { seedBillingApi } from '../../src/billing-api/seed.ts'
import { createBillingApiServer, type BillingApiServer } from '../../src/billing-api/server.ts'
import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import { isJsonObject, parseJsonSafe } from '../../src/cobrix/client/validators.ts'
import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import {
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import type { Invoice } from '../../src/cobrix/db/types.ts'
import { HistoryService } from '../../src/cobrix/history/history-service.ts'
import { ImportService } from '../../src/cobrix/sync/import-service.ts'
import { PaymentSyncService } from '../../src/cobrix/sync/payment-sync-service.ts'

// ============================================================================
// Funciones auxiliares estrictamente tipadas para consultas SQL independientes
// ============================================================================

function parseSqlInteger(val: SQLOutputValue): number {
	if (typeof val === 'number') return Math.trunc(val)
	if (typeof val === 'bigint') return Number(val)
	throw new Error(`Se esperaba un número o bigint en el resultado SQL, recibido: ${typeof val}`)
}

function parseSqlNullableString(val: SQLOutputValue): string | null {
	if (val === null || val === undefined) return null
	if (typeof val === 'string') return val
	throw new Error(`Se esperaba una cadena o null en el resultado SQL, recibido: ${typeof val}`)
}

function getColumnValue(row: Record<string, SQLOutputValue>, column: string): SQLOutputValue {
	const val = row[column]
	if (val === undefined) {
		throw new Error(`Columna "${column}" no encontrada en la fila de resultado SQL`)
	}
	return val
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
// Suite de pruebas integrales de coherencia
// ============================================================================

describe('Sistema Cobrix: Coherencia integral del ciclo de vida', () => {
	let tempDir: string | undefined
	let billingServer: BillingApiServer | undefined
	let baseUrl: string = ''
	let previousSandboxToday: string | undefined

	before(async () => {
		// Aislar SANDBOX_TODAY de forma reversible para no alterar el entorno global del runner
		previousSandboxToday = process.env.SANDBOX_TODAY
		process.env.SANDBOX_TODAY = '2026-10-13'

		tempDir = mkdtempSync(join(tmpdir(), 'cobrix-system-coherence-'))
		const dbPath = join(tempDir, 'billing-api.sqlite')
		seedBillingApi(dbPath)
		const server = createBillingApiServer(dbPath)
		billingServer = server
		const port = await server.listen(0)
		baseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		try {
			// Cierre seguro del servidor solo si fue instanciado exitosamente
			if (billingServer !== undefined) {
				await billingServer.close()
			}
		} finally {
			try {
				// Eliminación segura del directorio temporal si fue creado
				if (tempDir !== undefined) {
					rmSync(tempDir, { recursive: true, force: true })
				}
			} finally {
				// Restauración garantizada de SANDBOX_TODAY a su valor previo
				if (previousSandboxToday === undefined) {
					delete process.env.SANDBOX_TODAY
				} else {
					process.env.SANDBOX_TODAY = previousSandboxToday
				}
			}
		}
	})

	it('valida la coherencia integral del ciclo completo de vida del sistema', async () => {
		const db = createCobrixDatabase(':memory:')

		try {
			const client = new BillingApiClient({
				baseUrl,
				username: 'cobrix',
				password: 'cobrix-sandbox',
			})
			const importService = new ImportService(db, client)
			const paymentService = new PaymentSyncService(db, client)
			const historyService = new HistoryService(db)

			// ====================================================================
			// 0. Estado inicial: base de datos Cobrix limpia
			// ====================================================================
			assert.equal(customerRepository.count(db), 0, 'No debe haber clientes iniciales')
			assert.equal(contractRepository.count(db), 0, 'No debe haber contratos iniciales')
			assert.equal(invoiceRepository.listOpen(db).length, 0, 'No debe haber facturas abiertas iniciales')
			assert.equal(syncRunRepository.list(db).length, 0, 'No debe haber corridas iniciales')

			const initialSqlRow = db.prepare(`
				SELECT
					(SELECT COUNT(*) FROM customer) AS initial_customers,
					(SELECT COUNT(*) FROM contract) AS initial_contracts,
					(SELECT COUNT(*) FROM invoice) AS initial_invoices,
					(SELECT COUNT(*) FROM customer_event) AS initial_events,
					(SELECT COUNT(*) FROM sync_run) AS initial_runs
			`).get()
			assert.ok(initialSqlRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(initialSqlRow, 'initial_customers')), 0)
			assert.equal(parseSqlInteger(getColumnValue(initialSqlRow, 'initial_contracts')), 0)
			assert.equal(parseSqlInteger(getColumnValue(initialSqlRow, 'initial_invoices')), 0)
			assert.equal(parseSqlInteger(getColumnValue(initialSqlRow, 'initial_events')), 0)
			assert.equal(parseSqlInteger(getColumnValue(initialSqlRow, 'initial_runs')), 0)

			const initialMetrics = historyService.getGlobalMetrics(10)
			assert.equal(initialMetrics.totalCustomersCount, 0)
			assert.equal(initialMetrics.totalContractsCount, 0)
			assert.equal(initialMetrics.openInvoicesCount, 0)
			assert.equal(initialMetrics.paidInvoicesCount, 0)
			assert.equal(initialMetrics.totalOpenBalanceCents, 0)
			assert.equal(initialMetrics.oldestOpenDueDate, null)
			assert.equal(initialMetrics.recentRuns.length, 0)

			// ====================================================================
			// 1. Simulación de importación
			// ====================================================================
			const simImportResult = await importService.run({ isSimulation: true })

			assert.equal(simImportResult.status, 'COMPLETED')
			assert.equal(simImportResult.isSimulation, true)
			assert.equal(simImportResult.summary.importedInvoicesCount, 42, 'La simulación debe proyectar 42 facturas')
			assert.equal(simImportResult.summary.newCustomersCount, 20, 'La simulación debe proyectar 20 clientes')
			assert.equal(simImportResult.summary.importedAmountCents, 123500, 'La simulación debe proyectar 123.500 centavos')
			const simImportedDetails = simImportResult.details.filter(d => d.result === 'IMPORTED')
			assert.equal(simImportedDetails.length, 42, 'Deben evaluarse 42 cuotas con resultado IMPORTED')
			assert.equal(simImportResult.details.length, simImportResult.summary.totalInstallmentsEvaluated)

			// Invariante de negocio: entidades no modificadas durante simulación
			assert.equal(customerRepository.count(db), 0, 'La simulación no debe crear clientes')
			assert.equal(contractRepository.count(db), 0, 'La simulación no debe crear contratos')
			assert.equal(invoiceRepository.listOpen(db).length, 0, 'La simulación no debe crear facturas')

			const simImportSqlRow = db.prepare(`
				SELECT
					(SELECT COUNT(*) FROM customer_event) AS events_after_sim,
					(SELECT COUNT(*) FROM sync_run) AS runs_after_sim,
					(SELECT COUNT(*) FROM sync_run_detail) AS details_after_sim
			`).get()
			assert.ok(simImportSqlRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(simImportSqlRow, 'events_after_sim')), 0, 'La simulación no debe crear eventos de negocio')
			assert.equal(parseSqlInteger(getColumnValue(simImportSqlRow, 'runs_after_sim')), 1, 'Debe registrarse 1 corrida de simulación')
			assert.equal(parseSqlInteger(getColumnValue(simImportSqlRow, 'details_after_sim')), simImportResult.details.length, 'Deben registrarse todos los detalles evaluados en sync_run_detail')

			const simTypedRun = historyService.getRunById(simImportResult.runId)
			assert.ok(simTypedRun !== null)
			assert.equal(simTypedRun.type, 'IMPORT')
			assert.equal(simTypedRun.isSimulation, true)
			assert.equal(simTypedRun.status, 'COMPLETED')
			assert.equal(simTypedRun.summary.importedInvoicesCount, 42)
			assert.equal(simTypedRun.summary.importedAmountCents, 123500)
			assert.equal(simTypedRun.summary.newCustomersCount, 20)

			// ====================================================================
			// 2. Importación real
			// ====================================================================
			const realImportResult = await importService.run({ isSimulation: false })

			assert.equal(realImportResult.status, 'COMPLETED')
			assert.equal(realImportResult.isSimulation, false)
			assert.equal(realImportResult.summary.importedInvoicesCount, 42)
			assert.equal(realImportResult.summary.newCustomersCount, 20)
			assert.equal(realImportResult.summary.importedAmountCents, 123500)

			// Invariantes en base de datos: 20 clientes, 21 contratos (Luis Gómez posee 2 contratos), 42 facturas abiertas, 123.500 centavos
			assert.equal(customerRepository.count(db), 20, 'Deben persistirse exactamente 20 clientes')
			assert.equal(contractRepository.count(db), 21, 'Deben persistirse exactamente 21 contratos (Luis Gómez posee 2 contratos)')
			const openInvoicesAfterImport = invoiceRepository.listOpen(db)
			assert.equal(openInvoicesAfterImport.length, 42, 'Deben persistirse exactamente 42 facturas abiertas')

			const openBalanceAfterImport = openInvoicesAfterImport.reduce((acc, inv) => acc + inv.balanceCents, 0)
			assert.equal(openBalanceAfterImport, 123500, 'El saldo abierto total debe ser exactamente 123.500 centavos (USD 1.235,00)')

			// Relaciones entre clientes, contratos y facturas
			for (const invoice of openInvoicesAfterImport) {
				assert.equal(invoice.status, 'OPEN')
				assert.equal(invoice.paidAt, null)
				assert.equal(invoice.ispPaymentInvoice, null)
				assert.equal(invoice.balanceCents, invoice.totalAmountCents)

				const contract = contractRepository.getById(db, invoice.contractId)
				assert.ok(contract !== null, `El contrato ${invoice.contractId} debe existir en Cobrix`)
				assert.equal(invoice.customerId, contract.customerId, 'El customerId de la factura debe coincidir con el del contrato')

				const customer = customerRepository.getById(db, invoice.customerId)
				assert.ok(customer !== null, `El cliente ${invoice.customerId} debe existir en Cobrix`)
			}

			// Auditoría: 20 eventos CUSTOMER_CREATED + 42 eventos INVOICE_IMPORTED = 62 eventos
			const eventsSqlRow = db.prepare(`
				SELECT
					COUNT(*) AS total_events,
					COUNT(CASE WHEN event_type = 'CUSTOMER_CREATED' THEN 1 END) AS customer_created_events,
					COUNT(CASE WHEN event_type = 'INVOICE_IMPORTED' THEN 1 END) AS invoice_imported_events
				FROM customer_event
			`).get()
			assert.ok(eventsSqlRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(eventsSqlRow, 'total_events')), 62)
			assert.equal(parseSqlInteger(getColumnValue(eventsSqlRow, 'customer_created_events')), 20)
			assert.equal(parseSqlInteger(getColumnValue(eventsSqlRow, 'invoice_imported_events')), 42)

			// Métricas globales tras importación real
			const metricsAfterImport = historyService.getGlobalMetrics(10)
			assert.equal(metricsAfterImport.totalCustomersCount, 20)
			assert.equal(metricsAfterImport.totalContractsCount, 21)
			assert.equal(metricsAfterImport.openInvoicesCount, 42)
			assert.equal(metricsAfterImport.paidInvoicesCount, 0)
			assert.equal(metricsAfterImport.totalOpenBalanceCents, 123500)
			assert.equal(metricsAfterImport.oldestOpenDueDate, openInvoicesAfterImport[0]?.dueDate)
			assert.equal(metricsAfterImport.recentRuns.length, 2, 'Debe haber 2 corridas en el historial (simulación e importación)')

			// ====================================================================
			// 3. Registro de cobros en la caja del ISP simulado
			// ====================================================================

			// 1. ANA PEREZ (contrato 900101): toda la deuda (3 cuotas: 1 de 20 USD por abono de 5 USD en semilla + 2 de 25 USD = 70 USD)
			const resAna = await fetch(`${baseUrl}/__sim/pagar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_contrato: 900101 }),
			})
			assert.equal(resAna.status, 200, 'El pago de Ana Pérez debe responder 200')

			// 2. LUIS GOMEZ (contrato 900103): abono parcial de 25 USD (cuotas de 20 USD: 1 de 20 USD pagada + 5 USD abonados)
			const resLuis = await fetch(`${baseUrl}/__sim/pagar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_contrato: 900103, monto: 25 }),
			})
			assert.equal(resLuis.status, 200, 'El pago de Luis Gómez debe responder 200')

			// 3. COMERCIAL EL FARO, C.A. (contrato 900104): toda la deuda (2 cuotas de 60 USD = 120 USD, plan EMPRESA50MB)
			const resFaro = await fetch(`${baseUrl}/__sim/pagar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_contrato: 900104 }),
			})
			assert.equal(resFaro.status, 200, 'El pago de Comercial El Faro debe responder 200')

			// 4. MIGUEL ANGEL SOTO (contrato 900114): monto 70 USD (2 cuotas de 35 USD)
			const resSoto = await fetch(`${baseUrl}/__sim/pagar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_contrato: 900114, monto: 70 }),
			})
			assert.equal(resSoto.status, 200, 'El pago de Miguel Ángel Soto debe responder 200')

			// 5. ELENA RUIZ (contrato 900113): pagar y luego anular
			const resElenaPagar = await fetch(`${baseUrl}/__sim/pagar`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_contrato: 900113 }),
			})
			assert.equal(resElenaPagar.status, 200, 'El pago de Elena Ruiz debe responder 200')
			const rawTextElena = await resElenaPagar.text()
			const parsedElena = parseJsonSafe(rawTextElena, '/__sim/pagar')
			let elenaFacturaId = 0
			if (isJsonObject(parsedElena)) {
				const idVal = parsedElena['id_factura']
				if (typeof idVal === 'number') {
					elenaFacturaId = idVal
				}
			}
			assert.ok(elenaFacturaId > 0, 'El cobro de Elena Ruiz debe retornar un id_factura numérico')

			const resElenaAnular = await fetch(`${baseUrl}/__sim/anular`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id_factura: elenaFacturaId }),
			})
			assert.equal(resElenaAnular.status, 200, 'La anulación del cobro de Elena Ruiz debe responder 200')

			// Invariante: las operaciones del simulador ISP no alteran las entidades de Cobrix antes de sincronizar
			assert.equal(invoiceRepository.listOpen(db).length, 42)
			assert.equal(syncRunRepository.list(db).length, 2, 'Las operaciones en el ISP no generan corridas en Cobrix')

			// ====================================================================
			// 4. Simulación de sincronización de pagos
			// ====================================================================
			const simPaymentResult = await paymentService.run({ isSimulation: true })

			assert.equal(simPaymentResult.status, 'COMPLETED')
			assert.equal(simPaymentResult.isSimulation, true)
			assert.equal(simPaymentResult.summary.markedPaidCount, 8, 'La simulación debe proyectar 8 facturas pagadas')
			assert.equal(simPaymentResult.summary.partialPaymentsCount, 1, 'La simulación debe proyectar 1 abono parcial')
			assert.equal(simPaymentResult.summary.stillOpenCount, 34, 'La simulación debe proyectar 34 facturas abiertas')
			assert.equal(simPaymentResult.summary.stillOpenBalanceCents, 95000, 'La simulación debe proyectar saldo de 95.000 centavos')

			// Invariante: ninguna factura cambia su estado ni saldo en Cobrix durante la simulación
			const openInvoicesAfterSimPay = invoiceRepository.listOpen(db)
			assert.equal(openInvoicesAfterSimPay.length, 42, 'Las 42 facturas deben seguir abiertas en base de datos')
			const openBalanceAfterSimPay = openInvoicesAfterSimPay.reduce((acc, inv) => acc + inv.balanceCents, 0)
			assert.equal(openBalanceAfterSimPay, 123500, 'El saldo abierto total debe permanecer intacto en 123.500 centavos')

			const allInvoicesAfterSimPay = getAllInvoices(db)
			const paidInvoicesAfterSimPay = allInvoicesAfterSimPay.filter(i => i.status === 'PAID')
			assert.equal(paidInvoicesAfterSimPay.length, 0, 'No debe haber facturas pagadas en base de datos tras la simulación')

			for (const inv of allInvoicesAfterSimPay) {
				assert.equal(inv.paidAt, null)
				assert.equal(inv.ispPaymentInvoice, null)
			}

			// Invariante: no se crean eventos de negocio durante la simulación de pagos
			const eventsAfterSimPayRow = db.prepare('SELECT COUNT(*) AS count FROM customer_event').get()
			assert.ok(eventsAfterSimPayRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterSimPayRow, 'count')), 62, 'Los eventos de auditoría no deben aumentar con la simulación')

			// Registro operativo: la simulación sí registra su corrida en sync_run
			assert.equal(syncRunRepository.list(db).length, 3, 'Debe haber 3 corridas registradas en Cobrix')
			const simPaymentTypedRun = historyService.getRunById(simPaymentResult.runId)
			assert.ok(simPaymentTypedRun !== null)
			assert.equal(simPaymentTypedRun.type, 'PAYMENT_UPDATE')
			assert.equal(simPaymentTypedRun.isSimulation, true)
			assert.equal(simPaymentTypedRun.status, 'COMPLETED')
			assert.equal(simPaymentTypedRun.summary.markedPaidCount, 8)
			assert.equal(simPaymentTypedRun.summary.stillOpenBalanceCents, 95000)

			// ====================================================================
			// 5. Sincronización real de pagos
			// ====================================================================
			const realPaymentResult = await paymentService.run({ isSimulation: false })

			assert.equal(realPaymentResult.status, 'COMPLETED')
			assert.equal(realPaymentResult.isSimulation, false)
			assert.equal(realPaymentResult.summary.markedPaidCount, 8)
			assert.equal(realPaymentResult.summary.partialPaymentsCount, 1)
			assert.equal(realPaymentResult.summary.stillOpenCount, 34)
			assert.equal(realPaymentResult.summary.stillOpenBalanceCents, 95000)

			// Invariantes en base de datos: 8 pagadas, 34 abiertas, saldo 95.000 centavos
			const allInvoicesAfterRealPay = getAllInvoices(db)
			const paidInvoicesAfterRealPay = allInvoicesAfterRealPay.filter(i => i.status === 'PAID')
			assert.equal(paidInvoicesAfterRealPay.length, 8, 'Debe haber exactamente 8 facturas pagadas')

			for (const paidInv of paidInvoicesAfterRealPay) {
				assert.equal(paidInv.balanceCents, 0, 'Toda factura pagada debe tener saldo 0')
				assert.ok(paidInv.paidAt !== null, 'Toda factura pagada debe registrar fecha de pago')
				assert.ok(paidInv.ispPaymentInvoice !== null, 'Toda factura pagada debe registrar referencia de pago')
			}

			const openInvoicesAfterRealPay = invoiceRepository.listOpen(db)
			assert.equal(openInvoicesAfterRealPay.length, 34, 'Debe haber exactamente 34 facturas abiertas')
			const openBalanceAfterRealPay = openInvoicesAfterRealPay.reduce((acc, inv) => acc + inv.balanceCents, 0)
			assert.equal(openBalanceAfterRealPay, 95000, 'El saldo abierto total debe ser exactamente 95.000 centavos (USD 950,00)')

			// Verificación de contratos específicos de pago y desglose aritmético exacto:
			// - Ana Pérez (contrato 900101): sus 3 facturas pagadas (2.000 + 2.500 + 2.500 = 7.000 centavos / 70 USD)
			const anaPaid = paidInvoicesAfterRealPay.filter(i => i.contractId === 900101)
			assert.equal(anaPaid.length, 3)
			const anaPaidTotalCents = anaPaid.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
			assert.equal(anaPaidTotalCents, 7000, 'Las 3 facturas pagadas de Ana Pérez deben sumar 7.000 centavos (USD 70,00)')

			// - Comercial El Faro (contrato 900104, plan EMPRESA50MB de 60 USD): sus 2 facturas pagadas (6.000 + 6.000 = 12.000 centavos / 120 USD)
			const faroPaid = paidInvoicesAfterRealPay.filter(i => i.contractId === 900104)
			assert.equal(faroPaid.length, 2)
			const faroPaidTotalCents = faroPaid.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
			assert.equal(faroPaidTotalCents, 12000, 'Las 2 facturas pagadas de Comercial El Faro deben sumar 12.000 centavos (USD 120,00)')

			// - Miguel Ángel Soto (contrato 900114, plan PLAN30MB35 de 35 USD): 2 facturas pagadas de 8 (3.500 + 3.500 = 7.000 centavos / 70 USD)
			const sotoPaid = paidInvoicesAfterRealPay.filter(i => i.contractId === 900114)
			assert.equal(sotoPaid.length, 2)
			const sotoPaidTotalCents = sotoPaid.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
			assert.equal(sotoPaidTotalCents, 7000, 'Las 2 facturas pagadas de Miguel Ángel Soto deben sumar 7.000 centavos (USD 70,00)')

			// - Luis Gómez (contrato 900103, plan PLAN3MB20 de 20 USD): 1 factura pagada de 20 USD, 3 abiertas, 1 con abono de 5 USD (saldo 15 USD / 1.500 centavos)
			const luisPaid = paidInvoicesAfterRealPay.filter(i => i.contractId === 900103)
			assert.equal(luisPaid.length, 1)
			const luisPaidInvoice = luisPaid[0]
			assert.ok(luisPaidInvoice !== undefined)
			assert.equal(luisPaidInvoice.totalAmountCents, 2000, 'La factura pagada de Luis Gómez debe ser de 2.000 centavos (USD 20,00)')

			const luisOpen = openInvoicesAfterRealPay.filter(i => i.contractId === 900103)
			assert.equal(luisOpen.length, 3)
			const luisPartial = luisOpen.filter(i => i.balanceCents === 1500)
			assert.equal(luisPartial.length, 1, 'Luis Gómez debe tener exactamente 1 factura con saldo de 1.500 centavos tras el abono parcial')
			const luisPartialInvoice = luisPartial[0]
			assert.ok(luisPartialInvoice !== undefined)
			assert.equal(luisPartialInvoice.totalAmountCents, 2000, 'La cuota abonada de Luis Gómez tenía un importe original de 2.000 centavos (USD 20,00)')
			const luisAbonoAmountCents = luisPartialInvoice.totalAmountCents - luisPartialInvoice.balanceCents
			assert.equal(luisAbonoAmountCents, 500, 'El abono aplicado a la factura de Luis Gómez debe ser de exactamente 500 centavos (USD 5,00)')

			// Reconciliación aritmética de la reducción de deuda:
			// Facturas pagadas (280 USD): Ana (70 USD) + El Faro (120 USD) + Soto (70 USD) + Luis (20 USD) = 28.000 centavos
			const totalPaidInvoicesAmountCents = paidInvoicesAfterRealPay.reduce((sum, inv) => sum + inv.totalAmountCents, 0)
			assert.equal(totalPaidInvoicesAmountCents, 28000, 'El importe total de las 8 facturas pagadas debe ser 28.000 centavos (USD 280,00)')
			// Reducción total de deuda: 28.000 centavos (facturas completas) + 500 centavos (abono parcial) = 28.500 centavos (USD 285,00)
			const totalDebtReductionCents = totalPaidInvoicesAmountCents + luisAbonoAmountCents
			assert.equal(totalDebtReductionCents, 28500, 'La reducción total de deuda debe ser 28.500 centavos (USD 285,00)')
			assert.equal(openBalanceAfterImport - totalDebtReductionCents, 95000, 'Saldo inicial (123.500) - Reducción (28.500) debe coincidir con el saldo final (95.000)')

			// Elena Ruiz (contrato 900113): cobro anulado sin evidencia válida -> facturas continúan abiertas
			const elenaPaid = paidInvoicesAfterRealPay.filter(i => i.contractId === 900113)
			assert.equal(elenaPaid.length, 0, 'Elena Ruiz no debe tener facturas pagadas')
			const elenaOpen = openInvoicesAfterRealPay.filter(i => i.contractId === 900113)
			assert.equal(elenaOpen.length, 2, 'Elena Ruiz debe conservar sus 2 facturas abiertas')
			for (const inv of elenaOpen) {
				assert.equal(inv.balanceCents, inv.totalAmountCents)
			}

			// Auditoría: 62 iniciales + 8 INVOICE_PAID + 1 PARTIAL_PAYMENT = 71 eventos
			const eventsAfterRealPayRow = db.prepare(`
				SELECT
					COUNT(*) AS total_events,
					COUNT(CASE WHEN event_type = 'INVOICE_PAID' THEN 1 END) AS paid_events,
					COUNT(CASE WHEN event_type = 'PARTIAL_PAYMENT' THEN 1 END) AS partial_events
				FROM customer_event
			`).get()
			assert.ok(eventsAfterRealPayRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterRealPayRow, 'total_events')), 71)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterRealPayRow, 'paid_events')), 8)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterRealPayRow, 'partial_events')), 1)

			assert.equal(syncRunRepository.list(db).length, 4, 'Debe haber 4 corridas registradas en Cobrix')

			// ====================================================================
			// 6. Reimportación para verificar idempotencia
			// ====================================================================
			const reimportResult = await importService.run({ isSimulation: false })

			assert.equal(reimportResult.status, 'COMPLETED')
			assert.equal(reimportResult.isSimulation, false)
			// Como 8 cuotas fueron cobradas en el ISP en el paso 3, el endpoint /contrato/cuotas-pendientes
			// solo devuelve las 34 cuotas que siguen pendientes, y las 34 son reconocidas como ALREADY_IMPORTED
			assert.equal(reimportResult.summary.alreadyImportedCount, 34, 'Las 34 cuotas pendientes en el ISP deben reconocerse como ya importadas')
			assert.equal(reimportResult.summary.importedInvoicesCount, 0, 'No deben importarse facturas nuevas')
			assert.equal(reimportResult.summary.newCustomersCount, 0, 'No deben crearse clientes nuevos')

			// Invariantes de idempotencia en BD: no duplicados, saldos y eventos intactos
			assert.equal(customerRepository.count(db), 20, 'El número de clientes debe mantenerse en 20')
			assert.equal(contractRepository.count(db), 21, 'El número de contratos debe mantenerse en 21')

			const openAfterReimport = invoiceRepository.listOpen(db)
			assert.equal(openAfterReimport.length, 34, 'El número de facturas abiertas debe mantenerse en 34')
			const openBalanceAfterReimport = openAfterReimport.reduce((acc, inv) => acc + inv.balanceCents, 0)
			assert.equal(openBalanceAfterReimport, 95000, 'El saldo abierto total debe mantenerse en 95.000 centavos')

			const allAfterReimport = getAllInvoices(db)
			assert.equal(allAfterReimport.length, 42, 'El total de facturas debe mantenerse en 42')
			const paidAfterReimport = allAfterReimport.filter(i => i.status === 'PAID')
			assert.equal(paidAfterReimport.length, 8, 'El total de facturas pagadas debe mantenerse en 8')

			const eventsAfterReimportRow = db.prepare('SELECT COUNT(*) AS count FROM customer_event').get()
			assert.ok(eventsAfterReimportRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterReimportRow, 'count')), 71, 'No deben crearse eventos de negocio duplicados')

			assert.equal(syncRunRepository.list(db).length, 5, 'Debe registrarse la 5ta corrida operativa')

			// ====================================================================
			// 7. Resincronización de pagos para verificar idempotencia
			// ====================================================================
			const resyncPaymentResult = await paymentService.run({ isSimulation: false })

			assert.equal(resyncPaymentResult.status, 'COMPLETED')
			assert.equal(resyncPaymentResult.isSimulation, false)
			assert.equal(resyncPaymentResult.summary.markedPaidCount, 0, 'No debe volver a marcar facturas pagadas')
			assert.equal(resyncPaymentResult.summary.partialPaymentsCount, 0, 'No debe volver a descontar abonos parciales')
			assert.equal(resyncPaymentResult.summary.stillOpenCount, 34)
			assert.equal(resyncPaymentResult.summary.stillOpenBalanceCents, 95000)

			// Invariantes tras resincronización de pagos
			const openAfterResync = invoiceRepository.listOpen(db)
			assert.equal(openAfterResync.length, 34)
			const openBalanceAfterResync = openAfterResync.reduce((acc, inv) => acc + inv.balanceCents, 0)
			assert.equal(openBalanceAfterResync, 95000)

			const allAfterResync = getAllInvoices(db)
			const paidAfterResync = allAfterResync.filter(i => i.status === 'PAID')
			assert.equal(paidAfterResync.length, 8)

			// El abono parcial de Luis no se volvió a aplicar: sigue en 1.500 centavos
			const luisPartialAfterResync = openAfterResync.filter(i => i.contractId === 900103 && i.balanceCents === 1500)
			assert.equal(luisPartialAfterResync.length, 1, 'La factura con abono parcial debe conservar su saldo de 1.500 centavos')

			const eventsAfterResyncRow = db.prepare('SELECT COUNT(*) AS count FROM customer_event').get()
			assert.ok(eventsAfterResyncRow !== undefined)
			assert.equal(parseSqlInteger(getColumnValue(eventsAfterResyncRow, 'count')), 71, 'Los eventos de negocio deben seguir siendo exactamente 71')

			assert.equal(syncRunRepository.list(db).length, 6, 'Debe registrarse la 6ta corrida operativa')

			// ====================================================================
			// 8. Comprobaciones finales de historial, auditoría y métricas agregadas
			// ====================================================================

			// 8.1 Historial de corridas y resúmenes tipados
			const allRuns = historyService.listRuns()
			assert.equal(allRuns.length, 6, 'El historial debe contener exactamente 6 corridas de sincronización')

			// Corridas ordenadas descendentemente por started_at
			const run0 = allRuns[0]
			assert.ok(run0 !== undefined)
			assert.equal(run0.type, 'PAYMENT_UPDATE')
			assert.equal(run0.isSimulation, false)
			assert.equal(run0.status, 'COMPLETED')
			assert.equal(run0.summary.markedPaidCount, 0)

			const run1 = allRuns[1]
			assert.ok(run1 !== undefined)
			assert.equal(run1.type, 'IMPORT')
			assert.equal(run1.isSimulation, false)
			assert.equal(run1.status, 'COMPLETED')
			assert.equal(run1.summary.alreadyImportedCount, 34)

			const run2 = allRuns[2]
			assert.ok(run2 !== undefined)
			assert.equal(run2.type, 'PAYMENT_UPDATE')
			assert.equal(run2.isSimulation, false)
			assert.equal(run2.status, 'COMPLETED')
			assert.equal(run2.summary.markedPaidCount, 8)

			const run3 = allRuns[3]
			assert.ok(run3 !== undefined)
			assert.equal(run3.type, 'PAYMENT_UPDATE')
			assert.equal(run3.isSimulation, true)
			assert.equal(run3.status, 'COMPLETED')
			assert.equal(run3.summary.markedPaidCount, 8)

			const run4 = allRuns[4]
			assert.ok(run4 !== undefined)
			assert.equal(run4.type, 'IMPORT')
			assert.equal(run4.isSimulation, false)
			assert.equal(run4.status, 'COMPLETED')
			assert.equal(run4.summary.importedInvoicesCount, 42)

			const run5 = allRuns[5]
			assert.ok(run5 !== undefined)
			assert.equal(run5.type, 'IMPORT')
			assert.equal(run5.isSimulation, true)
			assert.equal(run5.status, 'COMPLETED')
			assert.equal(run5.summary.importedInvoicesCount, 42)

			// Concordancia de getRunById y detalles para cada corrida
			for (const r of allRuns) {
				const fetched = historyService.getRunById(r.id)
				assert.ok(fetched !== null)
				assert.equal(fetched.id, r.id)
				assert.equal(fetched.type, r.type)
				assert.equal(fetched.isSimulation, r.isSimulation)
				assert.equal(fetched.status, r.status)

				const details = historyService.listRunDetails(r.id)
				assert.ok(details.length > 0, `La corrida ${r.id} debe tener registros de detalle`)
			}

			// 8.2 Métricas globales del sistema
			const finalGlobalMetrics = historyService.getGlobalMetrics(10)
			assert.equal(finalGlobalMetrics.totalCustomersCount, 20)
			assert.equal(finalGlobalMetrics.totalContractsCount, 21)
			assert.equal(finalGlobalMetrics.openInvoicesCount, 34)
			assert.equal(finalGlobalMetrics.paidInvoicesCount, 8)
			assert.equal(finalGlobalMetrics.totalOpenBalanceCents, 95000)
			assert.ok(finalGlobalMetrics.oldestOpenDueDate !== null)
			assert.equal(finalGlobalMetrics.recentRuns.length, 6)

			// 8.3 Consultas SQL independientes de referencia para validar las métricas
			const independentSqlStatsRow = db.prepare(`
				SELECT
					(SELECT COUNT(*) FROM customer) AS sql_total_customers,
					(SELECT COUNT(*) FROM contract) AS sql_total_contracts,
					(SELECT COUNT(*) FROM invoice WHERE status = 'OPEN') AS sql_open_invoices,
					(SELECT COUNT(*) FROM invoice WHERE status = 'PAID') AS sql_paid_invoices,
					(SELECT COALESCE(SUM(balance_cents), 0) FROM invoice WHERE status = 'OPEN') AS sql_open_balance_cents,
					(SELECT MIN(due_date) FROM invoice WHERE status = 'OPEN') AS sql_oldest_open_due_date,
					(SELECT COUNT(*) FROM customer_event) AS sql_customer_events,
					(SELECT COUNT(*) FROM sync_run) AS sql_sync_runs
			`).get()
			assert.ok(independentSqlStatsRow !== undefined)

			const sqlCustomers = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_total_customers'))
			const sqlContracts = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_total_contracts'))
			const sqlOpenInvoices = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_open_invoices'))
			const sqlPaidInvoices = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_paid_invoices'))
			const sqlOpenBalance = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_open_balance_cents'))
			const sqlOldestDueDate = parseSqlNullableString(getColumnValue(independentSqlStatsRow, 'sql_oldest_open_due_date'))
			const sqlCustomerEvents = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_customer_events'))
			const sqlSyncRuns = parseSqlInteger(getColumnValue(independentSqlStatsRow, 'sql_sync_runs'))

			assert.equal(sqlCustomers, finalGlobalMetrics.totalCustomersCount)
			assert.equal(sqlContracts, finalGlobalMetrics.totalContractsCount)
			assert.equal(sqlOpenInvoices, finalGlobalMetrics.openInvoicesCount)
			assert.equal(sqlPaidInvoices, finalGlobalMetrics.paidInvoicesCount)
			assert.equal(sqlOpenBalance, finalGlobalMetrics.totalOpenBalanceCents)
			assert.equal(sqlOldestDueDate, finalGlobalMetrics.oldestOpenDueDate)
			assert.equal(sqlCustomerEvents, 71)
			assert.equal(sqlSyncRuns, 6)

			// 8.4 Métricas agregadas por cliente y concordancia con totales globales
			const customerMetricsList = historyService.listCustomerMetrics()
			assert.equal(customerMetricsList.length, 20, 'Debe haber métricas para exactamente 20 clientes')

			let sumCustomerContracts = 0
			let sumCustomerOpenInvoices = 0
			let sumCustomerPaidInvoices = 0
			let sumCustomerOpenBalanceCents = 0

			for (const cm of customerMetricsList) {
				sumCustomerContracts += cm.totalContractsCount
				sumCustomerOpenInvoices += cm.openInvoicesCount
				sumCustomerPaidInvoices += cm.paidInvoicesCount
				sumCustomerOpenBalanceCents += cm.openBalanceCents

				// Concordancia con consulta individual por cliente
				const individual = historyService.getCustomerMetricsById(cm.customerId)
				assert.ok(individual !== null)
				assert.equal(individual.customerId, cm.customerId)
				assert.equal(individual.name, cm.name)
				assert.equal(individual.totalContractsCount, cm.totalContractsCount)
				assert.equal(individual.openInvoicesCount, cm.openInvoicesCount)
				assert.equal(individual.paidInvoicesCount, cm.paidInvoicesCount)
				assert.equal(individual.openBalanceCents, cm.openBalanceCents)
				assert.equal(individual.oldestOpenDueDate, cm.oldestOpenDueDate)
			}

			// La suma de métricas por cliente coincide exactamente con los totales globales
			assert.equal(sumCustomerContracts, finalGlobalMetrics.totalContractsCount, 'La suma de contratos por cliente debe ser 21')
			assert.equal(sumCustomerOpenInvoices, finalGlobalMetrics.openInvoicesCount, 'La suma de facturas abiertas por cliente debe ser 34')
			assert.equal(sumCustomerPaidInvoices, finalGlobalMetrics.paidInvoicesCount, 'La suma de facturas pagadas por cliente debe ser 8')
			assert.equal(sumCustomerOpenBalanceCents, finalGlobalMetrics.totalOpenBalanceCents, 'La suma de saldos por cliente debe ser 95.000 centavos')

			// Casos específicos documentados de clientes
			// Ana Pérez (V12345678): 3 facturas pagadas, 0 abiertas, saldo 0
			const anaMetrics = historyService.getCustomerMetricsById('V12345678')
			assert.ok(anaMetrics !== null)
			assert.equal(anaMetrics.paidInvoicesCount, 3)
			assert.equal(anaMetrics.openInvoicesCount, 0)
			assert.equal(anaMetrics.openBalanceCents, 0)
			assert.equal(anaMetrics.oldestOpenDueDate, null)

			// Luis Gómez (V9876543): 2 contratos, 1 pagada, 4 abiertas (3 del contrato cortado + 1 del activo)
			// Saldo abierto: 35 USD (activo) + 15 USD (parcial cortado) + 40 USD (2 cuotas cortado) = 90 USD (9.000 centavos)
			const luisMetrics = historyService.getCustomerMetricsById('V9876543')
			assert.ok(luisMetrics !== null)
			assert.equal(luisMetrics.totalContractsCount, 2)
			assert.equal(luisMetrics.paidInvoicesCount, 1)
			assert.equal(luisMetrics.openInvoicesCount, 4)
			assert.equal(luisMetrics.openBalanceCents, 9000)

			// Comercial El Faro (J401234567): 2 facturas pagadas, 0 abiertas, saldo 0
			const faroMetrics = historyService.getCustomerMetricsById('J401234567')
			assert.ok(faroMetrics !== null)
			assert.equal(faroMetrics.paidInvoicesCount, 2)
			assert.equal(faroMetrics.openInvoicesCount, 0)
			assert.equal(faroMetrics.openBalanceCents, 0)

			// Elena Ruiz (9000123): 0 facturas pagadas, 2 abiertas, saldo 50 USD (5.000 centavos)
			const elenaMetrics = historyService.getCustomerMetricsById('9000123')
			assert.ok(elenaMetrics !== null)
			assert.equal(elenaMetrics.paidInvoicesCount, 0)
			assert.equal(elenaMetrics.openInvoicesCount, 2)
			assert.equal(elenaMetrics.openBalanceCents, 5000)
		} finally {
			db.close()
		}
	})
})
