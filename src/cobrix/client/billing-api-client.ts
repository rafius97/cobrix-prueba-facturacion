/**
 * HTTP client for communicating with the external ISP Billing API.
 * Strictly typed without `any` or `unknown`.
 * No unsafe type assertions (`as`).
 */

import {
	BillingApiAuthError,
	BillingApiError,
	BillingApiHttpError,
	BillingApiNetworkError,
	BillingApiNotFoundError,
	BillingApiResponseError,
	BillingApiValidationError,
} from './errors.ts'
import type {
	AuthSession,
	BillingApiClientOptions,
	IspContractIdsResponse,
	IspContractIndividualParams,
	IspListContractIdsParams,
	IspPaymentBookParams,
	IspPaymentBookResponse,
	IspPaymentBookRow,
	IspPendingInstallmentRow,
	TestConnectionResult,
} from './types.ts'
import {
	parseContractIdsResponse,
	parseJsonSafe,
	parseJsonSafeOrNull,
	parseLoginResponse,
	parsePaymentBookResponse,
	parsePendingInstallmentsResponse,
	tryParseDetailError,
	tryParseValidationErrors,
	type JsonValue,
} from './validators.ts'

const DEFAULT_TIMEOUT_MS = 10_000
const PREEMPTIVE_RENEWAL_WINDOW_MS = 60_000 // 1 minute buffer before token expiration

export class BillingApiClient {
	private readonly baseUrl: string
	private readonly username?: string
	private readonly password?: string
	private readonly timeoutMs: number
	private readonly fetchFn: typeof fetch

	private session: AuthSession | null = null
	private activeLoginPromise: Promise<AuthSession> | null = null

	constructor(options: BillingApiClientOptions) {
		if (!options.baseUrl || typeof options.baseUrl !== 'string' || options.baseUrl.trim() === '') {
			throw new Error('baseUrl option is required and must be a valid URL')
		}
		const trimmed = options.baseUrl.trim().replace(/\/+$/, '')
		this.baseUrl = trimmed.endsWith('/api/v1')
			? trimmed.slice(0, -'/api/v1'.length).replace(/\/+$/, '')
			: trimmed
		this.username = options.username
		this.password = options.password
		this.timeoutMs = options.timeoutMs !== undefined && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
		this.fetchFn = options.fetchFn ?? fetch
	}

	/** Returns current active session in memory, if any. */
	getSession(): AuthSession | null {
		return this.session
	}

	/** Clears in-memory session. */
	clearSession(): void {
		this.session = null
	}

	/**
	 * Parses `access_token_expires_in` as UTC (appending 'Z' if absent)
	 * to prevent ECMAScript local-time distortion.
	 */
	private parseTokenExpiry(expiresInRaw: string): number {
		const utcString = expiresInRaw.endsWith('Z') ? expiresInRaw : `${expiresInRaw}Z`
		const expiresAtMs = Date.parse(utcString)
		if (Number.isNaN(expiresAtMs)) {
			throw new BillingApiResponseError('Invalid token expiration date', {
				endpoint: '/api/v1/usuario/login',
				validationDetails: `Could not parse "${expiresInRaw}" as a valid UTC date`,
			})
		}
		return expiresAtMs
	}

	/**
	 * Performs login against `POST /api/v1/usuario/login`.
	 * Deduplicates concurrent login calls using `activeLoginPromise`.
	 */
	async login(credentials?: { readonly username?: string; readonly password?: string }): Promise<AuthSession> {
		if (this.activeLoginPromise !== null) {
			return this.activeLoginPromise
		}

		const promise = this.executeLogin(credentials)
		this.activeLoginPromise = promise
		try {
			return await promise
		} finally {
			this.activeLoginPromise = null
		}
	}

	private async executeLogin(credentials?: { readonly username?: string; readonly password?: string }): Promise<AuthSession> {
		const user = credentials?.username ?? this.username
		const pass = credentials?.password ?? this.password

		if (!user || !pass) {
			throw new BillingApiAuthError('Credentials not configured for login', {
				endpoint: '/api/v1/usuario/login',
			})
		}

		const raw = await this.request('/api/v1/usuario/login', {
			method: 'POST',
			body: { user_name: user, password: pass },
			authenticated: false,
		})

		const loginResponse = parseLoginResponse(raw, '/api/v1/usuario/login')
		const expiresAtMs = this.parseTokenExpiry(loginResponse.access_token_expires_in)

		const session: AuthSession = {
			accessToken: loginResponse.access_token,
			expiresAtMs,
			username: loginResponse.usuario,
		}

		this.session = session
		return session
	}

	/**
	 * Returns a valid access token, performing preemptive renewal if close to expiry.
	 */
	private async ensureAuthenticated(): Promise<string> {
		const now = Date.now()
		if (this.session !== null && this.session.expiresAtMs - now > PREEMPTIVE_RENEWAL_WINDOW_MS) {
			return this.session.accessToken
		}
		const session = await this.login()
		return session.accessToken
	}

	/**
	 * Low-level reusable HTTP request method.
	 * Handles headers, timeouts, 401 recovery (single retry), and status classification.
	 */
	private async request(
		endpoint: string,
		options: {
			readonly method: 'GET' | 'POST'
			readonly queryParams?: Record<string, string | number | undefined>
			readonly body?: Record<string, string | number | undefined>
			readonly authenticated?: boolean
			readonly isRetry?: boolean
		},
	): Promise<JsonValue> {
		const url = new URL(`${this.baseUrl}${endpoint}`)
		if (options.queryParams) {
			for (const [key, val] of Object.entries(options.queryParams)) {
				if (val !== undefined) {
					url.searchParams.set(key, String(val))
				}
			}
		}

		const headers: Record<string, string> = {
			Accept: 'application/json',
		}

		let token: string | undefined
		if (options.authenticated) {
			token = await this.ensureAuthenticated()
			headers['Authorization'] = `Bearer ${token}`
		}

		let bodyStr: string | undefined
		if (options.body) {
			headers['Content-Type'] = 'application/json'
			bodyStr = JSON.stringify(options.body)
		}

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), this.timeoutMs)

		let res: Response
		try {
			res = await this.fetchFn(url.toString(), {
				method: options.method,
				headers,
				body: bodyStr,
				signal: controller.signal,
			})
		} catch (error) {
			if (error instanceof BillingApiError) {
				throw error
			}
			if (controller.signal.aborted) {
				throw new BillingApiNetworkError(`Request timed out while connecting to ${endpoint}`, {
					endpoint,
					cause: error instanceof Error ? error : undefined,
				})
			}
			throw new BillingApiNetworkError(`Network error while connecting to ${endpoint}`, {
				endpoint,
				cause: error instanceof Error ? error : undefined,
			})
		} finally {
			clearTimeout(timer)
		}

		const responseText = await res.text()

		if (!res.ok) {
			// Handle HTTP 401: Invalidate and retry once if authenticated
			if (res.status === 401) {
				if (options.authenticated && !options.isRetry) {
					// Invalidate session only if it has not already been renewed by another concurrent request
					if (this.session !== null && this.session.accessToken === token) {
						this.session = null
					}
					return this.request(endpoint, {
						...options,
						isRetry: true,
					})
				}
				const detail = tryParseDetailError(parseJsonSafeOrNull(responseText))
				throw new BillingApiAuthError('Unauthorized: invalid session or rejected credentials', {
					endpoint,
					statusCode: 401,
					responseBodyText: responseText,
					detail: detail ?? undefined,
				})
			}

			const parsedErrorJson = parseJsonSafeOrNull(responseText)

			// Handle HTTP 400 Bad Request
			if (res.status === 400) {
				if (parsedErrorJson !== null) {
					const validationErrors = tryParseValidationErrors(parsedErrorJson)
					if (validationErrors !== null) {
						throw new BillingApiValidationError('Parameter validation error', {
							endpoint,
							statusCode: 400,
							responseBodyText: responseText,
							validationErrors,
						})
					}

					const detail = tryParseDetailError(parsedErrorJson)
					if (detail !== null) {
						if (detail.type === 'parametros' && detail.mensaje.includes('17.1) No se pudo recuperar la informacion')) {
							throw new BillingApiNotFoundError('Contract not found', {
								endpoint,
								statusCode: 400,
								responseBodyText: responseText,
								detail,
							})
						}
						if (detail.type === 'email' || detail.type === 'password') {
							throw new BillingApiAuthError(`Authentication error: ${detail.mensaje}`, {
								endpoint,
								statusCode: 400,
								responseBodyText: responseText,
								detail,
							})
						}
						throw new BillingApiHttpError(`Request error: ${detail.mensaje}`, {
							endpoint,
							statusCode: 400,
							responseBodyText: responseText,
						})
					}
				}
				throw new BillingApiHttpError('Invalid request (HTTP 400)', {
					endpoint,
					statusCode: 400,
					responseBodyText: responseText,
				})
			}

			// Handle HTTP 404 Not Found
			if (res.status === 404) {
				throw new BillingApiNotFoundError('Resource not found (HTTP 404)', {
					endpoint,
					statusCode: 404,
					responseBodyText: responseText,
				})
			}

			// Other HTTP errors (4xx, 5xx)
			throw new BillingApiHttpError(`HTTP error ${res.status}`, {
				endpoint,
				statusCode: res.status,
				responseBodyText: responseText,
			})
		}

		return parseJsonSafe(responseText, endpoint)
	}

	/**
	 * Lists contract IDs from `GET /api/v1/isp/lista_ids_contratos`.
	 * Does not send `estado` when empty to avoid restricting to active contracts only.
	 */
	async listContractIds(params?: IspListContractIdsParams): Promise<readonly number[]> {
		const envelope = await this.listContractIdsEnvelope(params)
		return envelope.data
	}

	/**
	 * Lists contract IDs returning the full envelope with pagination metadata.
	 */
	async listContractIdsEnvelope(params?: IspListContractIdsParams): Promise<IspContractIdsResponse> {
		const queryParams: Record<string, string | number | undefined> = {}
		if (params?.estado && params.estado.trim() !== '') {
			queryParams['estado'] = params.estado
		}
		if (params?.id_sucursal !== undefined) queryParams['id_sucursal'] = params.id_sucursal
		if (params?.id_empresa !== undefined) queryParams['id_empresa'] = params.id_empresa
		if (params?.page !== undefined) queryParams['page'] = params.page
		if (params?.per_page !== undefined) queryParams['per_page'] = params.per_page

		const raw = await this.request('/api/v1/isp/lista_ids_contratos', {
			method: 'GET',
			queryParams,
			authenticated: true,
		})

		return parseContractIdsResponse(raw, '/api/v1/isp/lista_ids_contratos')
	}

	/**
	 * Retrieves pending installments for a contract from `GET /api/v1/isp/contrato/individual`.
	 * Preserves the unwrapped flat array returned by the API.
	 */
	async getPendingInstallments(params: IspContractIndividualParams): Promise<readonly IspPendingInstallmentRow[]> {
		const queryParams: Record<string, string | number | undefined> = {}
		if (params.id_contrato !== undefined) queryParams['id_contrato'] = params.id_contrato
		if (params.codigo !== undefined) queryParams['codigo'] = params.codigo
		if (params.identificacion !== undefined) queryParams['identificacion'] = params.identificacion

		const raw = await this.request('/api/v1/isp/contrato/individual', {
			method: 'GET',
			queryParams,
			authenticated: true,
		})

		return parsePendingInstallmentsResponse(raw, '/api/v1/isp/contrato/individual')
	}

	/**
	 * Retrieves payment book rows from `GET /api/v1/isp/pago_informacion`.
	 * Always requires explicit dates to avoid using the ISP's default stale window.
	 */
	async getPaymentBook(params: IspPaymentBookParams): Promise<readonly IspPaymentBookRow[]> {
		const envelope = await this.getPaymentBookEnvelope(params)
		return envelope.data
	}

	/**
	 * Retrieves payment book envelope from `GET /api/v1/isp/pago_informacion`.
	 */
	async getPaymentBookEnvelope(params: IspPaymentBookParams): Promise<IspPaymentBookResponse> {
		const queryParams: Record<string, string | number | undefined> = {
			id_contrato: params.id_contrato,
			tipo_busqueda: params.tipo_busqueda,
		}
		if (params.fecha_inicio !== undefined) queryParams['fecha_inicio'] = params.fecha_inicio
		if (params.fecha_fin !== undefined) queryParams['fecha_fin'] = params.fecha_fin

		const raw = await this.request('/api/v1/isp/pago_informacion', {
			method: 'GET',
			queryParams,
			authenticated: true,
		})

		return parsePaymentBookResponse(raw, '/api/v1/isp/pago_informacion')
	}

	/**
	 * Tests connection to the ISP Billing API by logging in and reading contract IDs.
	 */
	async testConnection(): Promise<TestConnectionResult> {
		try {
			await this.ensureAuthenticated()
			const ids = await this.listContractIds()
			return {
				ok: true,
				totalContracts: ids.length,
				message: `Connection successful. Retrieved ${ids.length} contracts from ISP.`,
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown connection error'
			return {
				ok: false,
				totalContracts: 0,
				message,
			}
		}
	}
}
