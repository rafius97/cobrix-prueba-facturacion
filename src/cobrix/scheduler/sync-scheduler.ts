/**
 * Servicio de planificación y ejecución automática diaria para Cobrix.
 * Coordina la ejecución programada de importación de cuotas y actualización de facturas pagadas
 * respetando la zona horaria America/Caracas, idempotencia y exclusión mutua de procesos.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import type { DatabaseSync } from 'node:sqlite'

import type { BillingApiClient } from '../client/billing-api-client.ts'
import { configRepository } from '../db/repositories.ts'
import type { AutoRunStatus } from '../db/types.ts'
import {
	executeScheduledFullSync,
	isSyncRunning,
	SyncConflictError,
} from '../../server/api/sync-controller.ts'
import type { SyncRunItemDto } from '../../shared/api-types.ts'

export interface CaracasDateTime {
	readonly date: string
	readonly timeString: string
}

export type ControlledNow = Date | CaracasDateTime

export interface SyncSchedulerOptions {
	readonly db: DatabaseSync
	readonly billingClient?: BillingApiClient
	readonly checkIntervalMs?: number
}

export type SchedulerCheckReason =
	| 'SCHEDULE_DISABLED'
	| 'TICK_IN_PROGRESS'
	| 'HOUR_NOT_REACHED'
	| 'ALREADY_COMPLETED_TODAY'
	| 'ALREADY_FAILED_TODAY'
	| 'SYNC_LOCKED'
	| 'IMPORT_FAILED'
	| 'PAYMENT_FAILED'
	| 'CYCLE_COMPLETED'
	| 'CYCLE_ERROR'

export interface SchedulerCheckResult {
	readonly ran: boolean
	readonly reason: SchedulerCheckReason
	readonly date: string
	readonly status?: AutoRunStatus
	readonly importRun?: SyncRunItemDto
	readonly paymentRun?: SyncRunItemDto | null
	readonly errorMessage?: string
}

/**
 * Obtiene la fecha civil (YYYY-MM-DD) y hora (HH:MM en formato 24 horas)
 * correspondientes a la zona horaria America/Caracas.
 * Siempre calcula la fecha y hora reales de America/Caracas sin depender de SANDBOX_TODAY.
 */
export function getCaracasDateAndTime(referenceDate?: Date): CaracasDateTime {
	const now = referenceDate ?? new Date()
	const formatter = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'America/Caracas',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	})

	const parts = formatter.formatToParts(now)
	let year = ''
	let month = ''
	let day = ''
	let hour = ''
	let minute = ''

	for (const part of parts) {
		if (part.type === 'year') year = part.value
		else if (part.type === 'month') month = part.value
		else if (part.type === 'day') day = part.value
		else if (part.type === 'hour') hour = part.value
		else if (part.type === 'minute') minute = part.value
	}

	const date = `${year}-${month}-${day}`
	const timeString = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`

	return { date, timeString }
}

export class SyncScheduler {
	private readonly db: DatabaseSync
	private readonly billingClient?: BillingApiClient
	private readonly checkIntervalMs: number
	private timer: NodeJS.Timeout | null = null
	private isTickRunning = false

	constructor(options: SyncSchedulerOptions) {
		this.db = options.db
		this.billingClient = options.billingClient
		this.checkIntervalMs = options.checkIntervalMs ?? 30_000
	}

	/**
	 * Inicia el temporizador de comprobación periódica en segundo plano.
	 * Dispara un chequeo inicial que solo ejecutará el ciclo si ya se alcanzó la hora programada.
	 * Desacopla el temporizador del bucle de eventos mediante .unref() para no impedir el cierre limpio del proceso.
	 */
	public start(): void {
		if (this.timer !== null) {
			return
		}

		console.log('[scheduler] Sync scheduler started')

		// Chequeo inicial (ejecuta si el servidor arranca después de la hora programada y no ha corrido hoy)
		void this.checkAndRun().catch(() => {})

		this.timer = setInterval(() => {
			void this.checkAndRun().catch(() => {})
		}, this.checkIntervalMs)

		this.timer.unref()
	}

	/**
	 * Detiene el temporizador en segundo plano.
	 */
	public stop(): void {
		if (this.timer !== null) {
			clearInterval(this.timer)
			this.timer = null
		}
	}

	/**
	 * Indica si el planificador se encuentra actualmente activo con temporizador programado.
	 */
	public isRunning(): boolean {
		return this.timer !== null
	}

	/**
	 * Evalúa las condiciones de programación y ejecuta el ciclo de sincronización si corresponde.
	 * Permite inyectar una fecha/hora controlada (objeto Date o CaracasDateTime) para pruebas reproducibles.
	 */
	public async checkAndRun(controlledNow?: ControlledNow): Promise<SchedulerCheckResult> {
		const resolvedNow = this.resolveNow(controlledNow)
		const todayDate = resolvedNow.date
		const currentTime = resolvedNow.timeString

		// Prevención de ticks solapados del propio scheduler
		if (this.isTickRunning) {
			return { ran: false, reason: 'TICK_IN_PROGRESS', date: todayDate }
		}

		this.isTickRunning = true
		try {
			// Leer configuración actualizada directamente de la persistencia
			const config = configRepository.get(this.db)

			// 1. Si la programación automática está inactiva, no hacer nada
			if (!config.autoRunActive) {
				return { ran: false, reason: 'SCHEDULE_DISABLED', date: todayDate }
			}

			// 2. Si todavía no se alcanza la hora programada en Caracas, esperar
			if (currentTime < config.autoRunHour) {
				return { ran: false, reason: 'HOUR_NOT_REACHED', date: todayDate }
			}

			// 3. Revisar el estado registrado hoy
			if (config.lastAutoRunDate === todayDate) {
				if (config.lastAutoRunStatus === 'COMPLETED') {
					return { ran: false, reason: 'ALREADY_COMPLETED_TODAY', date: todayDate }
				}
				if (config.lastAutoRunStatus === 'FAILED') {
					return { ran: false, reason: 'ALREADY_FAILED_TODAY', date: todayDate }
				}
				// Si está en RUNNING, permitimos recuperarlo porque este tick no estaba corriendo en este proceso
			}

			// 4. Si ya existe una sincronización manual activa, esperar al próximo tick
			if (isSyncRunning()) {
				return { ran: false, reason: 'SYNC_LOCKED', date: todayDate }
			}

			// 5. Persistir estado RUNNING antes de iniciar la ejecución
			configRepository.updateAutoRunState(this.db, todayDate, 'RUNNING')
			console.log(`[scheduler] Scheduled sync started for ${todayDate}`)

			// 6. Ejecutar ciclo completo manteniendo el cerrojo central
			try {
				const { importRun, paymentRun } = await executeScheduledFullSync(this.db, {
					billingClient: this.billingClient,
					isSimulation: false,
				})

				// Fase 1 fallida
				if (importRun.status === 'FAILED') {
					configRepository.updateAutoRunState(this.db, todayDate, 'FAILED')
					const err = importRun.errorMessage ?? 'Import sync failed'
					console.error(`[scheduler] Scheduled sync failed during import for ${todayDate}: ${err}`)
					return {
						ran: true,
						reason: 'IMPORT_FAILED',
						date: todayDate,
						status: 'FAILED',
						importRun,
						paymentRun,
						errorMessage: err,
					}
				}

				// Fase 2 fallida u omitida
				if (paymentRun === null || paymentRun.status === 'FAILED') {
					configRepository.updateAutoRunState(this.db, todayDate, 'FAILED')
					const err = paymentRun?.errorMessage ?? 'Payment sync failed'
					console.error(`[scheduler] Scheduled sync failed during payment update for ${todayDate}: ${err}`)
					return {
						ran: true,
						reason: 'PAYMENT_FAILED',
						date: todayDate,
						status: 'FAILED',
						importRun,
						paymentRun,
						errorMessage: err,
					}
				}

				// Ambas fases culminaron con COMPLETED
				configRepository.updateAutoRunState(this.db, todayDate, 'COMPLETED')
				console.log(`[scheduler] Scheduled sync completed successfully for ${todayDate}`)
				return {
					ran: true,
					reason: 'CYCLE_COMPLETED',
					date: todayDate,
					status: 'COMPLETED',
					importRun,
					paymentRun,
				}
			} catch (error) {
				if (error instanceof SyncConflictError) {
					return { ran: false, reason: 'SYNC_LOCKED', date: todayDate }
				}

				try {
					configRepository.updateAutoRunState(this.db, todayDate, 'FAILED')
				} catch {
					// Defensivo si la base de datos se cerró
				}

				const message = error instanceof Error ? error.message : 'Unknown execution error'
				console.error(`[scheduler] Scheduled sync failed for ${todayDate}: ${message}`)
				return {
					ran: true,
					reason: 'CYCLE_ERROR',
					date: todayDate,
					status: 'FAILED',
					errorMessage: message,
				}
			}
		} finally {
			this.isTickRunning = false
		}
	}

	private resolveNow(controlledNow?: ControlledNow): CaracasDateTime {
		if (controlledNow !== undefined) {
			if (controlledNow instanceof Date) {
				return getCaracasDateAndTime(controlledNow)
			}
			return controlledNow
		}
		return getCaracasDateAndTime()
	}
}
