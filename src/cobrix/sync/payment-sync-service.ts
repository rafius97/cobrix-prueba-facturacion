/**
 * Servicio de sincronización y conciliación de pagos de Cobrix.
 * Consulta el libro de cuotas y pagos del ISP para conciliar facturas abiertas,
 * marcar facturas pagadas, aplicar abonos parciales y registrar auditoría atómica.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

import { BillingApiClient } from '../client/billing-api-client.ts'
import { BillingApiNotFoundError } from '../client/errors.ts'
import type { IspPaymentBookRow, IspPendingInstallmentRow } from '../client/types.ts'
import { withTransaction } from '../db/database.ts'
import {
	customerEventRepository,
	invoiceRepository,
	syncRunRepository,
} from '../db/repositories.ts'
import type { CreateSyncRunDetailInput, Invoice } from '../db/types.ts'
import { dollarsToCents, formatUsd } from '../domain/money.ts'
import { currentPeriod, today } from '../../shared/dates.ts'
import type {
	PaymentItemEvaluation,
	PaymentSyncCounters,
	PaymentSyncResult,
	PaymentSyncSummary,
	RunPaymentSyncOptions,
} from './payment-types.ts'

/**
 * Representa una acción de pago completo lista para ser persistida en SQLite.
 */
interface PaidInvoiceAction {
	readonly externalDebtId: string
	readonly customerId: string
	readonly invoiceNumber: string
	readonly period: string
	readonly paidAt: string
	readonly ispPaymentInvoice: string
	readonly amountCents: number
}

/**
 * Representa una acción de abono parcial lista para ser persistida en SQLite.
 */
interface PartialPaymentAction {
	readonly externalDebtId: string
	readonly customerId: string
	readonly invoiceNumber: string
	readonly period: string
	readonly previousBalanceCents: number
	readonly newBalanceCents: number
	readonly paidAmountCents: number
}

/**
 * Servicio encargado de orquestar la sincronización y conciliación de pagos con el ISP.
 */
export class PaymentSyncService {
	private readonly db: DatabaseSync
	private readonly client: BillingApiClient

	constructor(db: DatabaseSync, client: BillingApiClient) {
		this.db = db
		this.client = client
	}

	/**
	 * Ejecuta el proceso completo de conciliación de facturas abiertas contra el ISP.
	 */
	async run(options?: RunPaymentSyncOptions): Promise<PaymentSyncResult> {
		const isSimulation = options?.isSimulation ?? false
		const runId = randomUUID()
		const startMs = Date.now()
		const startedAt = new Date(startMs).toISOString()

		const evaluations: PaymentItemEvaluation[] = []
		const paidActions: PaidInvoiceAction[] = []
		const partialActions: PartialPaymentAction[] = []

		// 1. Obtener todas las facturas actualmente abiertas en Cobrix
		const openInvoices = invoiceRepository.listOpen(this.db)
		const totalInvoicesInspected = openInvoices.length

		// Si no hay facturas abiertas, registrar corrida completada con contadores en cero
		if (openInvoices.length === 0) {
			const finishMs = Date.now()
			const finishedAt = new Date(finishMs).toISOString()
			const counters = this.calculateCounters([], 0, 0)
			const summary: PaymentSyncSummary = {
				runId,
				isSimulation,
				startedAt,
				finishedAt,
				durationMs: finishMs - startMs,
				...counters,
			}

			withTransaction(this.db, () => {
				syncRunRepository.create(this.db, {
					id: runId,
					type: 'PAYMENT_UPDATE',
					isSimulation,
					status: 'COMPLETED',
					startedAt,
					finishedAt,
					summaryJson: JSON.stringify(summary),
				})
			})

			return {
				runId,
				runType: 'PAYMENT_UPDATE',
				isSimulation,
				status: 'COMPLETED',
				startedAt,
				finishedAt,
				summary,
				details: [],
			}
		}

		// 2. Determinar la ventana de fechas para la consulta al ISP
		// Si no se suministran fechas, se utiliza el período más antiguo de las facturas abiertas
		// y la fecha actual del sistema como fecha final, evitando la ventana estática desactualizada del ISP.
		const firstInvoice = openInvoices[0]
		const initialMinPeriod = firstInvoice !== undefined ? firstInvoice.period : currentPeriod()
		const minPeriod = openInvoices.reduce((min, inv) => (inv.period < min ? inv.period : min), initialMinPeriod)
		const startDate = options?.startDate ?? `${minPeriod}-01`
		const endDate = options?.endDate ?? today()

		// 3. Agrupar facturas abiertas por contrato para realizar una sola petición por contrato
		const invoicesByContract = new Map<number, Invoice[]>()
		for (const inv of openInvoices) {
			const list = invoicesByContract.get(inv.contractId) ?? []
			list.push(inv)
			invoicesByContract.set(inv.contractId, list)
		}
		const totalContractsInspected = invoicesByContract.size

		// Caché de cuotas pendientes de contratos para fallback (consultadas bajo demanda)
		const pendingRowsCache = new Map<number, readonly IspPendingInstallmentRow[] | null>()

		try {
			// 4. Evaluar cada contrato con facturas abiertas
			for (const [contractId, invoices] of invoicesByContract.entries()) {
				let bookRows: readonly IspPaymentBookRow[]
				try {
					bookRows = await this.client.getPaymentBook({
						id_contrato: contractId,
						tipo_busqueda: 'CUOTA',
						fecha_inicio: startDate,
						fecha_fin: endDate,
					})
				} catch (error) {
					if (error instanceof BillingApiNotFoundError) {
						// Si el contrato no existe en el ISP, registrar las facturas como INVALID_DATA
						for (const inv of invoices) {
							evaluations.push({
								result: 'INVALID_DATA',
								contractId,
								debtId: inv.externalDebtId,
								period: inv.period,
								amountCents: inv.balanceCents,
								invoiceNumber: inv.invoiceNumber,
								customerId: inv.customerId,
								reason: `Contract ${contractId} not found in ISP: ${error.message}`,
							})
						}
						continue
					}
					// Errores globales (autenticación, red) abortan la corrida
					throw error
				}

				// 5. Conciliar cada factura abierta del contrato contra las filas del libro
				for (const inv of invoices) {
					const matchingRows = bookRows.filter(r => String(r.detalle_pago.id_cuota) === inv.externalDebtId)

					// 5.A. La cuota no figura en el libro de pagos: consultar pendientes del contrato
					if (matchingRows.length === 0) {
						const pendingRows = await this.getOrFetchPendingRows(pendingRowsCache, contractId)

						if (pendingRows === null) {
							// El contrato no existe en el ISP (error de consulta 404/17.1 en fallback): INVALID_DATA
							evaluations.push({
								result: 'INVALID_DATA',
								contractId,
								debtId: inv.externalDebtId,
								period: inv.period,
								amountCents: inv.balanceCents,
								invoiceNumber: inv.invoiceNumber,
								customerId: inv.customerId,
								reason: `Contract ${contractId} not found in ISP pending installments fallback`,
							})
							continue
						}

						const pendingRow = pendingRows.find(p => p.deuda_id === inv.externalDebtId)

						if (pendingRow !== undefined && pendingRow.deuda > 0) {
							// La cuota sigue pendiente con saldo en el contrato: permanece abierta sin cambios
							evaluations.push({
								result: 'STILL_OPEN',
								contractId,
								debtId: inv.externalDebtId,
								period: inv.period,
								amountCents: inv.balanceCents,
								invoiceNumber: inv.invoiceNumber,
								customerId: inv.customerId,
								balanceCents: inv.balanceCents,
								reason: 'Installment still pending in contract with active debt',
							})
						} else {
							// Respuesta HTTP exitosa del ISP sin la cuota: sin evidencia de pago (§4)
							evaluations.push({
								result: 'NO_EVIDENCE',
								contractId,
								debtId: inv.externalDebtId,
								period: inv.period,
								amountCents: inv.balanceCents,
								invoiceNumber: inv.invoiceNumber,
								customerId: inv.customerId,
								reason: 'Installment not found in payment book nor pending in contract: missing evidence',
							})
						}
						continue
					}

					// 5.B. Validar consistencia entre múltiples filas para la misma cuota
					const firstDetail = matchingRows[0]?.detalle_pago
					if (firstDetail === undefined) {
						continue
					}
					const refSaldo = firstDetail.saldo_cuota
					const refValorPago = firstDetail.valor_pago
					let hasContradiction = false

					for (const r of matchingRows) {
						if (r.detalle_pago.saldo_cuota !== refSaldo || r.detalle_pago.valor_pago !== refValorPago) {
							hasContradiction = true
							break
						}
					}

					if (hasContradiction) {
						evaluations.push({
							result: 'CONTRADICTORY_DATA',
							contractId,
							debtId: inv.externalDebtId,
							period: inv.period,
							amountCents: inv.balanceCents,
							invoiceNumber: inv.invoiceNumber,
							customerId: inv.customerId,
							reason: 'Multiple payment book rows report conflicting saldo_cuota or valor_pago values',
						})
						continue
					}

					// Conversión monetaria segura a centavos enteros
					const saldoCuotaCents = dollarsToCents(refSaldo)
					const valorPagoCents = dollarsToCents(refValorPago)
					const tariffCents = dollarsToCents(firstDetail.tarifa) ?? inv.totalAmountCents
					const descuentoCents = dollarsToCents(firstDetail.descuento) ?? 0

					if (saldoCuotaCents === null || valorPagoCents === null) {
						evaluations.push({
							result: 'INVALID_DATA',
							contractId,
							debtId: inv.externalDebtId,
							period: inv.period,
							amountCents: inv.balanceCents,
							invoiceNumber: inv.invoiceNumber,
							customerId: inv.customerId,
							reason: `Invalid numeric amounts in payment book: saldo=${refSaldo}, valor_pago=${refValorPago}`,
						})
						continue
					}

					// 5.C. Regla de Exoneración (§4: saldo 0 sin pago efectivo no es un pago)
					if (saldoCuotaCents === 0 && valorPagoCents === 0) {
						evaluations.push({
							result: 'EXEMPTION_NOT_PAYMENT',
							contractId,
							debtId: inv.externalDebtId,
							period: inv.period,
							amountCents: inv.balanceCents,
							invoiceNumber: inv.invoiceNumber,
							customerId: inv.customerId,
							tariffCents,
							discountCents: descuentoCents,
							reason: `Installment exonerated (tariff: ${tariffCents}, discount: ${descuentoCents}): zero balance without actual payment`,
						})
						continue
					}

					// 5.D. Regla de Pago Completo (§4: saldo 0 y evidencia de pago positiva)
					if (saldoCuotaCents === 0 && valorPagoCents > 0) {
						// Seleccionar el comprobante de cobro más reciente de forma determinista
						const paymentRows = matchingRows.filter(r => r.id_factura !== 0)
						paymentRows.sort((a, b) => {
							const cmpDate = b.fecha_emision.localeCompare(a.fecha_emision)
							if (cmpDate !== 0) return cmpDate
							return b.id_factura - a.id_factura
						})
						const bestReceipt = paymentRows[0]
						const fallbackRow = matchingRows[0]
						const paidAt = bestReceipt !== undefined ? bestReceipt.fecha_emision : (fallbackRow !== undefined ? fallbackRow.fecha_emision : today())
						const ispPaymentInvoice = bestReceipt !== undefined ? bestReceipt.num_factura : ''

						if (!isSimulation) {
							paidActions.push({
								externalDebtId: inv.externalDebtId,
								customerId: inv.customerId,
								invoiceNumber: inv.invoiceNumber,
								period: inv.period,
								paidAt,
								ispPaymentInvoice,
								amountCents: inv.balanceCents,
							})
						}

						evaluations.push({
							result: 'MARKED_PAID',
							contractId,
							debtId: inv.externalDebtId,
							period: inv.period,
							amountCents: inv.balanceCents,
							invoiceNumber: inv.invoiceNumber,
							customerId: inv.customerId,
							paidAt,
							ispPaymentInvoice,
							paidAmountCents: valorPagoCents,
							reason: isSimulation ? 'Invoice would be marked as paid in Cobrix (simulation)' : 'Invoice marked as paid in Cobrix',
						})
						continue
					}

					// 5.E. Regla de Abono Parcial (§4: saldo positivo menor al saldo actual en Cobrix)
					if (saldoCuotaCents > 0 && saldoCuotaCents < inv.balanceCents && valorPagoCents > 0) {
						const paidAmountCents = inv.balanceCents - saldoCuotaCents

						if (!isSimulation) {
							partialActions.push({
								externalDebtId: inv.externalDebtId,
								customerId: inv.customerId,
								invoiceNumber: inv.invoiceNumber,
								period: inv.period,
								previousBalanceCents: inv.balanceCents,
								newBalanceCents: saldoCuotaCents,
								paidAmountCents,
							})
						}

						evaluations.push({
							result: 'PARTIAL_PAYMENT',
							contractId,
							debtId: inv.externalDebtId,
							period: inv.period,
							amountCents: inv.balanceCents,
							invoiceNumber: inv.invoiceNumber,
							customerId: inv.customerId,
							previousBalanceCents: inv.balanceCents,
							newBalanceCents: saldoCuotaCents,
							paidAmountCents,
							reason: isSimulation
								? `Partial payment would update balance from ${inv.balanceCents} to ${saldoCuotaCents} cents (simulation)`
								: `Partial payment updated balance from ${inv.balanceCents} to ${saldoCuotaCents} cents`,
						})
						continue
					}

					// 5.F. Regla de Factura que Permanece Abierta sin Cambios (saldo igual o sin cobro nuevo)
					evaluations.push({
						result: 'STILL_OPEN',
						contractId,
						debtId: inv.externalDebtId,
						period: inv.period,
						amountCents: inv.balanceCents,
						invoiceNumber: inv.invoiceNumber,
						customerId: inv.customerId,
						balanceCents: inv.balanceCents,
						reason: 'Installment remains open with no new payment applied',
					})
				}
			}

			// 6. Calcular resumen y contadores agregados
			const counters = this.calculateCounters(evaluations, totalInvoicesInspected, totalContractsInspected)
			const finishMs = Date.now()
			const finishedAt = new Date(finishMs).toISOString()

			const summary: PaymentSyncSummary = {
				runId,
				isSimulation,
				startedAt,
				finishedAt,
				durationMs: finishMs - startMs,
				...counters,
			}

			// 7. Persistencia atómica de mutaciones de negocio y auditoría
			if (!isSimulation) {
				withTransaction(this.db, () => {
					// 7.A. Actualizar facturas pagadas y registrar eventos INVOICE_PAID
					for (const action of paidActions) {
						invoiceRepository.markAsPaid(this.db, action.externalDebtId, {
							paidAt: action.paidAt,
							ispPaymentInvoice: action.ispPaymentInvoice,
						})
						customerEventRepository.create(this.db, {
							customerId: action.customerId,
							eventType: 'INVOICE_PAID',
							description: `Factura ${action.invoiceNumber} pagada en el ISP (comprobante ${action.ispPaymentInvoice})`,
							metadataJson: JSON.stringify({
								externalDebtId: action.externalDebtId,
								ispPaymentInvoice: action.ispPaymentInvoice,
								paidAt: action.paidAt,
								amountCents: action.amountCents,
							}),
						})
					}

					// 7.B. Actualizar saldos de abonos parciales y registrar eventos PARTIAL_PAYMENT
					for (const action of partialActions) {
						invoiceRepository.updateBalance(this.db, action.externalDebtId, action.newBalanceCents)
						customerEventRepository.create(this.db, {
							customerId: action.customerId,
							eventType: 'PARTIAL_PAYMENT',
							description: `Abono parcial en factura ${action.invoiceNumber}: saldo actualizado a ${formatUsd(action.newBalanceCents)}`,
							metadataJson: JSON.stringify({
								externalDebtId: action.externalDebtId,
								previousBalanceCents: action.previousBalanceCents,
								newBalanceCents: action.newBalanceCents,
								paidAmountCents: action.paidAmountCents,
							}),
						})
					}

					// 7.C. Registrar auditoría de la corrida completada
					syncRunRepository.create(this.db, {
						id: runId,
						type: 'PAYMENT_UPDATE',
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
						type: 'PAYMENT_UPDATE',
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
				runType: 'PAYMENT_UPDATE',
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
			const errorMessage = error instanceof Error ? error.message : 'Unknown payment sync error'

			// Si la persistencia falló y fue revertida por ROLLBACK, ninguna factura quedó pagada ni abonada.
			// Transformamos las evaluaciones tentativas MARKED_PAID o PARTIAL_PAYMENT a INVALID_DATA reflejando la reversión.
			const failedEvaluations: PaymentItemEvaluation[] = evaluations.map(item => {
				if (item.result === 'MARKED_PAID' || item.result === 'PARTIAL_PAYMENT') {
					return {
						result: 'INVALID_DATA',
						contractId: item.contractId,
						debtId: item.debtId,
						period: item.period,
						amountCents: item.amountCents,
						invoiceNumber: item.invoiceNumber,
						customerId: item.customerId,
						reason: `Persistence transaction rolled back: ${errorMessage}`,
					}
				}
				return item
			})

			const failedCounters = this.calculateCounters(failedEvaluations, totalInvoicesInspected, totalContractsInspected)
			const summary: PaymentSyncSummary = {
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
						type: 'PAYMENT_UPDATE',
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
				// Si falla también la transacción independiente de auditoría, se preserva el error original sin ocultarlo.
			}

			return {
				runId,
				runType: 'PAYMENT_UPDATE',
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
	 * Consulta cuotas pendientes de un contrato con almacenamiento en caché por corrida.
	 * Devuelve null si el contrato no existe en el ISP (BillingApiNotFoundError), diferenciándolo de un arreglo vacío válido.
	 */
	private async getOrFetchPendingRows(
		cache: Map<number, readonly IspPendingInstallmentRow[] | null>,
		contractId: number,
	): Promise<readonly IspPendingInstallmentRow[] | null> {
		const cached = cache.get(contractId)
		if (cached !== undefined) return cached

		try {
			const rows = await this.client.getPendingInstallments({ id_contrato: contractId })
			cache.set(contractId, rows)
			return rows
		} catch (error) {
			if (error instanceof BillingApiNotFoundError) {
				cache.set(contractId, null)
				return null
			}
			throw error
		}
	}

	/**
	 * Deriva los contadores agregados a partir de los resultados de cada factura abierta evaluada.
	 */
	private calculateCounters(
		evaluations: readonly PaymentItemEvaluation[],
		totalInvoicesInspected: number,
		totalContractsInspected: number,
	): PaymentSyncCounters {
		let markedPaidCount = 0
		let markedPaidAmountCents = 0
		let partialPaymentsCount = 0
		let partialPaymentsAmountCents = 0
		let stillOpenCount = 0
		let stillOpenBalanceCents = 0
		let exemptionCount = 0
		let noEvidenceCount = 0
		let contradictoryDataCount = 0
		let invalidDataCount = 0

		for (const item of evaluations) {
			switch (item.result) {
				case 'MARKED_PAID':
					markedPaidCount++
					markedPaidAmountCents += item.amountCents
					break
				case 'PARTIAL_PAYMENT':
					partialPaymentsCount++
					partialPaymentsAmountCents += item.paidAmountCents
					stillOpenCount++
					stillOpenBalanceCents += item.newBalanceCents
					break
				case 'STILL_OPEN':
					stillOpenCount++
					stillOpenBalanceCents += item.balanceCents
					break
				case 'EXEMPTION_NOT_PAYMENT':
					exemptionCount++
					stillOpenCount++
					stillOpenBalanceCents += item.amountCents
					break
				case 'NO_EVIDENCE':
					noEvidenceCount++
					stillOpenCount++
					stillOpenBalanceCents += item.amountCents
					break
				case 'CONTRADICTORY_DATA':
					contradictoryDataCount++
					stillOpenCount++
					stillOpenBalanceCents += item.amountCents
					break
				case 'INVALID_DATA':
					invalidDataCount++
					stillOpenCount++
					stillOpenBalanceCents += item.amountCents
					break
			}
		}

		return {
			totalInvoicesInspected,
			totalContractsInspected,
			markedPaidCount,
			markedPaidAmountCents,
			partialPaymentsCount,
			partialPaymentsAmountCents,
			stillOpenCount,
			stillOpenBalanceCents,
			exemptionCount,
			noEvidenceCount,
			contradictoryDataCount,
			invalidDataCount,
		}
	}
}
