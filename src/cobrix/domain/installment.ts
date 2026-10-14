/**
 * Installment period, due date and cut-off schedule calculation.
 * Reference: docs/ENUNCIADO.md §4 (Facturas).
 */

import { addCivilDays } from '../../shared/dates.ts'

export interface InstallmentSchedule {
	readonly period: string // YYYY-MM
	readonly dueDate: string // YYYY-MM-01
	readonly cutDate: string // YYYY-MM-DD (dueDate + graceDays)
}

const SPANISH_MONTHS: Readonly<Record<string, string>> = {
	enero: '01',
	febrero: '02',
	marzo: '03',
	abril: '04',
	mayo: '05',
	junio: '06',
	julio: '07',
	agosto: '08',
	septiembre: '09',
	octubre: '10',
	noviembre: '11',
	diciembre: '12',
}

/**
 * Extracts the period and dueDate from the ISP installment description array.
 * Example: ["PLAN15MB25 - 2026 Agosto"] -> period: "2026-08", dueDate: "2026-08-01".
 * Calculates cutDate as dueDate plus graceDays (0 to 60 days).
 */
export function parseDebtDetail(
	debtDetail: readonly string[],
	graceDays: number,
): InstallmentSchedule | null {
	for (const item of debtDetail) {
		const match = /(?:^|\s)(\d{4})\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)(?:\s|$)/.exec(item)
		if (match === null) continue

		const year = match[1]
		const rawMonth = match[2]?.toLowerCase()
		if (year === undefined || rawMonth === undefined) continue

		const month = SPANISH_MONTHS[rawMonth]
		if (month === undefined) continue

		const period = `${year}-${month}`
		return createInstallmentSchedule(period, graceDays)
	}
	return null
}

/**
 * Constructs an InstallmentSchedule directly from a canonical period string ("YYYY-MM").
 * Validates format and applies grace days to compute the cut-off date.
 */
export function createInstallmentSchedule(
	period: string,
	graceDays: number,
): InstallmentSchedule | null {
	if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period)) {
		return null
	}
	const safeGrace = Math.max(0, Math.min(60, Math.floor(graceDays)))
	const dueDate = `${period}-01`
	const cutDate = addCivilDays(dueDate, safeGrace)

	return {
		period,
		dueDate,
		cutDate,
	}
}
