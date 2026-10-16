import * as React from 'react'
import { FileText, RefreshCw } from 'lucide-react'

import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import type { EnunciadoResponseDto } from '../../shared/api-types'

export function AssignmentPage(): React.JSX.Element {
	const [content, setContent] = React.useState<string>('')
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [error, setError] = React.useState<string | null>(null)

	const loadEnunciado = React.useCallback(async (): Promise<void> => {
		try {
			setIsLoading(true)
			setError(null)
			const res = await fetch('/api/enunciado')
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`)
			}
			const data = (await res.json()) as EnunciadoResponseDto
			setContent(data.content)
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Error al cargar enunciado'
			setError(message)
		} finally {
			setIsLoading(false)
		}
	}, [])

	React.useEffect(() => {
		void loadEnunciado()
	}, [loadEnunciado])

	return (
		<div className="space-y-6">
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-slate-900">Enunciado del Proyecto</h1>
					<p className="text-sm text-slate-500">
						Especificación técnica original y criterios de aceptación desde <span className="font-mono">docs/ENUNCIADO.md</span>.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={() => void loadEnunciado()}
					className="gap-2"
					disabled={isLoading}
				>
					<RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
					<span>Recargar</span>
				</Button>
			</div>

			<Card className="shadow-xs">
				<CardHeader className="border-b border-slate-100 bg-slate-50/50">
					<div className="flex items-center gap-2">
						<FileText className="w-4 h-4 text-indigo-600" />
						<CardTitle className="text-sm font-semibold">docs/ENUNCIADO.md</CardTitle>
					</div>
					<CardDescription className="text-xs">
						Documento oficial protegido — Fuente de verdad para reglas de negocio
					</CardDescription>
				</CardHeader>
				<CardContent className="p-6">
					{isLoading ? (
						<div className="space-y-3 animate-pulse py-8">
							<div className="h-4 bg-slate-200 rounded-md w-3/4"></div>
							<div className="h-4 bg-slate-200 rounded-md w-1/2"></div>
							<div className="h-4 bg-slate-200 rounded-md w-5/6"></div>
						</div>
					) : error !== null ? (
						<div className="text-center py-12 text-red-600">
							<p className="text-sm">{error}</p>
							<Button variant="outline" size="sm" onClick={() => void loadEnunciado()} className="mt-4">
								Reintentar
							</Button>
						</div>
					) : (
						<pre className="font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap overflow-x-auto bg-slate-900 text-slate-100 p-6 rounded-lg max-h-[70vh] overflow-y-auto">
							{content}
						</pre>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
