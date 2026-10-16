/**
 * Servicio de dominio para consulta del historial de sincronizaciones y métricas agregadas de Cobrix.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones de tipo inseguras (`as`).
 */

import type { DatabaseSync } from 'node:sqlite'

import {
	contractRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../db/repositories.ts'
import type { SyncRunDetail } from '../db/types.ts'
import { parseTypedSyncRun } from './parsers.ts'
import type {
	CustomerMetricsSummary,
	GlobalSystemMetrics,
	TypedSyncRun,
} from './types.ts'

/**
 * Servicio para consultar el historial tipado de sincronizaciones y métricas del sistema.
 */
export class HistoryService {
	private readonly db: DatabaseSync

	constructor(db: DatabaseSync) {
		this.db = db
	}

	/**
	 * Obtiene una corrida de sincronización por ID con su resumen fuertemente tipado.
	 * Devuelve `null` si la corrida no existe.
	 * Lanza `HistoryParseError` si el `summary_json` almacenado es inválido o incompatible.
	 */
	getRunById(runId: string): TypedSyncRun | null {
		const run = syncRunRepository.getById(this.db, runId)
		if (run === null) return null
		return parseTypedSyncRun(run)
	}

	/**
	 * Lista las corridas de sincronización más recientes con sus resúmenes fuertemente tipados.
	 * Las corridas se ordenan por fecha de inicio descendente.
	 * Lanza `HistoryParseError` si alguna corrida contiene un `summary_json` inválido.
	 */
	listRuns(limit?: number): TypedSyncRun[] {
		const runs = syncRunRepository.list(this.db, limit)
		return runs.map(run => parseTypedSyncRun(run))
	}

	/**
	 * Obtiene el detalle de cuotas evaluadas en una corrida específica.
	 */
	listRunDetails(runId: string): SyncRunDetail[] {
		return syncRunRepository.listDetailsByRunId(this.db, runId)
	}

	/**
	 * Calcula las métricas globales del sistema mediante consultas SQL agregadas en SQLite.
	 * Permite configurar la cantidad de corridas recientes a incluir (por defecto 5).
	 */
	getGlobalMetrics(recentRunsLimit: number = 5): GlobalSystemMetrics {
		const totalCustomersCount = customerRepository.count(this.db)
		const totalContractsCount = contractRepository.count(this.db)
		const invoiceMetrics = invoiceRepository.getAggregateMetrics(this.db)
		const recentRuns = this.listRuns(recentRunsLimit)

		return {
			totalCustomersCount,
			totalContractsCount,
			openInvoicesCount: invoiceMetrics.openInvoicesCount,
			paidInvoicesCount: invoiceMetrics.paidInvoicesCount,
			totalOpenBalanceCents: invoiceMetrics.totalOpenBalanceCents,
			oldestOpenDueDate: invoiceMetrics.oldestOpenDueDate,
			recentRuns,
		}
	}

	/**
	 * Obtiene el resumen agregado de contratos y deudas para todos los clientes, con búsqueda opcional.
	 */
	listCustomerMetrics(search?: string): CustomerMetricsSummary[] {
		return customerRepository.listCustomerMetrics(this.db, search)
	}

	/**
	 * Obtiene el resumen agregado de contratos y deudas para un cliente específico.
	 * Devuelve `null` si el cliente no existe.
	 */
	getCustomerMetricsById(customerId: string): CustomerMetricsSummary | null {
		return customerRepository.getCustomerMetricsById(this.db, customerId)
	}
}
