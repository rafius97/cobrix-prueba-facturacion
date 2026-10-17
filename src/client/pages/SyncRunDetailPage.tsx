/**
 * Página de Detalle y Auditoría de Corridas de Sincronización (/sincronizacion/corridas/:id).
 * Presenta el desglose completo de una corrida (IMPORT o PAYMENT_UPDATE), sus métricas agregadas,
 * su condición de simulación o ejecución real y la tabla detallada de registros evaluados con filtros.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones inseguras (`as`).
 */

import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import {
	AlertCircle,
	AlertTriangle,
	ArrowLeft,
	Calendar,
	CheckCircle2,
	Clock,
	DollarSign,
	Download,
	FileText,
	Filter,
	Layers,
	RefreshCw,
	RotateCcw,
	Search,
	ShieldAlert,
	Sparkles,
	Tag,
	UserCheck,
	XCircle,
} from 'lucide-react'

import { Badge, ExecutionModeBadge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ApiClientError, fetchSyncRunDetail } from '../lib/api'
import { formatDateTime, formatUsd } from '../lib/utils'
import type {
	ImportRunSummaryDto,
	PaymentSyncSummaryDto,
	SyncRunDetailItemDto,
	SyncRunDetailResponseDto,
} from '../../shared/api-types'

interface DetailErrorState {
	readonly statusCode: number
	readonly message: string
}

type ResultFilterCategory = 'ALL' | 'SUCCESS' | 'EXCLUDED' | 'PROBLEM'

function formatDuration(startedAt: string, finishedAt: string, durationMs?: number): string {
	if (typeof durationMs === 'number' && durationMs >= 0) {
		if (durationMs < 1000) return `${durationMs} ms`
		const seconds = (durationMs / 1000).toFixed(1)
		return `${seconds} s`
	}
	try {
		const start = new Date(startedAt).getTime()
		const end = new Date(finishedAt).getTime()
		const diff = Math.max(0, end - start)
		if (diff < 1000) return `${diff} ms`
		return `${(diff / 1000).toFixed(1)} s`
	} catch {
		return '—'
	}
}

function getResultClassification(result: string): {
	readonly category: 'SUCCESS' | 'EXCLUDED' | 'PROBLEM'
	readonly label: string
	readonly variant: 'default' | 'secondary' | 'destructive' | 'outline'
	readonly className: string
} {
	switch (result) {
		case 'IMPORTED':
			return {
				category: 'SUCCESS',
				label: 'Importada',
				variant: 'default',
				className: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
			}
		case 'MARKED_PAID':
			return {
				category: 'SUCCESS',
				label: 'Pagada',
				variant: 'default',
				className: 'bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100',
			}
		case 'PARTIAL_PAYMENT':
			return {
				category: 'SUCCESS',
				label: 'Abono parcial',
				variant: 'default',
				className: 'bg-teal-100 text-teal-800 border-teal-300 hover:bg-teal-100',
			}
		case 'ALREADY_IMPORTED':
			return {
				category: 'EXCLUDED',
				label: 'Ya registrada',
				variant: 'secondary',
				className: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100',
			}
		case 'STILL_OPEN':
			return {
				category: 'EXCLUDED',
				label: 'Aún abierta',
				variant: 'secondary',
				className: 'bg-sky-100 text-sky-800 border-sky-300 hover:bg-sky-100',
			}
		case 'EXEMPTION_NOT_PAYMENT':
			return {
				category: 'EXCLUDED',
				label: 'Exención (100%)',
				variant: 'secondary',
				className: 'bg-indigo-100 text-indigo-800 border-indigo-300 hover:bg-indigo-100',
			}
		case 'EXCLUDED_STATUS':
			return {
				category: 'EXCLUDED',
				label: 'Estado no importable',
				variant: 'secondary',
				className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
			}
		case 'EXCLUDED_DOCUMENT_TYPE':
			return {
				category: 'EXCLUDED',
				label: 'Doc no admitido',
				variant: 'secondary',
				className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
			}
		case 'OUT_OF_WINDOW':
			return {
				category: 'EXCLUDED',
				label: 'Fuera de ventana',
				variant: 'secondary',
				className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
			}
		case 'EXCLUDED_MAX_INSTALLMENTS':
			return {
				category: 'EXCLUDED',
				label: 'Límite de cuotas',
				variant: 'secondary',
				className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
			}
		case 'LIMIT_REACHED':
			return {
				category: 'EXCLUDED',
				label: 'Tope de corrida',
				variant: 'secondary',
				className: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-100',
			}
		case 'NO_DEBT':
			return {
				category: 'EXCLUDED',
				label: 'Sin deuda',
				variant: 'secondary',
				className: 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-100',
			}
		case 'NO_EVIDENCE':
			return {
				category: 'PROBLEM',
				label: 'Sin evidencia',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		case 'INCONSISTENT_CURRENCY':
			return {
				category: 'PROBLEM',
				label: 'Moneda incoherente',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		case 'RESIDUAL_BALANCE':
			return {
				category: 'PROBLEM',
				label: 'Saldo residual',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		case 'CONTRADICTORY_DATA':
			return {
				category: 'PROBLEM',
				label: 'Datos contradictorios',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		case 'INVALID_IDENTIFICATION':
			return {
				category: 'PROBLEM',
				label: 'Identificación inválida',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		case 'INVALID_DATA':
			return {
				category: 'PROBLEM',
				label: 'Datos inválidos',
				variant: 'destructive',
				className: 'bg-rose-100 text-rose-800 border-rose-300 hover:bg-rose-100',
			}
		default:
			return {
				category: 'EXCLUDED',
				label: result,
				variant: 'outline',
				className: 'bg-slate-100 text-slate-700 border-slate-300',
			}
	}
}

export function SyncRunDetailPage(): React.JSX.Element {
	const { id } = useParams<{ readonly id: string }>()
	const runId = id?.trim() ?? ''

	const [data, setData] = React.useState<SyncRunDetailResponseDto | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [error, setError] = React.useState<DetailErrorState | null>(null)

	// Filtros en memoria para la tabla de auditoría
	const [searchTerm, setSearchTerm] = React.useState<string>('')
	const [categoryFilter, setCategoryFilter] = React.useState<ResultFilterCategory>('ALL')

	// Concurrencia para evitar condiciones de carrera ante cambios rápidos de ruta
	const activeRequestIdRef = React.useRef<number>(0)

	const loadDetail = React.useCallback(async (targetId: string): Promise<void> => {
		const requestId = ++activeRequestIdRef.current

		if (targetId.length === 0) {
			setError({
				statusCode: 400,
				message: 'Identificador de corrida no especificado',
			})
			setIsLoading(false)
			return
		}

		try {
			setIsLoading(true)
			setError(null)
			const result = await fetchSyncRunDetail(targetId)

			if (requestId !== activeRequestIdRef.current) {
				return
			}

			setData(result)
		} catch (err) {
			if (requestId !== activeRequestIdRef.current) {
				return
			}

			if (err instanceof ApiClientError) {
				setError({
					statusCode: err.statusCode,
					message: err.message,
				})
			} else if (err instanceof Error) {
				setError({
					statusCode: 500,
					message: err.message,
				})
			} else {
				setError({
					statusCode: 500,
					message: 'Error inesperado al consultar el detalle de la corrida',
				})
			}
		} finally {
			if (requestId === activeRequestIdRef.current) {
				setIsLoading(false)
			}
		}
	}, [])

	React.useEffect(() => {
		void loadDetail(runId)
	}, [runId, loadDetail])

	// 1. Estado de carga inicial con skeletons
	if (isLoading) {
		return (
			<div className="space-y-6 animate-pulse">
				<div className="flex items-center gap-2">
					<div className="h-4 w-36 bg-slate-200 rounded"></div>
				</div>
				<div className="space-y-2">
					<div className="h-8 w-72 bg-slate-200 rounded-md"></div>
					<div className="h-4 w-60 bg-slate-100 rounded"></div>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					{[1, 2, 3, 4].map(i => (
						<div key={i} className="h-24 bg-slate-100 rounded-xl border border-slate-200"></div>
					))}
				</div>
				<div className="h-80 bg-slate-100 rounded-xl border border-slate-200"></div>
			</div>
		)
	}

	// 2. Estado de error 404: Corrida no encontrada
	if (error !== null && error.statusCode === 404) {
		return (
			<div className="space-y-6">
				<div>
					<Link
						to="/sincronizacion"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Volver a Sincronización</span>
					</Link>
				</div>
				<Card className="border-slate-200 bg-white">
					<CardContent className="py-12 flex flex-col items-center text-center">
						<div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-4">
							<AlertCircle className="w-6 h-6" />
						</div>
						<h2 className="text-lg font-semibold text-slate-800">Corrida de sincronización no encontrada</h2>
						<p className="text-sm text-slate-500 max-w-md mt-1">
							No existe ninguna corrida registrada con el identificador{' '}
							<span className="font-mono text-slate-700 font-semibold">{runId}</span>.
						</p>
						<div className="mt-6">
							<Button asChild variant="outline">
								<Link to="/sincronizacion" className="flex items-center gap-2">
									<ArrowLeft className="w-4 h-4" />
									<span>Regresar al historial</span>
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	// 3. Estado de error de red, 500 u otros errores
	if (error !== null || data === null) {
		const errorMessage = error !== null ? error.message : 'No se pudo cargar la corrida'
		return (
			<div className="space-y-6">
				<div>
					<Link
						to="/sincronizacion"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Volver a Sincronización</span>
					</Link>
				</div>
				<Card className="border-rose-200 bg-rose-50/40">
					<CardContent className="py-8 flex flex-col items-center text-center">
						<div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mb-4">
							<AlertCircle className="w-6 h-6" />
						</div>
						<h2 className="text-lg font-semibold text-rose-900">Error al cargar la corrida</h2>
						<p className="text-sm text-rose-700 max-w-md mt-1">{errorMessage}</p>
						<div className="mt-6 flex items-center gap-3">
							<Button
								onClick={() => {
									void loadDetail(runId)
								}}
								className="bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-2"
							>
								<RotateCcw className="w-4 h-4" />
								<span>Reintentar</span>
							</Button>
							<Button asChild variant="outline">
								<Link to="/sincronizacion">Ir a Sincronización</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { run, details } = data
	const summary = run.summary
	const isImport = run.type === 'IMPORT'

	// Filtrado de detalles en memoria
	const cleanSearch = searchTerm.trim().toLowerCase()
	const filteredDetails = details.filter(item => {
		// Filtro por texto: contractId o debtId
		if (cleanSearch.length > 0) {
			const contractMatch = String(item.contractId).toLowerCase().includes(cleanSearch)
			const debtMatch = item.debtId.toLowerCase().includes(cleanSearch)
			if (!contractMatch && !debtMatch) return false
		}

		// Filtro por categoría de resultado
		if (categoryFilter !== 'ALL') {
			const classification = getResultClassification(item.result)
			if (classification.category !== categoryFilter) return false
		}

		return true
	})

	return (
		<div className="space-y-6">
			{/* 1. Navegación superior */}
			<div>
				<Link
					to="/sincronizacion"
					className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
				>
					<ArrowLeft className="w-4 h-4" />
					<span>Volver a Sincronización</span>
				</Link>
			</div>

			{/* 2. Banner de Simulación (cuando corresponda) */}
			{run.isSimulation && (
				<div className="rounded-xl border border-purple-200 bg-purple-50/70 p-4 sm:p-5 flex items-start gap-3 shadow-xs">
					<div className="p-2 rounded-lg bg-purple-100 text-purple-700 shrink-0 mt-0.5">
						<Sparkles className="w-5 h-5" />
					</div>
					<div>
						<h3 className="text-sm font-semibold text-purple-950 flex items-center gap-2">
							<span>Modo Simulación Activo</span>
							<Badge className="bg-purple-200 text-purple-800 border-purple-300 text-xs">Simulación</Badge>
						</h3>
						<p className="text-sm text-purple-800 mt-1 leading-relaxed">
							Esta corrida se ejecutó en modo simulación: ningún registro de cliente, contrato, factura o
							saldo fue modificado en la base de datos de Cobrix. Los resultados expuestos reflejan las
							evaluaciones proyectadas según las reglas vigentes.
						</p>
					</div>
				</div>
			)}

			{/* 3. Banner de Error en la Corrida (cuando corresponda) */}
			{(run.status === 'FAILED' || (run.errorMessage !== null && run.errorMessage.length > 0)) && (
				<div className="rounded-xl border border-rose-200 bg-rose-50/70 p-4 sm:p-5 flex items-start gap-3 shadow-xs">
					<div className="p-2 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
						<ShieldAlert className="w-5 h-5" />
					</div>
					<div>
						<h3 className="text-sm font-semibold text-rose-950 flex items-center gap-2">
							<span>Corrida Interrumpida o Fallida</span>
							<Badge className="bg-rose-200 text-rose-800 border-rose-300 text-xs">Fallida</Badge>
						</h3>
						<p className="text-sm text-rose-800 mt-1 leading-relaxed font-mono">
							{run.errorMessage ?? 'Ocurrió un error inesperado durante la ejecución de la sincronización.'}
						</p>
					</div>
				</div>
			)}

			{/* 4. Encabezado principal y metadatos */}
			<div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs space-y-4">
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
					<div className="space-y-1">
						<div className="flex items-center gap-2 flex-wrap">
							<span className="text-xs font-semibold tracking-wider uppercase text-slate-500">
								{isImport ? 'Importación de Deudas' : 'Actualización de Pagos'}
							</span>
							<Badge
								className={
									run.status === 'COMPLETED'
										? 'bg-emerald-100 text-emerald-800 border-emerald-300'
										: 'bg-rose-100 text-rose-800 border-rose-300'
								}
							>
								{run.status === 'COMPLETED' ? 'COMPLETADA' : 'FALLIDA'}
							</Badge>
							<ExecutionModeBadge isSimulation={run.isSimulation} />
						</div>
						<h1 className="text-2xl font-bold text-slate-900 tracking-tight">
							{isImport ? 'Corrida de Importación' : 'Corrida de Actualización de Pagos'}
						</h1>
					</div>

					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								void loadDetail(runId)
							}}
							className="text-xs text-slate-600 flex items-center gap-1.5"
						>
							<RefreshCw className="w-3.5 h-3.5" />
							<span>Actualizar vista</span>
						</Button>
					</div>
				</div>

				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
					<div>
						<span className="text-slate-400 block font-medium">ID de corrida</span>
						<span className="font-mono text-slate-800 select-all font-medium text-[11px]">{run.id}</span>
					</div>
					<div>
						<span className="text-slate-400 block font-medium">Fecha de inicio</span>
						<span className="text-slate-800 font-medium">{formatDateTime(run.startedAt)}</span>
					</div>
					<div>
						<span className="text-slate-400 block font-medium">Fecha de finalización</span>
						<span className="text-slate-800 font-medium">{formatDateTime(run.finishedAt)}</span>
					</div>
					<div>
						<span className="text-slate-400 block font-medium">Duración total</span>
						<span className="text-slate-800 font-medium">
							{formatDuration(run.startedAt, run.finishedAt, summary?.durationMs)}
						</span>
					</div>
				</div>
			</div>

			{/* 5. Tarjetas de Resumen Cuantitativo */}
			{isImport && summary?.type === 'IMPORT' && <ImportSummaryCards summary={summary} />}
			{!isImport && summary?.type === 'PAYMENT_UPDATE' && <PaymentSummaryCards summary={summary} />}

			{/* 6. Tabla de Auditoría con Filtros */}
			<Card className="border-slate-200 bg-white">
				<CardHeader className="pb-3 border-b border-slate-100">
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
						<div>
							<CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
								<FileText className="w-4 h-4 text-slate-500" />
								<span>Desglose de Registros Evaluados ({details.length})</span>
							</CardTitle>
							<CardDescription className="text-xs text-slate-500">
								Auditoría individual por cuota/factura procesada durante esta sincronización.
							</CardDescription>
						</div>

						{/* Filtros */}
						<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
							{/* Buscador */}
							<div className="relative">
								<Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
								<input
									type="text"
									value={searchTerm}
									onChange={e => setSearchTerm(e.target.value)}
									placeholder="Buscar contrato o deuda..."
									className="w-full sm:w-56 pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-md text-slate-800 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
								/>
							</div>

							{/* Selector de categoría */}
							<div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md text-xs overflow-x-auto max-w-full">
								<button
									type="button"
									onClick={() => setCategoryFilter('ALL')}
									className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
										categoryFilter === 'ALL'
											? 'bg-white text-slate-800 shadow-xs'
											: 'text-slate-600 hover:text-slate-900'
									}`}
								>
									Todos
								</button>
								<button
									type="button"
									onClick={() => setCategoryFilter('SUCCESS')}
									className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
										categoryFilter === 'SUCCESS'
											? 'bg-white text-emerald-700 shadow-xs'
											: 'text-slate-600 hover:text-slate-900'
									}`}
								>
									Éxitos
								</button>
								<button
									type="button"
									onClick={() => setCategoryFilter('EXCLUDED')}
									className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
										categoryFilter === 'EXCLUDED'
											? 'bg-white text-amber-700 shadow-xs'
											: 'text-slate-600 hover:text-slate-900'
									}`}
								>
									Exclusiones
								</button>
								<button
									type="button"
									onClick={() => setCategoryFilter('PROBLEM')}
									className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
										categoryFilter === 'PROBLEM'
											? 'bg-white text-rose-700 shadow-xs'
											: 'text-slate-600 hover:text-slate-900'
									}`}
								>
									Problemas
								</button>
							</div>
						</div>
					</div>
				</CardHeader>

				<CardContent className="p-0">
					{details.length === 0 ? (
						<div className="py-12 text-center text-slate-400 text-sm">
							<AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
							<p>Esta corrida no registró detalles individuales de cuotas.</p>
						</div>
					) : filteredDetails.length === 0 ? (
						<div className="py-12 text-center text-slate-500 text-sm">
							<Filter className="w-8 h-8 mx-auto mb-2 text-slate-400" />
							<p className="font-medium text-slate-700">No hay coincidencias con los filtros aplicados</p>
							<p className="text-xs text-slate-400 mt-1">
								Intenta modificar el término de búsqueda o la categoría seleccionada.
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setSearchTerm('')
									setCategoryFilter('ALL')
								}}
								className="mt-3 text-xs"
							>
								Limpiar filtros
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full min-w-[640px] text-left text-xs text-slate-700 border-collapse">
								<thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
									<tr>
										<th className="py-2.5 px-4">Contrato</th>
										<th className="py-2.5 px-4">ID Deuda</th>
										<th className="py-2.5 px-4">Período</th>
										<th className="py-2.5 px-4 text-right">Monto</th>
										<th className="py-2.5 px-4">Resultado</th>
										<th className="py-2.5 px-4">Motivo / Auditoría</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{filteredDetails.map(item => {
										const classification = getResultClassification(item.result)
										return (
											<tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
												<td className="py-2.5 px-4 font-mono font-medium text-slate-900">
													#{item.contractId}
												</td>
												<td className="py-2.5 px-4 font-mono text-slate-600">{item.debtId}</td>
												<td className="py-2.5 px-4 font-medium text-slate-700">
													{item.period.length > 0 ? item.period : '—'}
												</td>
												<td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900">
													{item.amountCents > 0 ? formatUsd(item.amountCents) : '—'}
												</td>
												<td className="py-2.5 px-4">
													<Badge
														variant={classification.variant}
														className={`text-[11px] font-medium border ${classification.className}`}
													>
														{classification.label}
													</Badge>
												</td>
												<td className="py-2.5 px-4 text-slate-600 max-w-md break-words">
													{item.reason}
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}

/**
 * Resumen cuantitativo para corridas de Importación (IMPORT).
 */
function ImportSummaryCards({ summary }: { readonly summary: ImportRunSummaryDto }): React.JSX.Element {
	return (
		<div className="space-y-4">
			{/* Tarjetas primarias */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<Card className="border-slate-200 bg-white shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-slate-500 font-medium">Contratos inspeccionados</span>
						<p className="text-2xl font-bold text-slate-900 mt-1">{summary.totalContractsInspected}</p>
						<span className="text-xs text-slate-400 mt-1 block">
							{summary.totalInstallmentsEvaluated} cuotas evaluadas
						</span>
					</CardContent>
				</Card>

				<Card className="border-emerald-200 bg-emerald-50/30 shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-emerald-700 font-medium">Facturas importadas</span>
						<p className="text-2xl font-bold text-emerald-800 mt-1">{summary.importedInvoicesCount}</p>
						<span className="text-xs text-emerald-600 font-semibold mt-1 block">
							{formatUsd(summary.importedAmountCents)} total
						</span>
					</CardContent>
				</Card>

				<Card className="border-indigo-200 bg-indigo-50/30 shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-indigo-700 font-medium">Nuevos clientes</span>
						<p className="text-2xl font-bold text-indigo-800 mt-1">{summary.newCustomersCount}</p>
						<span className="text-xs text-indigo-600 mt-1 block">Registrados en Cobrix</span>
					</CardContent>
				</Card>

				<Card className="border-slate-200 bg-white shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-slate-500 font-medium">Ya importadas previamente</span>
						<p className="text-2xl font-bold text-slate-700 mt-1">{summary.alreadyImportedCount}</p>
						<span className="text-xs text-slate-400 mt-1 block">Omitidas por idempotencia</span>
					</CardContent>
				</Card>
			</div>

			{/* Tarjetas secundarias agrupadas */}
			<Card className="border-slate-200 bg-white">
				<CardHeader className="py-3 px-4 border-b border-slate-100">
					<CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
						Filtros, Exclusiones y Reglas de Negocio Aplicadas
					</CardTitle>
				</CardHeader>
				<CardContent className="p-4">
					<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-xs">
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Por estado contrato</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.excludedByStatusCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Tipo doc excluido</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.excludedByDocumentTypeCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Fuera de ventana</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.outOfWindowCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Tope cuotas/contrato</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.excludedByMaxInstallmentsCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Tope de corrida</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.limitReachedCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Sin deuda (monto 0)</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.noDebtCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Moneda incoherente</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.inconsistentCurrencyCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Saldo residual</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.residualBalanceCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Identificación inválida</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.invalidIdentificationCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Datos inválidos</span>
							<span className="font-bold text-slate-800 text-sm mt-0.5 block">
								{summary.invalidDataCount}
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}

/**
 * Resumen cuantitativo para corridas de Actualización de Pagos (PAYMENT_UPDATE).
 */
function PaymentSummaryCards({ summary }: { readonly summary: PaymentSyncSummaryDto }): React.JSX.Element {
	return (
		<div className="space-y-4">
			{/* Tarjetas primarias */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<Card className="border-slate-200 bg-white shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-slate-500 font-medium">Facturas inspeccionadas</span>
						<p className="text-2xl font-bold text-slate-900 mt-1">{summary.totalInvoicesInspected}</p>
						<span className="text-xs text-slate-400 mt-1 block">
							en {summary.totalContractsInspected} contratos evaluados
						</span>
					</CardContent>
				</Card>

				<Card className="border-emerald-200 bg-emerald-50/30 shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-emerald-700 font-medium">Marcadas como pagadas</span>
						<p className="text-2xl font-bold text-emerald-800 mt-1">{summary.markedPaidCount}</p>
						<span className="text-xs text-emerald-600 font-semibold mt-1 block">
							{formatUsd(summary.markedPaidAmountCents)} conciliados
						</span>
					</CardContent>
				</Card>

				<Card className="border-teal-200 bg-teal-50/30 shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-teal-700 font-medium">Abonos parciales</span>
						<p className="text-2xl font-bold text-teal-800 mt-1">{summary.partialPaymentsCount}</p>
						<span className="text-xs text-teal-600 font-semibold mt-1 block">
							{formatUsd(summary.partialPaymentsAmountCents)} aplicados
						</span>
					</CardContent>
				</Card>

				<Card className="border-sky-200 bg-sky-50/30 shadow-xs">
					<CardContent className="p-4">
						<span className="text-xs text-sky-700 font-medium">Permanecen abiertas</span>
						<p className="text-2xl font-bold text-sky-800 mt-1">{summary.stillOpenCount}</p>
						<span className="text-xs text-sky-600 font-semibold mt-1 block">
							{formatUsd(summary.stillOpenBalanceCents)} saldo pendiente
						</span>
					</CardContent>
				</Card>
			</div>

			{/* Tarjetas secundarias agrupadas */}
			<Card className="border-slate-200 bg-white">
				<CardHeader className="py-3 px-4 border-b border-slate-100">
					<CardTitle className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
						Excepciones, Exenciones y Discrepancias Detectadas
					</CardTitle>
				</CardHeader>
				<CardContent className="p-4">
					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Exenciones (100% desc.)</span>
							<span className="font-bold text-indigo-700 text-sm mt-0.5 block">
								{summary.exemptionCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Sin evidencia de pago</span>
							<span className="font-bold text-amber-700 text-sm mt-0.5 block">
								{summary.noEvidenceCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Datos contradictorios</span>
							<span className="font-bold text-rose-700 text-sm mt-0.5 block">
								{summary.contradictoryDataCount}
							</span>
						</div>
						<div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100">
							<span className="text-slate-500 block">Datos inválidos</span>
							<span className="font-bold text-rose-700 text-sm mt-0.5 block">
								{summary.invalidDataCount}
							</span>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
