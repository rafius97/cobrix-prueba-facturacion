/**
 * Unit tests for Cobrix Phase 1: Domain layer and normalization rules.
 * Reference: docs/ENUNCIADO.md §4 (Clientes, Facturas).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	isDocumentType,
	isDocumentTypeExcluded,
	normalizeIdentification,
	type DocumentType,
} from '../../src/cobrix/domain/identification.ts'
import {
	createInstallmentSchedule,
	parseDebtDetail,
} from '../../src/cobrix/domain/installment.ts'
import {
	centsToDollars,
	dollarsToCents,
	formatUsd,
	isCurrencyInconsistent,
	isResidualAmount,
} from '../../src/cobrix/domain/money.ts'

describe('Domain: Customer Identification Normalization', () => {
	it('normaliza Elena Ruiz (09000123 -> 9000123) sin prefijo y como persona natural', () => {
		const result = normalizeIdentification('09000123')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, '9000123')
		assert.equal(result?.documentType, null)
		assert.equal(result?.numberPart, '9000123')
		assert.equal(result?.personType, 'NATURAL')
	})

	it('normaliza Comercial El Faro (J-40123456-7 -> J401234567) como persona jurídica', () => {
		const result = normalizeIdentification('J-40123456-7')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'J401234567')
		assert.equal(result?.documentType, 'J')
		assert.equal(result?.numberPart, '401234567')
		assert.equal(result?.personType, 'JURIDICA')
	})

	it('normaliza persona jurídica con prefijo G como JURIDICA', () => {
		const result = normalizeIdentification('G-20001234-5')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'G200012345')
		assert.equal(result?.documentType, 'G')
		assert.equal(result?.personType, 'JURIDICA')
	})

	it('normaliza titular natural V-12345678 -> V12345678', () => {
		const result = normalizeIdentification('V-12345678')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'V12345678')
		assert.equal(result?.documentType, 'V')
		assert.equal(result?.personType, 'NATURAL')
	})

	it('normaliza titular extranjero E-81234567 -> E81234567', () => {
		const result = normalizeIdentification('E-81234567')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'E81234567')
		assert.equal(result?.documentType, 'E')
		assert.equal(result?.personType, 'NATURAL')
	})

	it('normaliza pasaporte P-1234567 -> P1234567', () => {
		const result = normalizeIdentification('P-1234567')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'P1234567')
		assert.equal(result?.documentType, 'P')
		assert.equal(result?.personType, 'NATURAL')
	})

	it('limpia espacios, puntos, guiones y letras minúsculas', () => {
		const result = normalizeIdentification(' v. 12.345.678 ')
		assert.notEqual(result, null)
		assert.equal(result?.normalized, 'V12345678')
		assert.equal(result?.documentType, 'V')
	})

	it('descarta identificaciones inválidas', () => {
		assert.equal(normalizeIdentification(''), null)
		assert.equal(normalizeIdentification('   '), null)
		assert.equal(normalizeIdentification('X-12345678'), null) // Letra no permitida
		assert.equal(normalizeIdentification('12345'), null) // Menos de 6 dígitos
		assert.equal(normalizeIdentification('1234567890123'), null) // Más de 12 dígitos
		assert.equal(normalizeIdentification('V-12345ABC'), null) // Contiene letras en el número
		assert.equal(normalizeIdentification('00000000'), null) // Solo ceros
	})

	it('evalúa exclusión por tipo de documento configurado', () => {
		const excluded: readonly DocumentType[] = ['J', 'G']
		assert.equal(isDocumentTypeExcluded('J', excluded), true)
		assert.equal(isDocumentTypeExcluded('G', excluded), true)
		assert.equal(isDocumentTypeExcluded('V', excluded), false)
		assert.equal(isDocumentTypeExcluded('E', excluded), false)
		assert.equal(isDocumentTypeExcluded(null, excluded), false)
	})

	it('valida tipos de documento permitidos con el type guard isDocumentType', () => {
		assert.equal(isDocumentType('V'), true)
		assert.equal(isDocumentType('E'), true)
		assert.equal(isDocumentType('J'), true)
		assert.equal(isDocumentType('G'), true)
		assert.equal(isDocumentType('P'), true)
		assert.equal(isDocumentType('X'), false)
		assert.equal(isDocumentType(''), false)
		assert.equal(isDocumentType('v'), false)
	})
})

describe('Domain: Monetary representation and validation', () => {
	it('convierte dólares a centavos enteros con redondeo seguro', () => {
		assert.equal(dollarsToCents(25), 2500)
		assert.equal(dollarsToCents(1235), 123500)
		assert.equal(dollarsToCents(25.5), 2550)
		assert.equal(dollarsToCents(0.05), 5)
		assert.equal(dollarsToCents(0), 0)
	})

	it('rechaza montos inválidos o negativos', () => {
		assert.equal(dollarsToCents(-10), null)
		assert.equal(dollarsToCents(Number.NaN), null)
		assert.equal(dollarsToCents(Number.POSITIVE_INFINITY), null)
	})

	it('convierte centavos a dólares', () => {
		assert.equal(centsToDollars(2500), 25)
		assert.equal(centsToDollars(123500), 1235)
		assert.equal(centsToDollars(5), 0.05)
	})

	it('formatea montos en USD para presentación', () => {
		const formatted = formatUsd(123500)
		assert.match(formatted, /USD\s+1\.235,00/)
	})

	it('detecta saldo residual de menos de un centavo (§4)', () => {
		assert.equal(isResidualAmount(0), true)
		assert.equal(isResidualAmount(0.001317), true) // Sofía Torres
		assert.equal(isResidualAmount(0.004), true)
		assert.equal(isResidualAmount(0.01), false)
		assert.equal(isResidualAmount(20), false)
	})

	it('detecta moneda incoherente cuando la deuda es menor al 1 % del precio del plan (§4)', () => {
		// Caso Jorge Castillo: plan $20, cuota reportada $0.05 (0.25 % < 1 %)
		assert.equal(isCurrencyInconsistent(0.05, 20), true)

		// Cuota normal: plan $25, deuda $20 (80 %)
		assert.equal(isCurrencyInconsistent(20, 25), false)

		// Límite exacto: 1 % de 100 es 1.00
		assert.equal(isCurrencyInconsistent(0.99, 100), true)
		assert.equal(isCurrencyInconsistent(1.0, 100), false)

		// Planes con precio cero o inválidos
		assert.equal(isCurrencyInconsistent(0.05, 0), false)
	})
})

describe('Domain: Installment schedule and period parsing', () => {
	it('extrae período y vencimiento desde detalle_deuda («PLAN - 2026 Agosto»)', () => {
		const schedule = parseDebtDetail(['PLAN15MB25 - 2026 Agosto'], 0)
		assert.notEqual(schedule, null)
		assert.equal(schedule?.period, '2026-08')
		assert.equal(schedule?.dueDate, '2026-08-01')
		assert.equal(schedule?.cutDate, '2026-08-01')
	})

	it('calcula fecha de corte sumando días de gracia civiles al vencimiento', () => {
		const schedule = parseDebtDetail(['PLAN15MB25 - 2026 Agosto'], 5)
		assert.notEqual(schedule, null)
		assert.equal(schedule?.period, '2026-08')
		assert.equal(schedule?.dueDate, '2026-08-01')
		assert.equal(schedule?.cutDate, '2026-08-06')
	})

	it('construye cronograma a partir de un período canónico YYYY-MM', () => {
		const schedule = createInstallmentSchedule('2026-10', 10)
		assert.notEqual(schedule, null)
		assert.equal(schedule?.period, '2026-10')
		assert.equal(schedule?.dueDate, '2026-10-01')
		assert.equal(schedule?.cutDate, '2026-10-11')
	})

	it('descarta detalle_deuda sin formato de fecha reconocido', () => {
		assert.equal(parseDebtDetail([], 0), null)
		assert.equal(parseDebtDetail(['PLAN_SIN_FECHA'], 0), null)
		assert.equal(parseDebtDetail(['2026 MesInexistente'], 0), null)
	})

	it('rechaza períodos canónicos malformados', () => {
		assert.equal(createInstallmentSchedule('2026-13', 0), null)
		assert.equal(createInstallmentSchedule('invalid', 0), null)
	})
})
