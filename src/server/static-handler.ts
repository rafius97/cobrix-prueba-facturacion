/**
 * Despachador de archivos estáticos y fallback SPA para la aplicación Cobrix.
 * Protegido contra Path Traversal y con manejo determinista de 404 para assets.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

const MIME_TYPES: Readonly<Record<string, string>> = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon',
	'.json': 'application/json; charset=utf-8',
	'.woff': 'font/woff',
	'.woff2': 'font/woff2',
	'.ttf': 'font/ttf',
	'.txt': 'text/plain; charset=utf-8',
}

export function serveStatic(
	req: IncomingMessage,
	res: ServerResponse,
	distDir: string,
): boolean {
	if (req.method !== 'GET' && req.method !== 'HEAD') {
		return false
	}

	const rawUrl = req.url ?? '/'
	const parsedUrl = new URL(rawUrl, 'http://localhost')
	const pathname = parsedUrl.pathname

	// No interceptar rutas de API
	if (pathname.startsWith('/api/') || pathname === '/api') {
		return false
	}

	// Protección contra null bytes y path traversal en URL cruda
	if (rawUrl.includes('\0')) {
		res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('Bad Request')
		return true
	}
	if (rawUrl.includes('..') || rawUrl.toLowerCase().includes('%2e%2e')) {
		res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('Forbidden')
		return true
	}

	const normalizedDistDir = path.resolve(distDir)
	if (!existsSync(normalizedDistDir)) {
		return false
	}

	const normalizedPath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '')
	const targetPath = path.resolve(normalizedDistDir, '.' + normalizedPath)

	// Protección estricta contra Path Traversal
	if (targetPath !== normalizedDistDir && !targetPath.startsWith(normalizedDistDir + path.sep)) {
		res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('Forbidden')
		return true
	}

	// Si el archivo físico existe en dist/
	if (existsSync(targetPath)) {
		try {
			const stat = statSync(targetPath)
			if (stat.isFile()) {
				const ext = path.extname(targetPath).toLowerCase()
				const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
				const content = readFileSync(targetPath)
				res.writeHead(200, {
					'content-type': contentType,
					'content-length': content.byteLength,
					...(ext !== '.html' ? { 'cache-control': 'public, max-age=31536000, immutable' } : { 'cache-control': 'no-cache' }),
				})
				if (req.method === 'HEAD') {
					res.end()
				} else {
					res.end(content)
				}
				return true
			}
		} catch {
			// En caso de error de lectura, continuar con el flujo
		}
	}

	// Si es un recurso con extensión (asset estático inexistente como .js, .css, etc.), responder 404
	const requestedExt = path.extname(normalizedPath)
	if (requestedExt.length > 0) {
		res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
		res.end('Static asset not found')
		return true
	}

	// Fallback para React Router: servir index.html si existe
	const indexPath = path.join(normalizedDistDir, 'index.html')
	if (existsSync(indexPath)) {
		try {
			const indexContent = readFileSync(indexPath)
			res.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				'content-length': indexContent.byteLength,
				'cache-control': 'no-cache',
			})
			if (req.method === 'HEAD') {
				res.end()
			} else {
				res.end(indexContent)
			}
			return true
		} catch {
			return false
		}
	}

	return false
}
