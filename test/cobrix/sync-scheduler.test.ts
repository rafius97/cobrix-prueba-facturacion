/**
 * Pruebas unitarias y de integración para SyncScheduler.
 * Valida programación horaria en America/Caracas, migración no destructiva,
 * exclusión mutua, recuperación ante fallos y ciclo de vida.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { describe, it } from 'node:test'

import { BillingApiClient } from '../../src/cobrix/client/billing-api-client.ts'
import type { JsonValue } from '../../src/cobrix/client/validators.ts'
import { createCobrixDatabase, migrateConfigSchemaIfNeeded } from '../../src/cobrix/db/database.ts'
import {
	configRepository,
	contractRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../../src/cobrix/db/repositories.ts'
import {
	getCaracasDateAndTime,
	SyncScheduler,
} from '../../src/cobrix/scheduler/sync-scheduler.ts'
import {
	acquireSyncLock,
	isSyncRunning,
	releaseSyncLock,
} from '../../src/server/api/sync-controller.ts'

// ============================================================================
// Mocks y generadores de BillingApiClient para pruebas aisladas
// ============================================================================

function jsonResponse(data: JsonValue, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	})
}

interface MockBillingOptions {
	readonly failImport?: boolean
	readonly failPayment?: boolean
	readonly onPaymentCalled?: () => void
}

function createMockBillingClient(options: MockBillingOptions = {}): BillingApiClient {
	const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

		// 1. Auth login
		if (url.includes('/login')) {
			return jsonResponse({
				usuario: 'cobrix',
				email: 'cobrix@test.com',
				access_token: 'mock-token-abc',
				access_token_expires_in: '2026-10-15T00:00:00',
			})
		}

		// 2. Import endpoints
		if (url.includes('/lista_ids_contratos')) {
			if (options.failImport === true) {
				return jsonResponse({ message: 'Error simulado en importación' }, 500)
			}
			return jsonResponse({
				success: true,
				message: 'OK',
				pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
				errors: [],
				data: [],
			})
		}

		// 3. Payment endpoints
		if (url.includes('/libro_pagos')) {
			if (options.onPaymentCalled !== undefined) {
				options.onPaymentCalled()
			}
			if (options.failPayment === true) {
				return jsonResponse({ message: 'Error simulado en conciliación de pagos' }, 500)
			}
			return jsonResponse({
				success: true,
				message: 'OK',
				pagination: { page: 1, per_page: 50, total: 0, total_pages: 1 },
				errors: [],
				data: [],
			})
		}

		return jsonResponse({ success: true, data: [] })
	}

	return new BillingApiClient({
		baseUrl: 'http://billing.test',
		username: 'cobrix',
		password: 'cobrix-sandbox',
		fetchFn: mockFetch,
	})
}

// ============================================================================
// Batería de Pruebas
// ============================================================================

describe('SyncScheduler: Planificador diario de sincronización automática', () => {
	it('1. Migración: agrega columnas a una base existente conservando sus datos', () => {
		const db = new DatabaseSync(':memory:')
		// Crear tabla config inicial sin las columnas del scheduler (esquema anterior)
		db.exec(`
			CREATE TABLE config (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				company_name TEXT NOT NULL DEFAULT 'Empresa Previa',
				company_tax_id TEXT NOT NULL DEFAULT 'J-12345678-9',
				company_email TEXT NOT NULL DEFAULT 'admin@previa.test',
				api_url TEXT NOT NULL DEFAULT 'http://127.0.0.1:4310/api/v1',
				api_username TEXT NOT NULL DEFAULT 'cobrix',
				api_password TEXT NOT NULL DEFAULT 'secret',
				importable_statuses TEXT NOT NULL DEFAULT 'ACTIVO',
				window_months INTEGER,
				max_recent_installments INTEGER,
				grace_days INTEGER NOT NULL DEFAULT 0,
				run_invoice_limit INTEGER,
				run_amount_limit_cents INTEGER,
				excluded_document_types TEXT NOT NULL DEFAULT '',
				auto_run_hour TEXT NOT NULL DEFAULT '05:30',
				auto_run_active INTEGER NOT NULL DEFAULT 1
			);
			INSERT INTO config (id, company_name, auto_run_hour, auto_run_active)
			VALUES (1, 'Empresa Previa', '05:30', 1);
		`)

		// Ejecutar la migración idempotente
		migrateConfigSchemaIfNeeded(db)

		// Verificar que las columnas fueron agregadas y los datos previos se conservaron intactos
		const config = configRepository.get(db)
		assert.equal(config.companyName, 'Empresa Previa')
		assert.equal(config.autoRunHour, '05:30')
		assert.equal(config.autoRunActive, true)
		assert.equal(config.lastAutoRunDate, null)
		assert.equal(config.lastAutoRunStatus, null)

		// Comprobar que una segunda llamada a la migración es idempotente
		migrateConfigSchemaIfNeeded(db)
		const configAfterSecondMigration = configRepository.get(db)
		assert.equal(configAfterSecondMigration.companyName, 'Empresa Previa')
	})

	it('2. Programación desactivada: no ejecuta el ciclo aunque sea la hora fijada', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: false, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		const result = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:30' })
		assert.equal(result.ran, false)
		assert.equal(result.reason, 'SCHEDULE_DISABLED')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, null)
		assert.equal(config.lastAutoRunStatus, null)
	})

	it('3. Horarios en Caracas: espera si es anterior, ejecuta al ser exacta o posterior', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Hora anterior (03:59)
		const resultBefore = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '03:59' })
		assert.equal(resultBefore.ran, false)
		assert.equal(resultBefore.reason, 'HOUR_NOT_REACHED')

		// Hora exacta (04:00)
		const resultExact = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
		assert.equal(resultExact.ran, true)
		assert.equal(resultExact.reason, 'CYCLE_COMPLETED')
		assert.equal(resultExact.status, 'COMPLETED')

		// Hora posterior en un nuevo día (04:15)
		const resultAfter = await scheduler.checkAndRun({ date: '2026-10-14', timeString: '04:15' })
		assert.equal(resultAfter.ran, true)
		assert.equal(resultAfter.reason, 'CYCLE_COMPLETED')
		assert.equal(resultAfter.date, '2026-10-14')
	})

	it('4. Arranque tardío y recuperación de ciclo que quedó RUNNING', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Caso A: Arranque tardío (el servidor arranca a las 11:00 sin corrida previa de hoy)
		const resultLate = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '11:00' })
		assert.equal(resultLate.ran, true)
		assert.equal(resultLate.reason, 'CYCLE_COMPLETED')

		// Caso B: Simular que el proceso anterior se apagó abruptamente y dejó el estado en RUNNING
		configRepository.updateAutoRunState(db, '2026-10-14', 'RUNNING')

		const resultRecover = await scheduler.checkAndRun({ date: '2026-10-14', timeString: '06:00' })
		assert.equal(resultRecover.ran, true)
		assert.equal(resultRecover.reason, 'CYCLE_COMPLETED')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, '2026-10-14')
		assert.equal(config.lastAutoRunStatus, 'COMPLETED')
	})

	it('5. Ausencia de duplicados: no repite si el ciclo de hoy ya está COMPLETED o FAILED', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Hoy completado
		configRepository.updateAutoRunState(db, '2026-10-13', 'COMPLETED')
		const resultCompleted = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '07:00' })
		assert.equal(resultCompleted.ran, false)
		assert.equal(resultCompleted.reason, 'ALREADY_COMPLETED_TODAY')

		// Hoy fallido
		configRepository.updateAutoRunState(db, '2026-10-14', 'FAILED')
		const resultFailed = await scheduler.checkAndRun({ date: '2026-10-14', timeString: '08:00' })
		assert.equal(resultFailed.ran, false)
		assert.equal(resultFailed.reason, 'ALREADY_FAILED_TODAY')
	})

	it('6. Importación FAILED: no ejecuta la actualización de pagos y persiste FAILED', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		let paymentCalled = false
		const billingClient = createMockBillingClient({
			failImport: true,
			onPaymentCalled: () => {
				paymentCalled = true
			},
		})
		const scheduler = new SyncScheduler({ db, billingClient })

		const result = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
		assert.equal(result.ran, true)
		assert.equal(result.reason, 'IMPORT_FAILED')
		assert.equal(result.status, 'FAILED')
		assert.equal(paymentCalled, false, 'La conciliación de pagos no debe ejecutarse si la importación falló')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, '2026-10-13')
		assert.equal(config.lastAutoRunStatus, 'FAILED')
	})

	it('7. Importación exitosa y pagos FAILED: termina FAILED y no se reintenta en el siguiente tick', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		// Sembrar una factura abierta para que la fase de pago consulte el libro de pagos del ISP
		customerRepository.create(db, {
			id: 'V12345678',
			originalDocument: 'V-12345678',
			documentType: 'V',
			personType: 'NATURAL',
			name: 'Cliente Prueba',
		})
		contractRepository.upsert(db, {
			id: 1001,
			customerId: 'V12345678',
			code: 'CON-1001',
			status: 'ACTIVO',
			plan: 'Plan 100M',
			planPriceCents: 2500,
			branch: 'Principal',
			currency: 'USD',
			billingDay: 26,
			cutoffDay: 4,
		})
		invoiceRepository.create(db, {
			invoiceNumber: 'INV-1001',
			externalDebtId: 'DEBT-1001',
			contractId: 1001,
			customerId: 'V12345678',
			period: '2026-08',
			dueDate: '2026-08-01',
			cutDate: '2026-08-10',
			totalAmountCents: 2500,
			balanceCents: 2500,
			status: 'OPEN',
		})

		const billingClient = createMockBillingClient({ failPayment: true })
		const scheduler = new SyncScheduler({ db, billingClient })

		const result = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
		assert.equal(result.ran, true)
		assert.equal(result.reason, 'PAYMENT_FAILED')
		assert.equal(result.status, 'FAILED')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, '2026-10-13')
		assert.equal(config.lastAutoRunStatus, 'FAILED')

		// El siguiente tick del día no vuelve a ejecutar automáticamente
		const nextTickResult = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:01' })
		assert.equal(nextTickResult.ran, false)
		assert.equal(nextTickResult.reason, 'ALREADY_FAILED_TODAY')
	})

	it('8. Ambas operaciones exitosas: el estado queda COMPLETED', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		const result = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
		assert.equal(result.ran, true)
		assert.equal(result.reason, 'CYCLE_COMPLETED')
		assert.equal(result.status, 'COMPLETED')
		assert.equal(result.importRun?.status, 'COMPLETED')
		assert.equal(result.paymentRun?.status, 'COMPLETED')
		assert.equal(result.importRun?.triggerType, 'SCHEDULED')
		assert.equal(result.paymentRun?.triggerType, 'SCHEDULED')

		const runsInDb = syncRunRepository.list(db)
		assert.equal(runsInDb.length, 2)
		assert.equal(runsInDb[0]?.triggerType, 'SCHEDULED')
		assert.equal(runsInDb[1]?.triggerType, 'SCHEDULED')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, '2026-10-13')
		assert.equal(config.lastAutoRunStatus, 'COMPLETED')
	})

	it('9. Concurrencia: pospone la ejecución si existe una sincronización manual en curso', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Simular sincronización manual que toma el cerrojo
		acquireSyncLock()
		assert.equal(isSyncRunning(), true)

		try {
			const result = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
			assert.equal(result.ran, false)
			assert.equal(result.reason, 'SYNC_LOCKED')
		} finally {
			releaseSyncLock()
		}

		assert.equal(isSyncRunning(), false)
	})

	it('10. Protección contra ticks solapados', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Disparar dos comprobaciones simultáneamente sobre la misma instancia
		const promise1 = scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })
		const promise2 = scheduler.checkAndRun({ date: '2026-10-13', timeString: '04:00' })

		const [res1, res2] = await Promise.all([promise1, promise2])

		// Una de las dos debe haber obtenido TICK_IN_PROGRESS o ALREADY_COMPLETED_TODAY
		const hasTickBlocked = res1.reason === 'TICK_IN_PROGRESS' || res2.reason === 'TICK_IN_PROGRESS'
		const hasCompleted = res1.reason === 'CYCLE_COMPLETED' || res2.reason === 'CYCLE_COMPLETED'
		assert.ok(hasCompleted, 'Al menos una llamada debe completar el ciclo')
		assert.ok(hasTickBlocked || res1.reason === 'ALREADY_COMPLETED_TODAY' || res2.reason === 'ALREADY_COMPLETED_TODAY')
	})

	it('11. Cambio de configuración en caliente: surte efecto inmediato sin reiniciar', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '06:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// A las 05:00 no debe correr
		const resBefore = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '05:00' })
		assert.equal(resBefore.ran, false)
		assert.equal(resBefore.reason, 'HOUR_NOT_REACHED')

		// El usuario adelanta la hora a las 04:30
		configRepository.update(db, { autoRunHour: '04:30' })

		// La misma hora 05:00 ahora sí ejecuta inmediatamente
		const resAfter = await scheduler.checkAndRun({ date: '2026-10-13', timeString: '05:00' })
		assert.equal(resAfter.ran, true)
		assert.equal(resAfter.reason, 'CYCLE_COMPLETED')
	})

	it('12. Apagado limpio: start activa el temporizador y stop lo cancela sin colgar el bucle', () => {
		const db = createCobrixDatabase(':memory:')
		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient, checkIntervalMs: 10_000 })

		assert.equal(scheduler.isRunning(), false)
		scheduler.start()
		assert.equal(scheduler.isRunning(), true)

		// Invocar start nuevamente es idempotente
		scheduler.start()
		assert.equal(scheduler.isRunning(), true)

		scheduler.stop()
		assert.equal(scheduler.isRunning(), false)

		// Invocar stop nuevamente es seguro
		scheduler.stop()
		assert.equal(scheduler.isRunning(), false)
	})

	it('con SANDBOX_TODAY configurado, una llamada sin referenceDate no sustituye la fecha real de Caracas', () => {
		const originalSandbox = process.env.SANDBOX_TODAY
		try {
			// Configuramos SANDBOX_TODAY con una fecha ficticia en el pasado
			process.env.SANDBOX_TODAY = '1999-01-01'

			// La fecha esperada de Caracas calculada dinámicamente según el reloj real con formatToParts
			const parts = new Intl.DateTimeFormat('en-GB', {
				timeZone: 'America/Caracas',
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			}).formatToParts(new Date())

			let year = ''
			let month = ''
			let day = ''
			for (const part of parts) {
				if (part.type === 'year') year = part.value
				else if (part.type === 'month') month = part.value
				else if (part.type === 'day') day = part.value
			}
			const expectedRealDate = `${year}-${month}-${day}`

			const caracasNow = getCaracasDateAndTime()

			// Debe coincidir con el reloj real en Caracas y no con la fecha fija inyectada
			assert.equal(caracasNow.date, expectedRealDate)
			assert.notEqual(caracasNow.date, '1999-01-01')
		} finally {
			if (originalSandbox !== undefined) {
				process.env.SANDBOX_TODAY = originalSandbox
			} else {
				delete process.env.SANDBOX_TODAY
			}
		}
	})

	it('la inyección explícita de una fecha Date calcula determinísticamente la fecha y hora de Caracas', () => {
		// Caso 1: 08:30 UTC = 04:30 Caracas (UTC-4)
		const dateObj1 = new Date('2026-10-13T08:30:00.000Z')
		const caracas1 = getCaracasDateAndTime(dateObj1)
		assert.equal(caracas1.date, '2026-10-13')
		assert.equal(caracas1.timeString, '04:30')

		// Caso 2: 03:59 UTC del 1 de enero = 23:59 Caracas del 31 de diciembre anterior (cruce de medianoche y año)
		const dateObj2 = new Date('2027-01-01T03:59:00.000Z')
		const caracas2 = getCaracasDateAndTime(dateObj2)
		assert.equal(caracas2.date, '2026-12-31')
		assert.equal(caracas2.timeString, '23:59')
	})

	it('las pruebas son deterministas y no dependen del reloj real cuando se proporciona una fecha controlada a checkAndRun', async () => {
		const db = createCobrixDatabase(':memory:')
		configRepository.update(db, { autoRunActive: true, autoRunHour: '04:00' })

		const billingClient = createMockBillingClient()
		const scheduler = new SyncScheduler({ db, billingClient })

		// Inyección de Date controlada: 2026-10-13T08:00:00Z -> 04:00 en Caracas
		const controlledDate = new Date('2026-10-13T08:00:00.000Z')
		const result = await scheduler.checkAndRun(controlledDate)

		assert.equal(result.ran, true)
		assert.equal(result.date, '2026-10-13')
		assert.equal(result.status, 'COMPLETED')

		const config = configRepository.get(db)
		assert.equal(config.lastAutoRunDate, '2026-10-13')
		assert.equal(config.lastAutoRunStatus, 'COMPLETED')
	})
})
