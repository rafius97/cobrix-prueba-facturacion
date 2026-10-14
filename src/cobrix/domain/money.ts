/**
 * Monetary representation and calculations in integer minor units (cents).
 * Reference: docs/ENUNCIADO.md §4 (Facturas).
 */

const CURRENCY_FORMATTER = new Intl.NumberFormat('es-VE', {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
})

/**
 * Converts a floating-point dollar amount to integer minor units (cents).
 * Returns null if the amount is not a finite non-negative number.
 */
export function dollarsToCents(dollars: number): number | null {
	if (!Number.isFinite(dollars) || dollars < 0) {
		return null
	}
	return Math.round(dollars * 100)
}

/**
 * Converts integer cents back to floating-point dollars for display or external consumption.
 */
export function centsToDollars(cents: number): number {
	return cents / 100
}

/**
 * Formats integer cents into a localized USD string, e.g. "USD 1.235,00".
 */
export function formatUsd(cents: number): string {
	return `USD ${CURRENCY_FORMATTER.format(cents / 100)}`
}

/**
 * Determines whether a balance represents a residual amount of less than one cent ($0.01).
 * Installments with debt < $0.01 are discarded according to §4:
 * "Una cuota con deuda 0 (saldo residual de menos de un centavo) no se importa."
 */
export function isResidualAmount(amountInDollars: number): boolean {
	if (!Number.isFinite(amountInDollars) || amountInDollars < 0) return true
	return Math.round(amountInDollars * 100) <= 0
}

/**
 * Checks if an installment exhibits inconsistent currency.
 * Reference: docs/ENUNCIADO.md §4:
 * "Un contrato que la API reporta en USD pero con cuotas absurdamente bajas
 * frente al precio del plan (menos del 1 %) se descarta por moneda incoherente."
 */
export function isCurrencyInconsistent(debtInDollars: number, planPriceInDollars: number): boolean {
	if (!Number.isFinite(debtInDollars) || !Number.isFinite(planPriceInDollars)) return false
	if (planPriceInDollars <= 0) return false
	return debtInDollars < planPriceInDollars * 0.01
}
