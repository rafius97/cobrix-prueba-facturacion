/**
 * Customer identification normalization and person classification rules.
 * Reference: docs/ENUNCIADO.md §4 (Clientes).
 */

export type DocumentType = 'V' | 'E' | 'J' | 'G' | 'P'
export type PersonType = 'NATURAL' | 'JURIDICA'

export interface NormalizedIdentification {
	readonly identification: string
	readonly normalized: string
	readonly documentType: DocumentType | null
	readonly numberPart: string
	readonly personType: PersonType
}

/**
 * Type guard for valid customer document types (V, E, J, G, P).
 */
export function isDocumentType(letter: string): letter is DocumentType {
	return letter === 'V' || letter === 'E' || letter === 'J' || letter === 'G' || letter === 'P'
}

/**
 * Normalizes an ISP customer identification:
 * - Optional prefix letter (V, E, J, G, P).
 * - Separators (hyphens, dots, spaces) are stripped.
 * - Leading zeros in the number part are removed.
 * - Number part must have between 6 and 12 digits (inclusive).
 * - J and G represent legal entities (JURIDICA); all others are natural persons (NATURAL).
 *
 * Returns null if the identification is malformed or out of bounds.
 */
export function normalizeIdentification(identification: string): NormalizedIdentification | null {
	const trimmed = identification.trim()
	if (trimmed.length === 0) return null

	// Match optional single letter prefix followed by separators and digits
	const prefixMatch = /^[A-Za-z]/.exec(trimmed)
	let documentType: DocumentType | null = null
	let remainder = trimmed

	if (prefixMatch !== null) {
		const rawPrefix = prefixMatch[0]
		if (rawPrefix === undefined) return null
		const identificationLetter = rawPrefix.toUpperCase()
		if (!isDocumentType(identificationLetter)) return null
		documentType = identificationLetter
		remainder = trimmed.slice(1)
	}

	// Remove common separators: hyphens, dots, spaces
	const cleanedDigits = remainder.replaceAll(/[\s.-]/g, '')

	// Must contain only digits
	if (!/^\d+$/.test(cleanedDigits)) return null

	// Strip leading zeros
	const numberPart = cleanedDigits.replace(/^0+/, '')

	// Digit count must be between 6 and 12 digits
	if (numberPart.length < 6 || numberPart.length > 12) return null

	const normalized = documentType !== null ? `${documentType}${numberPart}` : numberPart
	const personType: PersonType = documentType === 'J' || documentType === 'G' ? 'JURIDICA' : 'NATURAL'

	return {
		identification,
		normalized,
		documentType,
		numberPart,
		personType,
	}
}

/**
 * Evaluates whether a customer document type matches the configured exclusion list.
 */
export function isDocumentTypeExcluded(
	documentType: DocumentType | null,
	excludedTypes: readonly DocumentType[],
): boolean {
	if (documentType === null) return false
	return excludedTypes.includes(documentType)
}
