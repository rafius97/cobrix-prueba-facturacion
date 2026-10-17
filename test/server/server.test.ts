/**
 * Pruebas de la capa HTTP: endpoints de API REST, seguridad de estáticos y fallbacks.
 * Escrito en TypeScript estricto sin `any` ni `unknown`.
 */

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createCobrixDatabase } from '../../src/cobrix/db/database.ts'
import { createServerApp } from '../../src/server/server-app.ts'
import type { ApiErrorResponseDto, DashboardResponseDto, EnunciadoResponseDto } from '../../src/shared/api-types.ts'

describe('Servidor HTTP: API REST y entrega de estáticos', () => {
	let tempDir: string
	let assignmentFile: string
	let distDir: string
	let server: Server
	let baseUrl: string

	before(async () => {
		tempDir = mkdtempSync(path.join(tmpdir(), 'cobrix-server-test-'))
		assignmentFile = path.join(tempDir, 'ENUNCIADO.md')
		writeFileSync(assignmentFile, '# Enunciado de prueba\n\nTexto de prueba.', 'utf8')

		distDir = path.join(tempDir, 'dist-client')
		mkdirSync(distDir, { recursive: true })
		writeFileSync(path.join(distDir, 'index.html'), '<!doctype html><html><body><div id="root">App</div></body></html>', 'utf8')
		writeFileSync(path.join(distDir, 'bundle.js'), 'console.log("ok")', 'utf8')

		const db = createCobrixDatabase(':memory:')

		server = createServerApp({
			simulatorUrl: 'http://127.0.0.1:4310',
			assignmentPath: assignmentFile,
			db,
			distDir,
		})

		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		const port = typeof address === 'object' && address !== null ? address.port : 0
		baseUrl = `http://127.0.0.1:${port}`
	})

	after(async () => {
		await new Promise(resolve => server.close(resolve))
		rmSync(tempDir, { recursive: true, force: true })
	})

	it('GET /api/dashboard devuelve métricas agregadas y datos de empresa en formato JSON', async () => {
		const res = await fetch(`${baseUrl}/api/dashboard`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)

		const data = (await res.json()) as DashboardResponseDto
		assert.ok(typeof data.metrics.totalCustomersCount === 'number')
		assert.ok(typeof data.metrics.openInvoicesCount === 'number')
		assert.ok(typeof data.company.companyName === 'string')
		const companyObj: object = data.company
		assert.ok(!('apiPassword' in companyObj), 'No debe exponerse apiPassword')
		assert.ok('lastAutoRunDate' in companyObj, 'Debe incluir lastAutoRunDate')
		assert.ok('lastAutoRunStatus' in companyObj, 'Debe incluir lastAutoRunStatus')
	})

	it('POST /api/dashboard rechaza métodos no permitidos con código 405', async () => {
		const res = await fetch(`${baseUrl}/api/dashboard`, { method: 'POST', body: '{}' })
		assert.equal(res.status, 405)
		const err = (await res.json()) as ApiErrorResponseDto
		assert.equal(err.statusCode, 405)
	})

	it('GET /api/enunciado devuelve el texto del archivo en formato JSON', async () => {
		const res = await fetch(`${baseUrl}/api/enunciado`)
		assert.equal(res.status, 200)
		const data = (await res.json()) as EnunciadoResponseDto
		assert.match(data.content, /# Enunciado de prueba/)
	})

	it('GET /api/ruta-inexistente devuelve 404 en formato JSON estructurado', async () => {
		const res = await fetch(`${baseUrl}/api/no-existe`)
		assert.equal(res.status, 404)
		assert.match(res.headers.get('content-type') ?? '', /application\/json/)
		const err = (await res.json()) as ApiErrorResponseDto
		assert.equal(err.statusCode, 404)
		assert.equal(err.error, 'Endpoint not found')
		assert.equal(err.path, '/api/no-existe')
	})

	it('sirve archivos estáticos existentes con el MIME type correcto', async () => {
		const res = await fetch(`${baseUrl}/bundle.js`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /application\/javascript/)
		const text = await res.text()
		assert.equal(text, 'console.log("ok")')
	})

	it('recursos estáticos inexistentes con extensión devuelven 404 en texto plano, no index.html', async () => {
		const res = await fetch(`${baseUrl}/assets/inexistente.js`)
		assert.equal(res.status, 404)
		assert.match(res.headers.get('content-type') ?? '', /text\/plain/)
		const text = await res.text()
		assert.equal(text, 'Static asset not found')
	})

	it('solicitudes de navegación a rutas de cliente devuelven index.html para React Router', async () => {
		const res = await fetch(`${baseUrl}/clientes`)
		assert.equal(res.status, 200)
		assert.match(res.headers.get('content-type') ?? '', /text\/html/)
		const text = await res.text()
		assert.match(text, /<div id="root">App<\/div>/)
	})

	it('protege contra ataques de Path Traversal bloqueando rutas fuera de dist', async () => {
		const res = await fetch(`${baseUrl}/%2e%2e/%2e%2e/package.json`)
		assert.ok(res.status === 403 || res.status === 404, `Status esperado 403 o 404, recibido ${res.status}`)
	})
})
