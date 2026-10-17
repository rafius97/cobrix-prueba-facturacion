import * as React from 'react'
import { Link } from 'react-router-dom'
import {
	Activity,
	ArrowUpRight,
	CheckCircle,
	Clock,
	DollarSign,
	Download,
	HelpCircle,
	Layers,
	Server,
	Users,
} from 'lucide-react'

import { Badge, ExecutionModeBadge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { formatDateTime, formatUsd } from '../lib/utils'
import type { DashboardResponseDto } from '../../shared/api-types'

function formatAutoRunDate(dateStr: string): string {
	const parts = dateStr.split('-')
	if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
		return `${parts[2]}/${parts[1]}/${parts[0]}`
	}
	return dateStr
}

export function DashboardPage(): React.JSX.Element {
	const [data, setData] = React.useState<DashboardResponseDto | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [error, setError] = React.useState<string | null>(null)

	React.useEffect(() => {
		async function fetchDashboard(): Promise<void> {
			try {
				setIsLoading(true)
				setError(null)
				const response = await fetch('/api/dashboard')
				if (!response.ok) {
					throw new Error(`Error en el servidor: HTTP ${response.status}`)
				}
				const result = (await response.json()) as DashboardResponseDto
				setData(result)
			} catch (err) {
				const message = err instanceof Error ? err.message : 'No se pudo cargar el dashboard'
				setError(message)
			} finally {
				setIsLoading(false)
			}
		}

		void fetchDashboard()
	}, [])

	if (isLoading) {
		return (
			<div className="space-y-6 animate-pulse">
				<div className="h-8 bg-slate-200 rounded-md w-1/4"></div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
					{[1, 2, 3, 4].map(i => (
						<div key={i} className="h-32 bg-slate-200 rounded-xl"></div>
					))}
				</div>
				<div className="h-64 bg-slate-200 rounded-xl"></div>
			</div>
		)
	}

	if (error !== null || data === null) {
		return (
			<Card className="border-red-200 bg-red-50 text-red-900">
				<CardHeader>
					<CardTitle className="text-red-800">Error al consultar el backend</CardTitle>
					<CardDescription className="text-red-600">
						{error ?? 'Datos del dashboard no disponibles'}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						variant="outline"
						className="border-red-300 text-red-800 hover:bg-red-100"
						onClick={() => window.location.reload()}
					>
						Reintentar conexión
					</Button>
				</CardContent>
			</Card>
		)
	}

	const { metrics, company } = data

	return (
		<div className="space-y-8">
			{/* Encabezado estilo Revora */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div>
					<div className="flex items-center gap-2.5">
						<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
							Resumen General
						</h1>
						<span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
							En vivo
						</span>
					</div>
					<p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
						Monitoreo en tiempo real de clientes, deuda e integración con el administrador de facturas.
					</p>
				</div>
				<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 sm:gap-3 w-full sm:w-auto">
					<Button
						asChild
						className="gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-xs w-full sm:w-auto justify-center min-h-[42px] font-semibold"
					>
						<Link to="/sincronizacion">
							<Download className="w-4 h-4 text-purple-300" />
							<span>Importar cuotas</span>
						</Link>
					</Button>
					<Button
						asChild
						variant="outline"
						className="gap-2 rounded-xl border-slate-200 bg-white text-slate-800 hover:bg-slate-50 shadow-2xs w-full sm:w-auto justify-center min-h-[42px] font-semibold"
					>
						<Link to="/sincronizacion">
							<DollarSign className="w-4 h-4 text-emerald-600" />
							<span>Actualizar pagos</span>
						</Link>
					</Button>
				</div>
			</div>

			{/* Tarjetas de Métricas Clave (Estilo Revora con Squircles) */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
				{/* Clientes */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Clientes
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100/80 flex items-center justify-center text-slate-600 group-hover:bg-purple-50 group-hover:text-purple-600 group-hover:border-purple-100 transition-colors">
							<Users className="h-4 w-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold text-slate-900 tracking-tight">
							{metrics.totalCustomersCount}
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/50">
								Registrados
							</span>
							<span className="text-[11px] text-slate-400">en Cobrix</span>
						</div>
					</CardContent>
				</Card>

				{/* Contratos */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Contratos Activos
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100/80 flex items-center justify-center text-slate-600 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-100 transition-colors">
							<Layers className="h-4 w-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold text-slate-900 tracking-tight">
							{metrics.totalContractsCount}
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/50">
								Servicios
							</span>
							<span className="text-[11px] text-slate-400">en simulador</span>
						</div>
					</CardContent>
				</Card>

				{/* Deuda Abierta */}
				<Card className="rounded-2xl border-purple-100/80 bg-gradient-to-br from-white via-white to-purple-50/30 shadow-[0_2px_14px_-4px_rgba(100,50,200,0.06)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-purple-700">
							Saldo por Cobrar
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-purple-100/80 border border-purple-200/60 flex items-center justify-center text-purple-700 shadow-2xs">
							<DollarSign className="h-4 w-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold text-purple-950 tracking-tight">
							{formatUsd(metrics.totalOpenBalanceCents)}
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/50">
								{metrics.openInvoicesCount} abiertas
							</span>
							<span className="text-[11px] text-slate-400">pendientes</span>
						</div>
					</CardContent>
				</Card>

				{/* Facturas Pagadas */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Facturas Pagadas
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100/80 flex items-center justify-center text-slate-600 group-hover:bg-emerald-50 group-hover:text-emerald-600 group-hover:border-emerald-100 transition-colors">
							<CheckCircle className="h-4 w-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold text-slate-900 tracking-tight">
							{metrics.paidInvoicesCount}
						</div>
						<div className="flex items-center gap-1.5 pt-1">
							<span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/50">
								Conciliadas
							</span>
							<span className="text-[11px] text-slate-400">con evidencia</span>
						</div>
					</CardContent>
				</Card>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
				{/* Tabla de Últimas Corridas (Estilo Revora Recent Invoices) */}
				<Card className="lg:col-span-2 rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)]">
					<CardHeader className="border-b border-slate-100/80 pb-4">
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="text-base font-bold text-slate-900 tracking-tight">
									Historial de Corridas
								</CardTitle>
								<CardDescription className="text-xs text-slate-400 mt-0.5">
									Sincronizaciones y simulaciones registradas en base de datos
								</CardDescription>
							</div>
							<Badge variant="outline" className="gap-1.5 py-1 px-3 bg-purple-50/60 border-purple-100/80 text-purple-900 font-semibold text-xs">
								<Activity className="w-3.5 h-3.5 text-purple-600" />
								<span>{metrics.recentRuns.length} corridas</span>
							</Badge>
						</div>
					</CardHeader>
					<CardContent className="pt-4">
						{metrics.recentRuns.length === 0 ? (
							<div className="py-12 text-center text-slate-400">
								<Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
								<p className="text-sm">No hay corridas registradas en la base de datos.</p>
							</div>
						) : (
							<div className="overflow-x-auto -mx-2 sm:mx-0 px-2 sm:px-0">
								<table className="w-full text-left text-sm min-w-[500px]">
									<thead className="border-b border-slate-100 text-[11px] text-slate-400 uppercase tracking-wider font-bold">
										<tr>
											<th className="pb-3 px-3">Tipo</th>
											<th className="pb-3 px-3">Modo</th>
											<th className="pb-3 px-3">Estado</th>
											<th className="pb-3 px-3">Fecha / Hora</th>
											<th className="pb-3 px-3 text-right">Resultado</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{metrics.recentRuns.map(run => {
											const isImport = run.type === 'IMPORT'
											return (
												<tr key={run.id} className="hover:bg-purple-50/20 transition-colors">
													<td className="py-3 px-3 font-semibold text-slate-900">
														{isImport ? 'Importación' : 'Actualización de Pagos'}
													</td>
													<td className="py-3 px-3">
														<ExecutionModeBadge isSimulation={run.isSimulation} />
													</td>
													<td className="py-3 px-3">
														<Badge variant={run.status === 'COMPLETED' ? 'success' : 'destructive'}>
															{run.status === 'COMPLETED' ? 'Completado' : 'Falló'}
														</Badge>
													</td>
													<td className="py-3 px-3 text-xs text-slate-500 font-mono">
														{formatDateTime(run.startedAt)}
													</td>
													<td className="py-3 px-3 text-right text-xs font-mono font-semibold text-slate-700">
														{run.summary !== null ? (
															isImport ? (
																<span>
																	{(run.summary as { importedInvoicesCount: number }).importedInvoicesCount} facturas
																</span>
															) : (
																<span>
																	{(run.summary as { markedPaidCount: number }).markedPaidCount} pagadas
																</span>
															)
														) : (
															'—'
														)}
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

				{/* Estado de la Empresa y Proveedor */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)]">
					<CardHeader>
						<CardTitle className="text-base font-semibold">Configuración Activa</CardTitle>
						<CardDescription>Parámetros del proveedor ISP conectado</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="p-3 bg-slate-50 rounded-lg space-y-2 text-xs">
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Empresa</span>
								<span className="font-semibold text-slate-800">{company.companyName}</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">RIF</span>
								<span className="font-mono text-slate-700">{company.companyTaxId}</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Correo</span>
								<span className="text-slate-700 truncate max-w-[150px]">{company.companyEmail}</span>
							</div>
						</div>

						<div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Servidor API</span>
								<span className="font-mono text-slate-700 truncate max-w-[150px]">{company.apiUrl}</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Usuario</span>
								<span className="font-mono text-slate-700">{company.apiUsername}</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Estados importables</span>
								<span className="font-semibold text-indigo-700">{company.importableStatuses.join(', ')}</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Corrida Diaria</span>
								<span className="font-medium text-slate-700">
									{company.autoRunActive ? `Activa (${company.autoRunHour})` : 'Inactiva'}
								</span>
							</div>
							<div className="flex items-center justify-between">
								<span className="text-slate-500 font-medium">Última ejecución</span>
								<span className="font-medium text-slate-700">
									{company.lastAutoRunDate !== null && company.lastAutoRunStatus !== null ? (
										<span>
											{formatAutoRunDate(company.lastAutoRunDate)} ·{' '}
											<span
												className={
													company.lastAutoRunStatus === 'COMPLETED'
														? 'text-emerald-600 font-semibold'
														: company.lastAutoRunStatus === 'FAILED'
															? 'text-red-600 font-semibold'
															: 'text-amber-600 font-semibold'
												}
											>
												{company.lastAutoRunStatus === 'COMPLETED'
													? 'Completada'
													: company.lastAutoRunStatus === 'FAILED'
														? 'Fallida'
														: 'En ejecución'}
											</span>
										</span>
									) : (
										<span className="text-slate-400">Nunca ejecutada</span>
									)}
								</span>
							</div>
						</div>

						<div className="pt-2 space-y-2">
							<Button asChild variant="secondary" className="w-full text-xs">
								<Link to="/configuracion">Ver Ajustes Completos</Link>
							</Button>
							<Button
								asChild
								variant="ghost"
								size="sm"
								className="w-full text-xs text-slate-500 hover:text-slate-900 gap-1.5 h-8"
							>
								<a href="http://127.0.0.1:4310/docs" target="_blank" rel="noopener noreferrer">
									<span>Swagger ISP</span>
									<ArrowUpRight className="w-3.5 h-3.5" />
								</a>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	)
}
