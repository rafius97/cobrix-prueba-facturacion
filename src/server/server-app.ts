/**
 * Servidor HTTP principal de Cobrix.
 * Enruta peticiones hacia la API REST (/api/*), sirve archivos estáticos compilados (dist/client/)
 * y provee fallback determinista para el cliente React Router o el esqueleto legacy.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DatabaseSync } from 'node:sqlite'

import { BillingApiClient } from '../cobrix/client/billing-api-client.ts'
import { createCobrixDatabase } from '../cobrix/db/database.ts'
import type { ApiErrorResponseDto, SyncRunTriggerRequestDto } from '../shared/api-types.ts'
import { getCustomerDossier, getCustomersDirectory } from './api/customers-controller.ts'
import { getDashboardData } from './api/dashboard-controller.ts'
import { getEnunciadoData } from './api/enunciado-controller.ts'
import { isJsonObject, safeJsonParse, type JsonValue } from '../cobrix/history/parsers.ts'
import {
	executeImportSync,
	executePaymentSync,
	getSyncRunDetail,
	getSyncRunsHistory,
	SyncConflictError,
} from './api/sync-controller.ts'
import { serveStatic } from './static-handler.ts'

export interface ServerAppDeps {
	readonly simulatorUrl: string
	readonly assignmentPath: string
	readonly db?: DatabaseSync
	readonly distDir?: string
	readonly legacyHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
	readonly billingClient?: BillingApiClient
}

function sendJson<T>(res: ServerResponse, status: number, data: T): void {
	const body = JSON.stringify(data)
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body),
	})
	res.end(body)
}

class InvalidRequestBodyError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'InvalidRequestBodyError'
	}
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = []
		req.on('data', (chunk: Buffer) => {
			chunks.push(chunk)
		})
		req.on('end', () => {
			resolve(Buffer.concat(chunks).toString('utf-8'))
		})
		req.on('error', err => {
			reject(err)
		})
	})
}

function parseSyncTriggerBody(rawText: string): SyncRunTriggerRequestDto {
	const trimmed = rawText.trim()
	if (trimmed === '') {
		return { isSimulation: false }
	}

	let parsed: JsonValue
	try {
		parsed = safeJsonParse(trimmed)
	} catch {
		throw new InvalidRequestBodyError('Invalid JSON payload in request body')
	}

	if (!isJsonObject(parsed)) {
		throw new InvalidRequestBodyError('Request body must be a JSON object')
	}

	const isSimVal = parsed['isSimulation']

	if (isSimVal !== undefined && typeof isSimVal !== 'boolean') {
		throw new InvalidRequestBodyError('Property "isSimulation" must be a boolean')
	}

	return {
		isSimulation: isSimVal === true,
	}
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIST_DIR = path.resolve(__dirname, '../../dist/client')

export function createServerApp(deps: ServerAppDeps): Server {
	const distDir = deps.distDir ?? DEFAULT_DIST_DIR
	let database: DatabaseSync | null = null

	function resolveDb(): DatabaseSync {
		if (deps.db !== undefined) {
			return deps.db
		}
		if (database === null) {
			database = createCobrixDatabase()
		}
		return database
	}

	async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const rawUrl = req.url ?? '/'
		const url = new URL(rawUrl, 'http://localhost')
		const pathname = url.pathname.replace(/\/+$/, '') || '/'

		// 1. Enrutamiento de la API REST (/api/*)
		if (pathname === '/api/dashboard') {
			if (req.method === 'GET') {
				try {
					const db = resolveDb()
					const dashboardData = getDashboardData(db)
					sendJson(res, 200, dashboardData)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno en dashboard'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname === '/api/enunciado') {
			if (req.method === 'GET') {
				try {
					const data = getEnunciadoData(deps.assignmentPath)
					sendJson(res, 200, data)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno al leer enunciado'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname === '/api/customers') {
			if (req.method === 'GET') {
				try {
					const db = resolveDb()
					const searchParam = url.searchParams.get('search') ?? undefined
					const directoryData = getCustomersDirectory(db, searchParam)
					sendJson(res, 200, directoryData)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno al consultar clientes'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname.startsWith('/api/customers/')) {
			const rawCustomerId = pathname.slice('/api/customers/'.length).trim()
			const customerId = decodeURIComponent(rawCustomerId)
			if (customerId.length === 0) {
				const errorDto: ApiErrorResponseDto = {
					error: 'Missing customer identifier',
					statusCode: 400,
					path: pathname,
				}
				sendJson(res, 400, errorDto)
				return
			}

			if (req.method === 'GET') {
				try {
					const db = resolveDb()
					const dossierData = getCustomerDossier(db, customerId)
					if (dossierData === null) {
						const errorDto: ApiErrorResponseDto = {
							error: `Customer with id "${customerId}" not found`,
							statusCode: 404,
							path: pathname,
						}
						sendJson(res, 404, errorDto)
						return
					}
					sendJson(res, 200, dossierData)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno al consultar expediente'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname === '/api/sync/import') {
			if (req.method === 'POST') {
				try {
					const bodyText = await readRequestBody(req)
					const bodyDto = parseSyncTriggerBody(bodyText)
					const db = resolveDb()
					const result = await executeImportSync(db, {
						isSimulation: bodyDto.isSimulation,
						billingClient: deps.billingClient,
					})
					sendJson(res, 200, result)
					return
				} catch (err) {
					if (err instanceof SyncConflictError) {
						const errorDto: ApiErrorResponseDto = {
							error: err.message,
							statusCode: 409,
							path: pathname,
						}
						sendJson(res, 409, errorDto)
						return
					}
					if (err instanceof InvalidRequestBodyError) {
						const errorDto: ApiErrorResponseDto = {
							error: err.message,
							statusCode: 400,
							path: pathname,
						}
						sendJson(res, 400, errorDto)
						return
					}
					const message = err instanceof Error ? err.message : 'Error interno al ejecutar importación'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname === '/api/sync/payments') {
			if (req.method === 'POST') {
				try {
					const bodyText = await readRequestBody(req)
					const bodyDto = parseSyncTriggerBody(bodyText)
					const db = resolveDb()
					const result = await executePaymentSync(db, {
						isSimulation: bodyDto.isSimulation,
						billingClient: deps.billingClient,
					})
					sendJson(res, 200, result)
					return
				} catch (err) {
					if (err instanceof SyncConflictError) {
						const errorDto: ApiErrorResponseDto = {
							error: err.message,
							statusCode: 409,
							path: pathname,
						}
						sendJson(res, 409, errorDto)
						return
					}
					if (err instanceof InvalidRequestBodyError) {
						const errorDto: ApiErrorResponseDto = {
							error: err.message,
							statusCode: 400,
							path: pathname,
						}
						sendJson(res, 400, errorDto)
						return
					}
					const message = err instanceof Error ? err.message : 'Error interno al sincronizar pagos'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname === '/api/sync/runs') {
			if (req.method === 'GET') {
				try {
					const db = resolveDb()
					const limitParam = url.searchParams.get('limit')
					const limit = limitParam !== null && /^\d+$/.test(limitParam) ? parseInt(limitParam, 10) : undefined
					const data = getSyncRunsHistory(db, limit)
					sendJson(res, 200, data)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno al consultar historial de sincronización'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		if (pathname.startsWith('/api/sync/runs/')) {
			const runId = pathname.slice('/api/sync/runs/'.length).trim()
			if (runId.length === 0) {
				const errorDto: ApiErrorResponseDto = {
					error: 'Missing run identifier',
					statusCode: 400,
					path: pathname,
				}
				sendJson(res, 400, errorDto)
				return
			}

			if (req.method === 'GET') {
				try {
					const db = resolveDb()
					const detailData = getSyncRunDetail(db, runId)
					if (detailData === null) {
						const errorDto: ApiErrorResponseDto = {
							error: `Sync run with id "${runId}" not found`,
							statusCode: 404,
							path: pathname,
						}
						sendJson(res, 404, errorDto)
						return
					}
					sendJson(res, 200, detailData)
					return
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Error interno al consultar detalle de corrida'
					const errorDto: ApiErrorResponseDto = {
						error: message,
						statusCode: 500,
						path: pathname,
					}
					sendJson(res, 500, errorDto)
					return
				}
			}
			const errorDto: ApiErrorResponseDto = {
				error: 'Method Not Allowed',
				statusCode: 405,
				path: pathname,
			}
			sendJson(res, 405, errorDto)
			return
		}

		// Si es cualquier otra ruta que comience por /api/ o sea /api, responder 404 en JSON
		if (pathname.startsWith('/api/') || pathname === '/api') {
			const errorDto: ApiErrorResponseDto = {
				error: 'Endpoint not found',
				statusCode: 404,
				path: pathname,
			}
			sendJson(res, 404, errorDto)
			return
		}

		// 2. Servir archivos estáticos compilados si distDir está configurado
		if (deps.distDir !== undefined) {
			const staticServed = serveStatic(req, res, deps.distDir)
			if (staticServed) {
				return
			}
		}

		// 3. Fallback al manejador legacy del esqueleto si no hay build o no fue servido por estáticos
		if (deps.legacyHandler !== undefined) {
			await deps.legacyHandler(req, res)
			return
		}

		// 4. Si no hay manejador legacy y no se encontró recurso, responder 404
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('Not Found')
	}

	return createServer((req, res) => {
		handleRequest(req, res).catch(err => {
			console.error('[server-app] Unhandled error:', err)
			if (!res.headersSent) {
				const message = err instanceof Error ? err.message : 'Internal Server Error'
				res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
				res.end(message)
			}
		})
	})
}
