/**
 * Typed error hierarchy for Cobrix BillingApiClient.
 * Strictly typed without `any` or `unknown`.
 */

import type { IspDetailErrorItem, IspValidationErrorItem } from './types.ts'

export class BillingApiError extends Error {
	readonly endpoint: string
	readonly statusCode?: number
	readonly responseBodyText?: string

	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode?: number
			readonly responseBodyText?: string
			readonly cause?: Error
		},
	) {
		super(message, options.cause ? { cause: options.cause } : undefined)
		this.name = 'BillingApiError'
		this.endpoint = options.endpoint
		this.statusCode = options.statusCode
		this.responseBodyText = options.responseBodyText
	}
}

/**
 * Thrown when network transport fails or the request times out before receiving an HTTP response.
 */
export class BillingApiNetworkError extends BillingApiError {
	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly cause?: Error
		},
	) {
		super(message, {
			endpoint: options.endpoint,
			cause: options.cause,
		})
		this.name = 'BillingApiNetworkError'
	}
}

/**
 * Thrown when authentication fails (HTTP 401 or invalid credentials).
 */
export class BillingApiAuthError extends BillingApiError {
	readonly detail?: IspDetailErrorItem

	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode?: number
			readonly responseBodyText?: string
			readonly detail?: IspDetailErrorItem
			readonly cause?: Error
		},
	) {
		super(message, {
			endpoint: options.endpoint,
			statusCode: options.statusCode ?? 401,
			responseBodyText: options.responseBodyText,
			cause: options.cause,
		})
		this.name = 'BillingApiAuthError'
		this.detail = options.detail
	}
}

/**
 * Thrown when the external API returns an HTTP 4xx or 5xx error status.
 */
export class BillingApiHttpError extends BillingApiError {
	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode: number
			readonly responseBodyText?: string
			readonly cause?: Error
		},
	) {
		super(message, options)
		this.name = 'BillingApiHttpError'
	}
}

/**
 * Thrown when the external API returns HTTP 400 with parameter validation errors.
 */
export class BillingApiValidationError extends BillingApiHttpError {
	readonly validationErrors?: readonly IspValidationErrorItem[]

	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode?: number
			readonly responseBodyText?: string
			readonly validationErrors?: readonly IspValidationErrorItem[]
			readonly cause?: Error
		},
	) {
		super(message, {
			endpoint: options.endpoint,
			statusCode: options.statusCode ?? 400,
			responseBodyText: options.responseBodyText,
			cause: options.cause,
		})
		this.name = 'BillingApiValidationError'
		this.validationErrors = options.validationErrors
	}
}

/**
 * Thrown when a requested resource is not found (HTTP 404 or contract not found via HTTP 400 error detail).
 */
export class BillingApiNotFoundError extends BillingApiError {
	readonly detail?: IspDetailErrorItem

	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode?: number
			readonly responseBodyText?: string
			readonly detail?: IspDetailErrorItem
			readonly cause?: Error
		},
	) {
		super(message, {
			endpoint: options.endpoint,
			statusCode: options.statusCode ?? 404,
			responseBodyText: options.responseBodyText,
			cause: options.cause,
		})
		this.name = 'BillingApiNotFoundError'
		this.detail = options.detail
	}
}

/**
 * Thrown when the external API response payload cannot be parsed or violates the expected contract/schema.
 */
export class BillingApiResponseError extends BillingApiError {
	readonly validationDetails?: string

	constructor(
		message: string,
		options: {
			readonly endpoint: string
			readonly statusCode?: number
			readonly responseBodyText?: string
			readonly validationDetails?: string
			readonly cause?: Error
		},
	) {
		super(message, options)
		this.name = 'BillingApiResponseError'
		this.validationDetails = options.validationDetails
	}
}
