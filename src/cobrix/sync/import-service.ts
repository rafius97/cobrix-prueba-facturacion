/**
 * Servicio de importación de facturas y deudas de Cobrix.
 * Coordina la lectura desde la Billing API externa hacia SQLite con validación estricta,
 * idempotencia, atomicidad transaccional y registro de auditoría.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'

import { BillingApiClient } from '../client/billing-api-client.ts'
import { BillingApiNotFoundError } from '../client/errors.ts'
import type { IspPendingInstallmentRow } from '../client/types.ts'
import { withTransaction } from '../db/database.ts'
import {
	configRepository,
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
	syncRunRepository,
} from '../db/repositories.ts'
import type { CreateSyncRunDetailInput } from '../db/types.ts'
import {
	isDocumentTypeExcluded,
	normalizeIdentification,
	type NormalizedIdentification,
} from '../domain/identification.ts'
import { parseDebtDetail } from '../domain/installment.ts'
import { dollarsToCents, isCurrencyInconsistent, isResidualAmount } from '../domain/money.ts'
import { addMonths, currentPeriod } from '../../shared/dates.ts'
import type {
	ImportItemEvaluation,
	ImportLimitType,
	ImportRunCounters,
	ImportRunResult,
	ImportRunSummary,
	RunImportOptions,
} from './types.ts'

/**
 * Extrae de forma segura el periodo en formato YYYY-MM desde el detalle_deuda.
 * Si no es parseable, retorna cadena vacía.
 */
function extractPeriodOrEmpty(debtDetail: readonly string[]): string {
	const schedule = parseDebtDetail(debtDetail, 0)
	return schedule !== null ? schedule.period : ''
}

/**
 * Obtiene el siguiente número secuencial disponible para facturas de Cobrix.
 * Consulta la base de datos sin aserciones de tipo para mantener tipado estricto.
 */
function getNextInvoiceSequence(db: DatabaseSync): number {
	const row = db.prepare("SELECT invoice_number FROM invoice WHERE invoice_number LIKE 'CBX-%' ORDER BY id DESC LIMIT 1").get()
	if (row === undefined || row === null || typeof row !== 'object') {
		return 1
	}
	const candidate: SQLOutputValue | undefined = row['invoice_number']
	if (typeof candidate === 'string') {
		const match = /^CBX-(\d+)$/.exec(candidate)
		if (match !== null) {
			const numPart = match[1]
			if (numPart !== undefined) {
				const parsed = Number.parseInt(numPart, 10)
				if (Number.isFinite(parsed) && parsed > 0) {
					return parsed + 1
				}
			}
		}
	}
	return 1
}

/**
 * Formatea un número secuencial en el identificador canónico de factura de Cobrix (ej. "CBX-000001").
 */
function formatInvoiceNumber(sequence: number): string {
	return `CBX-${String(sequence).padStart(6, '0')}`
}

/**
 * Representa una cuota pendiente validada lista para evaluación de topes e importación.
 */
interface ValidCandidateItem {
	readonly row: IspPendingInstallmentRow
	readonly period: string
	readonly dueDate: string
	readonly cutDate: string
	readonly amountCents: number
}

/**
 * Representa un elemento cuya persistencia fue aprobada para ser guardado dentro de la transacción de negocio.
 */
interface ItemToPersist {
	readonly contractId: number
	readonly candidate: ValidCandidateItem
	readonly normalizedId: NormalizedIdentification
	readonly invoiceNumber: string
}

/**
 * Servicio encargado de orquestar la importación de clientes, contratos y facturas.
 */
export class ImportService {
	private readonly db: DatabaseSync
	private readonly client: BillingApiClient

	constructor(db: DatabaseSync, client: BillingApiClient) {
		this.db = db
		this.client = client
	}

	/**
	 * Ejecuta el proceso completo de importación o simulación.
	 */
	async run(options?: RunImportOptions): Promise<ImportRunResult> {
		const isSimulation = options?.isSimulation ?? false
		const runId = randomUUID()
		const startMs = Date.now()
		const startedAt = new Date(startMs).toISOString()

		const config = configRepository.get(this.db)
		const evaluations: ImportItemEvaluation[] = []
		const itemsToPersist: ItemToPersist[] = []
		let totalContractsInspected = 0
		const newCustomerIds = new Set<string>()
		const seenDebtIdsInRun = new Set<string>()

		let invoiceSequence = isSimulation ? 1 : getNextInvoiceSequence(this.db)
		let newInvoicesCount = 0
		let newAmountCents = 0
		let runHalted = false
		let haltedLimitType: ImportLimitType = 'INVOICE_LIMIT'
		let haltedReason = ''

		try {
			// 1. Obtener todos los IDs de contratos sin filtrar por estado en la API
			const contractIds = await this.client.listContractIds()

			// 2. Evaluar cada contrato secuencialmente (HTTP y evaluación fuera de transacción)
			for (const contractId of contractIds) {
				totalContractsInspected++

				let rows: readonly IspPendingInstallmentRow[]
				try {
					rows = await this.client.getPendingInstallments({ id_contrato: contractId })
				} catch (error) {
					if (error instanceof BillingApiNotFoundError) {
						evaluations.push({
							result: 'INVALID_DATA',
							contractId,
							debtId: '0',
							period: '',
							amountCents: 0,
							reason: `Contract ${contractId} could not be retrieved from ISP: ${error.message}`,
						})
						continue
					}
					// Errores globales (autenticación, red, etc.) abortan la corrida
					throw error
				}

				if (rows.length === 0) {
					continue
				}

				const firstRow = rows[0]
				if (firstRow === undefined) {
					continue
				}

				// 2.A. Detección de respuestas contradictorias (filas de otro contrato o deuda_id duplicado)
				const seenDebtIds = new Set<string>()
				let hasContradiction = false

				for (const r of rows) {
					if (r.contrato_id !== contractId) {
						hasContradiction = true
						break
					}
					if (r.deuda_id !== '0') {
						if (seenDebtIds.has(r.deuda_id)) {
							hasContradiction = true
							break
						}
						seenDebtIds.add(r.deuda_id)
					}
				}

				if (hasContradiction) {
					for (const r of rows) {
						evaluations.push({
							result: 'INVALID_DATA',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							reason: `Contract ${contractId} response is contradictory (mismatched contract ID or duplicate debt ID)`,
						})
					}
					continue
				}

				// 2.B. Filtrado por Estado del Contrato
				if (!config.importableStatuses.includes(firstRow.estado)) {
					for (const r of rows) {
						evaluations.push({
							result: 'EXCLUDED_STATUS',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							contractStatus: firstRow.estado,
							reason: `Contract status "${firstRow.estado}" is not importable`,
						})
					}
					continue
				}

				// 2.C. Normalización de Identificación del Titular
				const normalizedId = normalizeIdentification(firstRow.identificacion_contrato)
				if (normalizedId === null) {
					for (const r of rows) {
						evaluations.push({
							result: 'INVALID_IDENTIFICATION',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							rawIdentification: firstRow.identificacion_contrato,
							reason: `Contract identification "${firstRow.identificacion_contrato}" is invalid`,
						})
					}
					continue
				}

				// 2.D. Exclusión por tipo de documento configurado
				if (isDocumentTypeExcluded(normalizedId.documentType, config.excludedDocumentTypes)) {
					for (const r of rows) {
						evaluations.push({
							result: 'EXCLUDED_DOCUMENT_TYPE',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							documentType: normalizedId.documentType,
							reason: `Document type "${normalizedId.documentType ?? ''}" is excluded by configuration`,
						})
					}
					continue
				}

				// 2.E. Detección de Moneda Incoherente (contrato reportado en USD pero deuda < 1% del precio del plan)
				// Las cuotas residuales (< 1 centavo) se excluyen de esta regla para no generar falsos positivos (§4).
				const planPrice = Number(firstRow.precio_servicio)
				let contractCurrencyInconsistent = false

				for (const r of rows) {
					if (r.deuda_id !== '0' && !isResidualAmount(r.deuda) && isCurrencyInconsistent(r.deuda, planPrice)) {
						contractCurrencyInconsistent = true
						break
					}
				}

				if (contractCurrencyInconsistent) {
					for (const r of rows) {
						evaluations.push({
							result: 'INCONSISTENT_CURRENCY',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							planPriceCents: dollarsToCents(planPrice) ?? 0,
							reason: `Inconsistent currency: reported debt ${r.deuda} is less than 1% of plan price ${planPrice}`,
						})
					}
					continue
				}

				// 2.F. Evaluación individual de cuotas del contrato
				const validCandidates: ValidCandidateItem[] = []

				for (const r of rows) {
					// Caso "Sin deuda"
					if (r.deuda_id === '0') {
						evaluations.push({
							result: 'NO_DEBT',
							contractId,
							debtId: '0',
							period: '',
							amountCents: 0,
							reason: 'Row indicates no debt',
						})
						continue
					}

					// Caso saldo residual de menos de un centavo
					if (isResidualAmount(r.deuda)) {
						evaluations.push({
							result: 'RESIDUAL_BALANCE',
							contractId,
							debtId: r.deuda_id,
							period: extractPeriodOrEmpty(r.detalle_deuda),
							amountCents: dollarsToCents(r.deuda) ?? 0,
							reason: `Residual balance of less than one cent (${r.deuda})`,
						})
						continue
					}

					// Parseo del periodo y vencimiento
					const schedule = parseDebtDetail(r.detalle_deuda, config.graceDays)
					if (schedule === null) {
						evaluations.push({
							result: 'INVALID_DATA',
							contractId,
							debtId: r.deuda_id,
							period: '',
							amountCents: dollarsToCents(r.deuda) ?? 0,
							reason: 'Could not extract period and due date from debt detail',
						})
						continue
					}

					// Validación de la ventana temporal
					if (config.windowMonths !== null && config.windowMonths > 0) {
						const minPeriod = addMonths(currentPeriod(), -config.windowMonths)
						if (schedule.period < minPeriod) {
							evaluations.push({
								result: 'OUT_OF_WINDOW',
								contractId,
								debtId: r.deuda_id,
								period: schedule.period,
								amountCents: dollarsToCents(r.deuda) ?? 0,
								windowMonths: config.windowMonths,
								reason: `Period ${schedule.period} is older than window of ${config.windowMonths} months`,
							})
							continue
						}
					}

					const amountCents = dollarsToCents(r.deuda)
					if (amountCents === null) {
						evaluations.push({
							result: 'INVALID_DATA',
							contractId,
							debtId: r.deuda_id,
							period: schedule.period,
							amountCents: 0,
							reason: `Invalid debt amount: ${r.deuda}`,
						})
						continue
					}

					validCandidates.push({
						row: r,
						period: schedule.period,
						dueDate: schedule.dueDate,
						cutDate: schedule.cutDate,
						amountCents,
					})
				}

				// 2.G. Aplicación de máximo de cuotas recientes por contrato (orden cronológico descendente)
				validCandidates.sort((a, b) => b.dueDate.localeCompare(a.dueDate))

				const candidatesToProcess: ValidCandidateItem[] = []
				const maxRecent = config.maxRecentInstallments

				if (maxRecent !== null && maxRecent > 0 && validCandidates.length > maxRecent) {
					for (let i = 0; i < validCandidates.length; i++) {
						const item = validCandidates[i]
						if (item === undefined) continue
						if (i < maxRecent) {
							candidatesToProcess.push(item)
						} else {
							evaluations.push({
								result: 'EXCLUDED_MAX_INSTALLMENTS',
								contractId,
								debtId: item.row.deuda_id,
								period: item.period,
								amountCents: item.amountCents,
								maxRecent,
								reason: `Exceeds maximum of ${maxRecent} most recent installments`,
							})
						}
					}
				} else {
					for (const item of validCandidates) {
						candidatesToProcess.push(item)
					}
				}

				// 2.H. Procesamiento de candidatos: idempotencia, topes y preparación para persistencia
				for (const candidate of candidatesToProcess) {
					// Idempotencia: comprobar si la cuota ya existe en la base de datos o ya fue evaluada en esta corrida
					const existingInvoice = invoiceRepository.getByExternalDebtId(this.db, candidate.row.deuda_id)
					if (existingInvoice !== null || seenDebtIdsInRun.has(candidate.row.deuda_id)) {
						evaluations.push({
							result: 'ALREADY_IMPORTED',
							contractId,
							debtId: candidate.row.deuda_id,
							period: candidate.period,
							amountCents: candidate.amountCents,
							customerId: normalizedId.normalized,
							reason: 'Installment already imported in Cobrix',
						})
						continue
					}

					// Freno secuencial si un límite fue alcanzado previamente en esta corrida
					if (runHalted) {
						evaluations.push({
							result: 'LIMIT_REACHED',
							contractId,
							debtId: candidate.row.deuda_id,
							period: candidate.period,
							amountCents: candidate.amountCents,
							limitType: haltedLimitType,
							reason: haltedReason,
						})
						continue
					}

					// Tope por cantidad de facturas nuevas en la corrida
					if (config.runInvoiceLimit !== null && config.runInvoiceLimit > 0) {
						if (newInvoicesCount + 1 > config.runInvoiceLimit) {
							runHalted = true
							haltedLimitType = 'INVOICE_LIMIT'
							haltedReason = `Run limit of ${config.runInvoiceLimit} new invoices reached`
							evaluations.push({
								result: 'LIMIT_REACHED',
								contractId,
								debtId: candidate.row.deuda_id,
								period: candidate.period,
								amountCents: candidate.amountCents,
								limitType: haltedLimitType,
								reason: haltedReason,
							})
							continue
						}
					}

					// Tope por monto acumulado nuevo en la corrida
					if (config.runAmountLimitCents !== null && config.runAmountLimitCents > 0) {
						if (newAmountCents + candidate.amountCents > config.runAmountLimitCents) {
							runHalted = true
							haltedLimitType = 'AMOUNT_LIMIT'
							haltedReason = `Run amount limit of ${config.runAmountLimitCents} cents reached`
							evaluations.push({
								result: 'LIMIT_REACHED',
								contractId,
								debtId: candidate.row.deuda_id,
								period: candidate.period,
								amountCents: candidate.amountCents,
								limitType: haltedLimitType,
								reason: haltedReason,
							})
							continue
						}
					}

					// La cuota es válida y se acepta para importación (o simulación)
					seenDebtIdsInRun.add(candidate.row.deuda_id)
					newInvoicesCount++
					newAmountCents += candidate.amountCents

					// Comprobar si el cliente ya existe en SQLite o ya fue registrado en esta corrida
					const existingCustomer = customerRepository.getById(this.db, normalizedId.normalized)
					if (existingCustomer === null && !newCustomerIds.has(normalizedId.normalized)) {
						newCustomerIds.add(normalizedId.normalized)
					}

					const invoiceNumber = isSimulation ? `SIM-${invoiceSequence++}` : formatInvoiceNumber(invoiceSequence++)

					if (!isSimulation) {
						itemsToPersist.push({
							contractId,
							candidate,
							normalizedId,
							invoiceNumber,
						})
					}

					evaluations.push({
						result: 'IMPORTED',
						contractId,
						debtId: candidate.row.deuda_id,
						period: candidate.period,
						amountCents: candidate.amountCents,
						customerId: normalizedId.normalized,
						invoiceNumber,
						reason: isSimulation ? 'Installment would be imported (simulation)' : 'Invoice imported successfully',
					})
				}
			}

			// 3. Calcular resumen y contadores a partir de los resultados reales
			const counters = this.calculateCounters(evaluations, totalContractsInspected, newCustomerIds.size)
			const finishMs = Date.now()
			const finishedAt = new Date(finishMs).toISOString()

			const summary: ImportRunSummary = {
				runId,
				isSimulation,
				startedAt,
				finishedAt,
				durationMs: finishMs - startMs,
				...counters,
			}

			// 4. Persistencia atómica de cambios de negocio y auditoría
			if (!isSimulation) {
				withTransaction(this.db, () => {
					// Conjunto de clientes ya creados dentro de la transacción para evitar duplicados en clientes multi-contrato
					const persistedCustomerIds = new Set<string>()

					for (const item of itemsToPersist) {
						const customerId = item.normalizedId.normalized
						const existingCustomer = customerRepository.getById(this.db, customerId)

						// 1. Crear cliente si no existe en la base de datos ni fue creado en esta transacción
						if (existingCustomer === null && !persistedCustomerIds.has(customerId)) {
							customerRepository.create(this.db, {
								id: customerId,
								originalDocument: item.candidate.row.identificacion_contrato,
								documentType: item.normalizedId.documentType,
								personType: item.normalizedId.personType,
								name: item.candidate.row.nombre_contrato,
								phone: item.candidate.row.telefono,
								email: item.candidate.row.email,
								address: item.candidate.row.direccion,
							})
							customerEventRepository.create(this.db, {
								customerId,
								eventType: 'CUSTOMER_CREATED',
								description: `Cliente ${item.candidate.row.nombre_contrato} creado mediante importación`,
							})
							persistedCustomerIds.add(customerId)
						}

						// 2. Crear o actualizar contrato
						contractRepository.upsert(this.db, {
							id: item.contractId,
							customerId,
							code: item.candidate.row.codigo,
							status: item.candidate.row.estado,
							plan: item.candidate.row.nombre_plan,
							planPriceCents: dollarsToCents(Number(item.candidate.row.precio_servicio)) ?? 0,
							branch: item.candidate.row.nombre_sucursal,
							currency: item.candidate.row.moneda_sigla,
							billingDay: item.candidate.row.dia_cobro,
							cutoffDay: item.candidate.row.dia_corte,
						})

						// 3. Crear factura
						invoiceRepository.create(this.db, {
							invoiceNumber: item.invoiceNumber,
							externalDebtId: item.candidate.row.deuda_id,
							contractId: item.contractId,
							customerId,
							period: item.candidate.period,
							dueDate: item.candidate.dueDate,
							cutDate: item.candidate.cutDate,
							totalAmountCents: item.candidate.amountCents,
							balanceCents: item.candidate.amountCents,
							status: 'OPEN',
						})

						// 4. Registrar evento de factura importada
						customerEventRepository.create(this.db, {
							customerId,
							eventType: 'INVOICE_IMPORTED',
							description: `Factura ${item.invoiceNumber} importada para el periodo ${item.candidate.period}`,
							metadataJson: JSON.stringify({
								externalDebtId: item.candidate.row.deuda_id,
								amountCents: item.candidate.amountCents,
							}),
						})
					}

					// 5. Registrar auditoría de la corrida completada en la misma transacción
					syncRunRepository.create(this.db, {
						id: runId,
						type: 'IMPORT',
						isSimulation: false,
						status: 'COMPLETED',
						startedAt,
						finishedAt,
						summaryJson: JSON.stringify(summary),
					})

					const detailInputs: CreateSyncRunDetailInput[] = evaluations.map(d => ({
						runId,
						contractId: d.contractId,
						debtId: d.debtId,
						period: d.period,
						amountCents: d.amountCents,
						result: d.result,
						reason: d.reason,
					}))
					syncRunRepository.addDetails(this.db, detailInputs)
				})
			} else {
				// En modo simulación no hay mutaciones de negocio; solo se persiste la auditoría
				withTransaction(this.db, () => {
					syncRunRepository.create(this.db, {
						id: runId,
						type: 'IMPORT',
						isSimulation: true,
						status: 'COMPLETED',
						startedAt,
						finishedAt,
						summaryJson: JSON.stringify(summary),
					})

					const detailInputs: CreateSyncRunDetailInput[] = evaluations.map(d => ({
						runId,
						contractId: d.contractId,
						debtId: d.debtId,
						period: d.period,
						amountCents: d.amountCents,
						result: d.result,
						reason: d.reason,
					}))
					syncRunRepository.addDetails(this.db, detailInputs)
				})
			}

			return {
				runId,
				isSimulation,
				status: 'COMPLETED',
				startedAt,
				finishedAt,
				summary,
				details: evaluations,
			}
		} catch (error) {
			const finishMs = Date.now()
			const finishedAt = new Date(finishMs).toISOString()
			const errorMessage = error instanceof Error ? error.message : 'Unknown import error'

			// Si la persistencia falló y fue revertida por ROLLBACK, ninguna cuota quedó realmente importada.
			// Transformamos las evaluaciones tentativas IMPORTED a INVALID_DATA reflejando la reversión.
			const failedEvaluations: ImportItemEvaluation[] = evaluations.map(item => {
				if (item.result === 'IMPORTED') {
					return {
						result: 'INVALID_DATA',
						contractId: item.contractId,
						debtId: item.debtId,
						period: item.period,
						amountCents: item.amountCents,
						reason: `Persistence transaction rolled back: ${errorMessage}`,
					}
				}
				return item
			})

			const failedCounters = this.calculateCounters(failedEvaluations, totalContractsInspected, 0)
			const summary: ImportRunSummary = {
				runId,
				isSimulation,
				startedAt,
				finishedAt,
				durationMs: finishMs - startMs,
				...failedCounters,
			}

			// Registrar auditoría de la corrida fallida mediante una transacción independiente después del rollback
			try {
				withTransaction(this.db, () => {
					syncRunRepository.create(this.db, {
						id: runId,
						type: 'IMPORT',
						isSimulation,
						status: 'FAILED',
						startedAt,
						finishedAt,
						errorMessage,
						summaryJson: JSON.stringify(summary),
					})

					if (failedEvaluations.length > 0) {
						const detailInputs: CreateSyncRunDetailInput[] = failedEvaluations.map(d => ({
							runId,
							contractId: d.contractId,
							debtId: d.debtId,
							period: d.period,
							amountCents: d.amountCents,
							result: d.result,
							reason: d.reason,
						}))
						syncRunRepository.addDetails(this.db, detailInputs)
					}
				})
			} catch {
				// Si falla la transacción independiente de auditoría, se preserva el error original sin ocultarlo.
			}

			return {
				runId,
				isSimulation,
				status: 'FAILED',
				startedAt,
				finishedAt,
				summary,
				details: failedEvaluations,
				errorMessage,
			}
		}
	}

	/**
	 * Deriva los contadores agregados a partir de los resultados de cada cuota evaluada.
	 */
	private calculateCounters(
		evaluations: readonly ImportItemEvaluation[],
		totalContractsInspected: number,
		newCustomersCount: number,
	): ImportRunCounters {
		let importedInvoicesCount = 0
		let importedAmountCents = 0
		let alreadyImportedCount = 0
		let excludedByStatusCount = 0
		let excludedByDocumentTypeCount = 0
		let outOfWindowCount = 0
		let excludedByMaxInstallmentsCount = 0
		let limitReachedCount = 0
		let inconsistentCurrencyCount = 0
		let residualBalanceCount = 0
		let noDebtCount = 0
		let invalidIdentificationCount = 0
		let invalidDataCount = 0

		for (const item of evaluations) {
			switch (item.result) {
				case 'IMPORTED':
					importedInvoicesCount++
					importedAmountCents += item.amountCents
					break
				case 'ALREADY_IMPORTED':
					alreadyImportedCount++
					break
				case 'EXCLUDED_STATUS':
					excludedByStatusCount++
					break
				case 'EXCLUDED_DOCUMENT_TYPE':
					excludedByDocumentTypeCount++
					break
				case 'OUT_OF_WINDOW':
					outOfWindowCount++
					break
				case 'EXCLUDED_MAX_INSTALLMENTS':
					excludedByMaxInstallmentsCount++
					break
				case 'LIMIT_REACHED':
					limitReachedCount++
					break
				case 'INCONSISTENT_CURRENCY':
					inconsistentCurrencyCount++
					break
				case 'RESIDUAL_BALANCE':
					residualBalanceCount++
					break
				case 'NO_DEBT':
					noDebtCount++
					break
				case 'INVALID_IDENTIFICATION':
					invalidIdentificationCount++
					break
				case 'INVALID_DATA':
					invalidDataCount++
					break
			}
		}

		return {
			totalContractsInspected,
			totalInstallmentsEvaluated: evaluations.length,
			importedInvoicesCount,
			importedAmountCents,
			newCustomersCount,
			alreadyImportedCount,
			excludedByStatusCount,
			excludedByDocumentTypeCount,
			outOfWindowCount,
			excludedByMaxInstallmentsCount,
			limitReachedCount,
			inconsistentCurrencyCount,
			residualBalanceCount,
			noDebtCount,
			invalidIdentificationCount,
			invalidDataCount,
		}
	}
}
