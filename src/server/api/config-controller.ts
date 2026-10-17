/**
 * Controlador de API para la configuración del sistema Cobrix (/api/config/*).
 * Permite consultar y actualizar los parámetros de la empresa y del proveedor ISP,
 * y ejecutar pruebas de conexión contra la API externa sin persistir credenciales.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones inseguras (`as`).
 */

import type { DatabaseSync } from 'node:sqlite'

import { BillingApiClient } from '../../cobrix/client/billing-api-client.ts'
import { configRepository } from '../../cobrix/db/repositories.ts'
import type { CobrixConfig, UpdateConfigInput } from '../../cobrix/db/types.ts'
import { isDocumentType, type DocumentType } from '../../cobrix/domain/identification.ts'
import type { JsonObject, JsonValue } from '../../cobrix/history/parsers.ts'
import type {
	ConfigResponseDto,
	TestConnectionRequestDto,
	TestConnectionResponseDto,
	UpdateConfigRequestDto,
} from '../../shared/api-types.ts'
import { isSyncRunning, SyncConflictError } from './sync-controller.ts'

export class ConfigValidationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'ConfigValidationError'
	}
}

/**
 * Mapea la entidad CobrixConfig a su DTO de respuesta pública.
 * Garantiza que `apiPassword` nunca sea expuesto.
 */
export function mapConfigToDto(config: CobrixConfig): ConfigResponseDto {
	return {
		companyName: config.companyName,
		companyTaxId: config.companyTaxId,
		companyEmail: config.companyEmail,
		apiUrl: config.apiUrl,
		apiUsername: config.apiUsername,
		importableStatuses: config.importableStatuses,
		windowMonths: config.windowMonths,
		maxRecentInstallments: config.maxRecentInstallments,
		graceDays: config.graceDays,
		runInvoiceLimit: config.runInvoiceLimit,
		runAmountLimitCents: config.runAmountLimitCents,
		excludedDocumentTypes: config.excludedDocumentTypes,
		autoRunHour: config.autoRunHour,
		autoRunActive: config.autoRunActive,
		lastAutoRunDate: config.lastAutoRunDate,
		lastAutoRunStatus: config.lastAutoRunStatus,
	}
}

/**
 * Validador estricto de la petición de actualización de configuración.
 * Comprueba tipos, rangos respaldados y exclusión de cadenas vacías para contraseñas.
 */
export function validateAndParseUpdateConfig(json: JsonObject): UpdateConfigInput {
	const result: {
		companyName?: string
		companyTaxId?: string
		companyEmail?: string
		apiUrl?: string
		apiUsername?: string
		apiPassword?: string
		importableStatuses?: readonly string[]
		windowMonths?: number | null
		maxRecentInstallments?: number | null
		graceDays?: number
		runInvoiceLimit?: number | null
		runAmountLimitCents?: number | null
		excludedDocumentTypes?: readonly DocumentType[]
		autoRunHour?: string
		autoRunActive?: boolean
	} = {}

	// 1. companyName
	if (json['companyName'] !== undefined) {
		const val = json['companyName']
		if (typeof val !== 'string' || val.trim().length === 0) {
			throw new ConfigValidationError('Property "companyName" must be a non-empty string')
		}
		result.companyName = val.trim()
	}

	// 2. companyTaxId
	if (json['companyTaxId'] !== undefined) {
		const val = json['companyTaxId']
		if (typeof val !== 'string' || val.trim().length === 0) {
			throw new ConfigValidationError('Property "companyTaxId" must be a non-empty string')
		}
		result.companyTaxId = val.trim()
	}

	// 3. companyEmail
	if (json['companyEmail'] !== undefined) {
		const val = json['companyEmail']
		if (typeof val !== 'string' || val.trim().length === 0 || !val.includes('@')) {
			throw new ConfigValidationError('Property "companyEmail" must be a valid email address')
		}
		result.companyEmail = val.trim()
	}

	// 4. apiUrl
	if (json['apiUrl'] !== undefined) {
		const val = json['apiUrl']
		if (typeof val !== 'string' || val.trim().length === 0 || !/^https?:\/\//i.test(val.trim())) {
			throw new ConfigValidationError('Property "apiUrl" must be a valid HTTP/HTTPS URL')
		}
		result.apiUrl = val.trim()
	}

	// 5. apiUsername
	if (json['apiUsername'] !== undefined) {
		const val = json['apiUsername']
		if (typeof val !== 'string' || val.trim().length === 0) {
			throw new ConfigValidationError('Property "apiUsername" must be a non-empty string')
		}
		result.apiUsername = val.trim()
	}

	// 6. apiPassword (solo si es no vacío; cadena vacía o espacios se ignoran para no borrar contraseña)
	if (json['apiPassword'] !== undefined) {
		const val = json['apiPassword']
		if (typeof val !== 'string') {
			throw new ConfigValidationError('Property "apiPassword" must be a string')
		}
		if (val.trim().length > 0) {
			result.apiPassword = val
		}
	}

	// 7. importableStatuses
	if (json['importableStatuses'] !== undefined) {
		const val = json['importableStatuses']
		if (!Array.isArray(val)) {
			throw new ConfigValidationError('Property "importableStatuses" must be an array of strings')
		}
		const statuses: string[] = []
		for (const item of val) {
			if (typeof item !== 'string' || item.trim().length === 0) {
				throw new ConfigValidationError('Each item in "importableStatuses" must be a non-empty string')
			}
			statuses.push(item.trim().toUpperCase())
		}
		result.importableStatuses = statuses
	}

	// 8. windowMonths (3, 6, 9, 12 o null/undefined)
	if (json['windowMonths'] !== undefined) {
		const val = json['windowMonths']
		if (val === null) {
			result.windowMonths = null
		} else if (typeof val === 'number') {
			if (val !== 3 && val !== 6 && val !== 9 && val !== 12) {
				throw new ConfigValidationError('Property "windowMonths" must be 3, 6, 9, 12 or null')
			}
			result.windowMonths = val
		} else {
			throw new ConfigValidationError('Property "windowMonths" must be a number or null')
		}
	}

	// 9. maxRecentInstallments (1 a 60 o null)
	if (json['maxRecentInstallments'] !== undefined) {
		const val = json['maxRecentInstallments']
		if (val === null) {
			result.maxRecentInstallments = null
		} else if (typeof val === 'number') {
			if (!Number.isInteger(val) || val < 1 || val > 60) {
				throw new ConfigValidationError('Property "maxRecentInstallments" must be an integer between 1 and 60, or null')
			}
			result.maxRecentInstallments = val
		} else {
			throw new ConfigValidationError('Property "maxRecentInstallments" must be a number or null')
		}
	}

	// 10. graceDays (0 a 60)
	if (json['graceDays'] !== undefined) {
		const val = json['graceDays']
		if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 60) {
			throw new ConfigValidationError('Property "graceDays" must be an integer between 0 and 60')
		}
		result.graceDays = val
	}

	// 11. runInvoiceLimit (entero positivo o null)
	if (json['runInvoiceLimit'] !== undefined) {
		const val = json['runInvoiceLimit']
		if (val === null) {
			result.runInvoiceLimit = null
		} else if (typeof val === 'number') {
			if (!Number.isInteger(val) || val < 1) {
				throw new ConfigValidationError('Property "runInvoiceLimit" must be a positive integer or null')
			}
			result.runInvoiceLimit = val
		} else {
			throw new ConfigValidationError('Property "runInvoiceLimit" must be a number or null')
		}
	}

	// 12. runAmountLimitCents (entero no negativo en centavos o null)
	if (json['runAmountLimitCents'] !== undefined) {
		const val = json['runAmountLimitCents']
		if (val === null) {
			result.runAmountLimitCents = null
		} else if (typeof val === 'number') {
			if (!Number.isInteger(val) || val < 0) {
				throw new ConfigValidationError('Property "runAmountLimitCents" must be a non-negative integer or null')
			}
			result.runAmountLimitCents = val
		} else {
			throw new ConfigValidationError('Property "runAmountLimitCents" must be a number or null')
		}
	}

	// 13. excludedDocumentTypes (array de V, E, J, G, P)
	if (json['excludedDocumentTypes'] !== undefined) {
		const val = json['excludedDocumentTypes']
		if (!Array.isArray(val)) {
			throw new ConfigValidationError('Property "excludedDocumentTypes" must be an array of document types')
		}
		const docTypes: DocumentType[] = []
		for (const item of val) {
			if (typeof item !== 'string' || !isDocumentType(item)) {
				throw new ConfigValidationError(`Invalid document type in excludedDocumentTypes: ${String(item)}`)
			}
			docTypes.push(item)
		}
		result.excludedDocumentTypes = docTypes
	}

	// 14. autoRunHour (formato HH:MM)
	if (json['autoRunHour'] !== undefined) {
		const val = json['autoRunHour']
		if (typeof val !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(val.trim())) {
			throw new ConfigValidationError('Property "autoRunHour" must be a string formatted as HH:MM (24-hour)')
		}
		result.autoRunHour = val.trim()
	}

	// 15. autoRunActive (boolean)
	if (json['autoRunActive'] !== undefined) {
		const val = json['autoRunActive']
		if (typeof val !== 'boolean') {
			throw new ConfigValidationError('Property "autoRunActive" must be a boolean')
		}
		result.autoRunActive = val
	}

	return result
}

/**
 * Consulta la configuración del sistema Cobrix (GET /api/config).
 */
export function getCobrixConfig(db: DatabaseSync): ConfigResponseDto {
	const config = configRepository.get(db)
	return mapConfigToDto(config)
}

/**
 * Actualiza la configuración del sistema Cobrix (PUT /api/config).
 * Lanza SyncConflictError (409) si hay una sincronización en ejecución.
 */
export function updateCobrixConfig(db: DatabaseSync, input: UpdateConfigInput): ConfigResponseDto {
	if (isSyncRunning()) {
		throw new SyncConflictError('Cannot update configuration while a synchronization operation is in progress')
	}

	const updated = configRepository.update(db, input)
	return mapConfigToDto(updated)
}

/**
 * Prueba la conexión con el ISP utilizando temporalmente las credenciales provistas o las almacenadas.
 * No guarda nada en base de datos.
 */
export async function testIspConnection(
	db: DatabaseSync,
	payload: TestConnectionRequestDto,
	customBillingClient?: BillingApiClient,
): Promise<TestConnectionResponseDto> {
	// Si se proporciona un cliente mock para tests, usarlo directamente
	if (customBillingClient !== undefined) {
		try {
			const envelope = await customBillingClient.listContractIdsEnvelope({ per_page: 1 })
			return {
				success: true,
				totalContracts: envelope.pagination.total,
				message: `Conexión exitosa. Se detectaron ${envelope.pagination.total} contratos en el ISP.`,
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Error desconocido al conectar con el ISP'
			return {
				success: false,
				message: `Error de conexión con el ISP: ${msg}`,
			}
		}
	}

	// Obtener la configuración actual de Cobrix como fallback si algún campo de credencial no se especificó
	const current = configRepository.get(db)

	const apiUrl = payload.apiUrl !== undefined && payload.apiUrl.trim().length > 0
		? payload.apiUrl.trim()
		: current.apiUrl
	const apiUsername = payload.apiUsername !== undefined && payload.apiUsername.trim().length > 0
		? payload.apiUsername.trim()
		: current.apiUsername
	const apiPassword = payload.apiPassword !== undefined && payload.apiPassword.length > 0
		? payload.apiPassword
		: current.apiPassword

	const client = new BillingApiClient({
		baseUrl: apiUrl,
		username: apiUsername,
		password: apiPassword,
	})

	try {
		// Ejecuta autenticación y consulta paginada mínima (per_page: 1) para obtener el total de contratos
		const envelope = await client.listContractIdsEnvelope({ per_page: 1 })
		const total = envelope.pagination.total

		return {
			success: true,
			totalContracts: total,
			message: `Conexión exitosa. Se detectaron ${total} contratos en el ISP.`,
		}
	} catch (err) {
		const msg = err instanceof Error ? err.message : 'Error desconocido al conectar con el ISP'
		return {
			success: false,
			message: `Error de conexión con el ISP: ${msg}`,
		}
	}
}
