import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs))
}

/**
 * Formatea un valor monetario expresado en centavos a dólares USD.
 * Ejemplo: 123500 -> "$1,235.00"
 */
export function formatUsd(cents: number): string {
	const dollars = cents / 100
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(dollars)
}

/**
 * Formatea una fecha ISO o civil YYYY-MM-DD para visualización en español.
 */
export function formatDate(dateString: string | null): string {
	if (dateString === null || dateString === '') {
		return '—'
	}
	const parts = dateString.split('T')[0]?.split('-')
	if (parts !== undefined && parts.length === 3) {
		const year = parts[0] ?? ''
		const month = parts[1] ?? ''
		const day = parts[2] ?? ''
		return `${day}/${month}/${year}`
	}
	return dateString
}

/**
 * Formatea una fecha y hora ISO para visualización.
 */
export function formatDateTime(isoString: string | null): string {
	if (isoString === null || isoString === '') {
		return '—'
	}
	try {
		const date = new Date(isoString)
		return date.toLocaleString('es-VE', {
			timeZone: 'America/Caracas',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		})
	} catch {
		return isoString
	}
}
