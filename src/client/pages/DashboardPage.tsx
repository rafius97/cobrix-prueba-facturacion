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

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { formatDateTime, formatUsd } from '../lib/utils'
import type { DashboardResponseDto } from '../../shared/api-types'

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
			{/* Encabezado */}
			<div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
				<div>
					<h1 className="text-2xl font-bold tracking-tight text-slate-900">Resumen General</h1>
					<p className="text-sm text-slate-500">
						Monitoreo en tiempo real de clientes, deuda e integración con el administrador de facturas.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<Button asChild className="gap-2 bg-indigo-600 hover:bg-indigo-700">
						<Link to="/sincronizacion">
							<Download className="w-4 h-4" />
							<span>Importar cuotas</span>
						</Link>
					</Button>
					<Button asChild variant="outline" className="gap-2">
						<Link to="/sincronizacion">
							<DollarSign className="w-4 h-4 text-emerald-600" />
							<span>Actualizar pagadas</span>
						</Link>
					</Button>
				</div>
			</div>

			{/* Tarjetas de Métricas Clave */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
				{/* Clientes */}
				<Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-all">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-slate-600">Clientes Importados</CardTitle>
						<Users className="h-4 w-4 text-slate-400" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-slate-900 tracking-tight">
							{metrics.totalCustomersCount}
						</div>
						<p className="text-xs text-slate-500 mt-1">Titulares agrupados por documento</p>
					</CardContent>
				</Card>

				{/* Contratos */}
				<Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-all">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-slate-600">Total Contratos</CardTitle>
						<Layers className="h-4 w-4 text-slate-400" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-slate-900 tracking-tight">
							{metrics.totalContractsCount}
						</div>
						<p className="text-xs text-slate-500 mt-1">Servicios activos o suspendidos</p>
					</CardContent>
				</Card>

				{/* Deuda Abierta */}
				<Card className="border-indigo-100 bg-indigo-50/30 shadow-xs hover:border-indigo-200 transition-all">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-indigo-900">Saldo por Cobrar</CardTitle>
						<DollarSign className="h-4 w-4 text-indigo-500" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-indigo-700 tracking-tight">
							{formatUsd(metrics.totalOpenBalanceCents)}
						</div>
						<p className="text-xs text-indigo-600/80 mt-1">
							{metrics.openInvoicesCount} facturas abiertas pendientes
						</p>
					</CardContent>
				</Card>

				{/* Facturas Pagadas */}
				<Card className="border-slate-200 shadow-xs hover:border-slate-300 transition-all">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-sm font-medium text-slate-600">Facturas Pagadas</CardTitle>
						<CheckCircle className="h-4 w-4 text-emerald-500" />
					</CardHeader>
					<CardContent>
						<div className="text-3xl font-bold text-slate-900 tracking-tight">
							{metrics.paidInvoicesCount}
						</div>
						<p className="text-xs text-emerald-600 font-medium mt-1">Conciliadas con el ISP</p>
					</CardContent>
				</Card>
			</div>

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
				{/* Tabla de Últimas Corridas */}
				<Card className="lg:col-span-2 shadow-xs">
					<CardHeader>
						<div className="flex items-center justify-between">
							<div>
								<CardTitle className="text-base font-semibold">Historial de Corridas</CardTitle>
								<CardDescription>Últimas sincronizaciones y simulaciones registradas en SQLite</CardDescription>
							</div>
							<Badge variant="secondary" className="gap-1">
								<Activity className="w-3 h-3 text-slate-500" />
								<span>{metrics.recentRuns.length} corridas</span>
							</Badge>
						</div>
					</CardHeader>
					<CardContent>
						{metrics.recentRuns.length === 0 ? (
							<div className="py-12 text-center text-slate-400">
								<Clock className="w-8 h-8 mx-auto mb-2 opacity-40" />
								<p className="text-sm">No hay corridas registradas en la base de datos.</p>
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left text-sm">
									<thead className="border-b border-slate-100 text-xs text-slate-400 uppercase tracking-wider font-semibold">
										<tr>
											<th className="pb-3">Tipo</th>
											<th className="pb-3">Modo</th>
											<th className="pb-3">Estado</th>
											<th className="pb-3">Fecha / Hora</th>
											<th className="pb-3 text-right">Resultado</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{metrics.recentRuns.map(run => {
											const isImport = run.type === 'IMPORT'
											return (
												<tr key={run.id} className="hover:bg-slate-50/50 transition-colors">
													<td className="py-3 font-medium text-slate-900">
														{isImport ? 'Importación' : 'Conciliación de Pagos'}
													</td>
													<td className="py-3">
														<Badge variant={run.isSimulation ? 'secondary' : 'default'}>
															{run.isSimulation ? 'Simulación' : 'Real'}
														</Badge>
													</td>
													<td className="py-3">
														<Badge variant={run.status === 'COMPLETED' ? 'success' : 'destructive'}>
															{run.status === 'COMPLETED' ? 'Completado' : 'Falló'}
														</Badge>
													</td>
													<td className="py-3 text-xs text-slate-500 font-mono">
														{formatDateTime(run.startedAt)}
													</td>
													<td className="py-3 text-right text-xs font-mono text-slate-700">
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
				<Card className="shadow-xs">
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
