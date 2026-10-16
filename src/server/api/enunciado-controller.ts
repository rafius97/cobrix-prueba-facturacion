/**
 * Controlador de API para exponer el contenido seguro de docs/ENUNCIADO.md.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import { existsSync, readFileSync } from 'node:fs'

import type { EnunciadoResponseDto } from '../../shared/api-types.ts'

export function getEnunciadoData(assignmentPath: string): EnunciadoResponseDto {
	if (!existsSync(assignmentPath)) {
		return {
			content: 'No se encontró docs/ENUNCIADO.md en la ruta especificada.',
		}
	}

	try {
		const content = readFileSync(assignmentPath, 'utf8')
		return {
			content,
		}
	} catch {
		return {
			content: 'Error al leer docs/ENUNCIADO.md.',
		}
	}
}
