import * as React from 'react'
import { Link, useParams } from 'react-router-dom'
import {
	AlertCircle,
	ArrowLeft,
	Calendar,
	CheckCircle2,
	Clock,
	CreditCard,
	DollarSign,
	FileText,
	Layers,
	Mail,
	MapPin,
	Phone,
	RotateCcw,
	User,
	UserPlus,
	UserX,
} from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { ApiClientError, fetchCustomerDossier } from '../lib/api'
import { formatDate, formatDateTime, formatUsd } from '../lib/utils'
import type {
	ContractItemDto,
	CustomerDossierResponseDto,
	CustomerEventItemDto,
	InvoiceItemDto,
} from '../../shared/api-types'

interface DossierErrorState {
	readonly statusCode: number
	readonly message: string
}

export function CustomerDossierPage(): React.JSX.Element {
	const { id } = useParams<{ readonly id: string }>()
	const customerId = id?.trim() ?? ''

	const [data, setData] = React.useState<CustomerDossierResponseDto | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [error, setError] = React.useState<DossierErrorState | null>(null)

	// Control de concurrencia para evitar condiciones de carrera ante cambios rápidos de ruta
	const activeRequestIdRef = React.useRef<number>(0)

	const loadDossier = React.useCallback(async (targetId: string): Promise<void> => {
		const requestId = ++activeRequestIdRef.current

		if (targetId.length === 0) {
			setError({
				statusCode: 404,
				message: 'Identificador de cliente no especificado',
			})
			setIsLoading(false)
			return
		}

		try {
			setIsLoading(true)
			setError(null)
			const result = await fetchCustomerDossier(targetId)

			// Si otra petición fue emitida con posterioridad, descartar esta respuesta
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
					message: 'Error inesperado al cargar el expediente del cliente',
				})
			}
		} finally {
			if (requestId === activeRequestIdRef.current) {
				setIsLoading(false)
			}
		}
	}, [])

	React.useEffect(() => {
		void loadDossier(customerId)
	}, [customerId, loadDossier])

	// 1. Estado de carga inicial con skeletons
	if (isLoading) {
		return (
			<div className="space-y-6 animate-pulse">
				<div className="flex items-center gap-2">
					<div className="h-4 w-28 bg-slate-200 rounded"></div>
				</div>
				<div className="space-y-2">
					<div className="h-8 w-64 bg-slate-200 rounded-md"></div>
					<div className="h-4 w-48 bg-slate-100 rounded"></div>
				</div>
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
					{[1, 2, 3, 4].map(i => (
						<div key={i} className="h-24 bg-slate-100 rounded-xl border border-slate-200"></div>
					))}
				</div>
				<div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
					<div className="lg:col-span-5 h-72 bg-slate-100 rounded-xl border border-slate-200"></div>
					<div className="lg:col-span-7 h-72 bg-slate-100 rounded-xl border border-slate-200"></div>
				</div>
				<div className="h-80 bg-slate-100 rounded-xl border border-slate-200"></div>
			</div>
		)
	}

	// 2. Estado de error 404: Cliente no encontrado
	if (error !== null && error.statusCode === 404) {
		return (
			<div className="space-y-6">
				<div>
					<Link
						to="/clientes"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Volver a Clientes</span>
					</Link>
				</div>
				<Card className="border-slate-200 shadow-xs text-center py-12 px-6">
					<div className="w-14 h-14 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-4">
						<UserX className="w-7 h-7" />
					</div>
					<CardTitle className="text-xl font-bold text-slate-800">Cliente no encontrado</CardTitle>
					<CardDescription className="text-sm text-slate-500 max-w-md mx-auto mt-2">
						No existe ningún cliente registrado con el identificador{' '}
						<span className="font-mono font-medium text-slate-700">&ldquo;{customerId}&rdquo;</span>.
						Es posible que el cliente haya sido reclasificado o que la ruta sea incorrecta.
					</CardDescription>
					<div className="mt-6">
						<Button asChild variant="default" size="sm" className="gap-1.5">
							<Link to="/clientes">
								<ArrowLeft className="w-4 h-4" />
								<span>Ir al Directorio de Clientes</span>
							</Link>
						</Button>
					</div>
				</Card>
			</div>
		)
	}

	// 3. Estado de error genérico de servidor o conexión
	if (error !== null || data === null) {
		const errorMessage = error?.message ?? 'No se pudo obtener la información del cliente.'
		return (
			<div className="space-y-6">
				<div>
					<Link
						to="/clientes"
						className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-indigo-600 transition-colors"
					>
						<ArrowLeft className="w-4 h-4" />
						<span>Volver a Clientes</span>
					</Link>
				</div>
				<Card className="border-red-200 bg-red-50 text-red-900 shadow-xs">
					<CardHeader>
						<div className="flex items-center gap-2">
							<AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
							<CardTitle className="text-red-800">Error al consultar el expediente</CardTitle>
						</div>
						<CardDescription className="text-red-600 mt-1">{errorMessage}</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant="outline"
							className="border-red-300 text-red-800 hover:bg-red-100 gap-2"
							onClick={() => void loadDossier(customerId)}
						>
							<RotateCcw className="w-4 h-4" />
							<span>Reintentar</span>
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	const { customer, metrics, contracts, invoices, events } = data
	const isNatural = customer.personType === 'NATURAL'
	const isPaidUp = metrics.oldestOpenDueDate === null

	// Ordenar eventos de más reciente a más antiguo
	const sortedEvents = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

	return (
		<div className="space-y-6">
			{/* Enlace de navegación de retorno */}
			<div>
				<Link
					to="/clientes"
					className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 hover:text-purple-700 transition-colors bg-white/80 hover:bg-white px-3 py-1.5 rounded-xl border border-purple-100/60 shadow-2xs"
				>
					<ArrowLeft className="w-3.5 h-3.5" />
					<span>Volver al Directorio</span>
				</Link>
			</div>

			{/* Encabezado del cliente */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
				<div className="flex items-center gap-3.5">
					<div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 text-purple-900 font-extrabold text-base flex items-center justify-center shrink-0 border border-purple-200/60 shadow-xs">
						{customer.name.slice(0, 2).toUpperCase()}
					</div>
					<div>
						<div className="flex items-center gap-2.5 flex-wrap">
							<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
								{customer.name}
							</h1>
							{isNatural ? (
								<Badge variant="secondary" className="bg-slate-100 text-slate-700 font-semibold text-xs">
									Persona natural
								</Badge>
							) : (
								<Badge
									variant="outline"
									className="border-purple-200 bg-purple-50 text-purple-700 font-semibold text-xs"
								>
									Persona jurídica
								</Badge>
							)}
						</div>
						<p className="text-xs text-slate-500 font-mono mt-1 font-medium">
							Documento: <span className="font-bold text-slate-700 bg-slate-100/80 px-2 py-0.5 rounded-md border border-slate-200/50">{customer.originalDocument}</span>
						</p>
					</div>
				</div>
			</div>

			{/* Resumen financiero (4 Tarjetas KPI con Squircles estilo Revora) */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
				{/* 1. Deuda abierta */}
				<Card className="rounded-2xl border-purple-100/80 bg-gradient-to-br from-white via-white to-purple-50/30 shadow-[0_2px_14px_-4px_rgba(100,50,200,0.06)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-purple-700">
							Deuda Abierta
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-purple-100/80 border border-purple-200/60 flex items-center justify-center text-purple-700 shadow-2xs">
							<DollarSign className="w-4 h-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold font-mono text-purple-950 tracking-tight">
							{formatUsd(metrics.openBalanceCents)}
						</div>
						<div className="pt-1">
							{isPaidUp ? (
								<span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
									Al día
								</span>
							) : (
								<span className="text-[11px] text-slate-400 font-mono">
									Vence: <strong className="text-slate-600 font-bold">{formatDate(metrics.oldestOpenDueDate)}</strong>
								</span>
							)}
						</div>
					</CardContent>
				</Card>

				{/* 2. Facturas abiertas */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Facturas Abiertas
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shadow-2xs">
							<Clock className="w-4 h-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold font-mono text-slate-900 tracking-tight">
							{metrics.openInvoicesCount}
						</div>
						<div className="pt-1">
							<span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200/50">
								{metrics.openInvoicesCount === 1 ? '1 pendiente' : `${metrics.openInvoicesCount} pendientes`}
							</span>
						</div>
					</CardContent>
				</Card>

				{/* 3. Facturas pagadas */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Facturas Pagadas
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 shadow-2xs">
							<CheckCircle2 className="w-4 h-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold font-mono text-slate-900 tracking-tight">
							{metrics.paidInvoicesCount}
						</div>
						<div className="pt-1">
							<span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/50">
								{metrics.paidInvoicesCount === 1 ? '1 liquidada' : `${metrics.paidInvoicesCount} liquidadas`}
							</span>
						</div>
					</CardContent>
				</Card>

				{/* 4. Contratos */}
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all group">
					<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
						<CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-400">
							Contratos
						</CardTitle>
						<div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-2xs">
							<Layers className="w-4 h-4" />
						</div>
					</CardHeader>
					<CardContent className="space-y-1">
						<div className="text-3xl font-extrabold font-mono text-slate-900 tracking-tight">
							{metrics.totalContractsCount}
						</div>
						<div className="pt-1">
							<span className="text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200/50">
								{metrics.totalContractsCount === 1 ? '1 servicio' : `${metrics.totalContractsCount} servicios`}
							</span>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Ficha de Datos del Cliente y Contratos Asociados */}
			<div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
				{/* Bloque Izquierdo: Datos del Cliente */}
				<Card className="lg:col-span-5 border-slate-200 shadow-xs overflow-hidden">
					<CardHeader className="border-b border-slate-100 bg-white p-5">
						<div className="flex items-center gap-2">
							<User className="w-4 h-4 text-slate-500" />
							<CardTitle className="text-base font-semibold text-slate-900">Datos del cliente</CardTitle>
						</div>
					</CardHeader>
					<CardContent className="p-5 divide-y divide-slate-100 text-sm">
						<div className="py-2.5 flex items-center justify-between gap-4">
							<span className="text-slate-500 font-medium">Identificador interno</span>
							<span className="font-mono text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
								{customer.id}
							</span>
						</div>
						<div className="py-2.5 flex items-center justify-between gap-4">
							<span className="text-slate-500 font-medium">Documento</span>
							<span className="font-mono text-xs font-semibold text-slate-800">
								{customer.originalDocument}
							</span>
						</div>
						<div className="py-2.5 flex items-center justify-between gap-4">
							<span className="text-slate-500 font-medium flex items-center gap-1.5">
								<Mail className="w-3.5 h-3.5 text-slate-400" />
								<span>Correo</span>
							</span>
							<span className="text-slate-800 truncate max-w-[220px]" title={customer.email || undefined}>
								{customer.email.length > 0 ? customer.email : '—'}
							</span>
						</div>
						<div className="py-2.5 flex items-center justify-between gap-4">
							<span className="text-slate-500 font-medium flex items-center gap-1.5">
								<Phone className="w-3.5 h-3.5 text-slate-400" />
								<span>Teléfono</span>
							</span>
							<span className="text-slate-800 font-mono text-xs">
								{customer.phone.length > 0 ? customer.phone : '—'}
							</span>
						</div>
						<div className="py-2.5 flex flex-col gap-1">
							<span className="text-slate-500 font-medium flex items-center gap-1.5">
								<MapPin className="w-3.5 h-3.5 text-slate-400" />
								<span>Dirección</span>
							</span>
							<span className="text-slate-700 text-xs">
								{customer.address.length > 0 ? customer.address : '—'}
							</span>
						</div>
						<div className="py-2.5 flex items-center justify-between gap-4">
							<span className="text-slate-500 font-medium flex items-center gap-1.5">
								<Calendar className="w-3.5 h-3.5 text-slate-400" />
								<span>Registrado</span>
							</span>
							<span className="text-slate-600 text-xs">
								{formatDateTime(customer.createdAt)}
							</span>
						</div>
					</CardContent>
				</Card>

				{/* Bloque Derecho: Contratos en el Administrador */}
				<Card className="lg:col-span-7 border-slate-200 shadow-xs overflow-hidden">
					<CardHeader className="border-b border-slate-100 bg-white p-5">
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Layers className="w-4 h-4 text-slate-500" />
								<CardTitle className="text-base font-semibold text-slate-900">
									Contratos en el administrador
								</CardTitle>
							</div>
							<span className="text-xs text-slate-500 font-medium">
								{contracts.length} {contracts.length === 1 ? 'contrato' : 'contratos'}
							</span>
						</div>
					</CardHeader>
					<CardContent className="p-0">
						{contracts.length === 0 ? (
							<div className="py-12 text-center text-slate-500 text-sm">
								No hay contratos asociados a este cliente.
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="w-full text-left text-sm border-collapse min-w-[560px]">
									<thead className="border-b border-slate-100 bg-slate-50/75 text-xs text-slate-500 font-semibold uppercase tracking-wider">
										<tr>
											<th className="py-3 px-4">Contrato</th>
											<th className="py-3 px-4">Estado</th>
											<th className="py-3 px-4">Plan y Tarifa</th>
											<th className="py-3 px-4">Sucursal</th>
											<th className="py-3 px-4 text-right">Facturación / Corte</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{contracts.map((contract: ContractItemDto) => {
											const normalizedStatus = contract.status.toUpperCase()
											const isActivo = normalizedStatus === 'ACTIVO'
											const isCortado = normalizedStatus === 'CORTADO'

											return (
												<tr key={contract.id} className="hover:bg-slate-50/50 transition-colors">
													<td className="py-3 px-4">
														<span className="font-mono font-semibold text-slate-800 text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
															{contract.code}
														</span>
													</td>
													<td className="py-3 px-4">
														{isActivo ? (
															<span className="inline-flex items-center text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
																ACTIVO
															</span>
														) : isCortado ? (
															<span className="inline-flex items-center text-[11px] font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
																CORTADO
															</span>
														) : (
															<Badge variant="outline" className="text-[11px]">
																{contract.status}
															</Badge>
														)}
													</td>
													<td className="py-3 px-4">
														<div className="font-medium text-slate-800 text-xs">{contract.plan}</div>
														<div className="font-mono text-xs text-slate-500">
															{formatUsd(contract.planPriceCents)}/mes
														</div>
													</td>
													<td className="py-3 px-4 text-xs font-medium text-slate-600">
														{contract.branch}
													</td>
													<td className="py-3 px-4 text-right text-xs text-slate-600 font-mono">
														Día {contract.billingDay} / Día {contract.cutoffDay}
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

			{/* Tabla de Facturas */}
			<Card className="border-slate-200 shadow-xs overflow-hidden">
				<CardHeader className="border-b border-slate-100 bg-white p-5">
					<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<FileText className="w-4 h-4 text-slate-500" />
							<CardTitle className="text-base font-semibold text-slate-900">Facturas</CardTitle>
						</div>
						<span className="text-xs text-slate-500 font-medium">
							Una factura por cuota del administrador ({invoices.length} {invoices.length === 1 ? 'registrada' : 'registradas'})
						</span>
					</div>
				</CardHeader>
				<CardContent className="p-0">
					{invoices.length === 0 ? (
						<div className="py-12 text-center text-slate-500 text-sm">
							No hay facturas registradas para este cliente.
						</div>
					) : (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm border-collapse min-w-[650px]">
								<thead className="border-b border-slate-100 bg-slate-50/75 text-xs text-slate-500 font-semibold uppercase tracking-wider">
									<tr>
										<th className="py-3 px-4">Factura</th>
										<th className="py-3 px-4">Cuota ext.</th>
										<th className="py-3 px-4">Período</th>
										<th className="py-3 px-4">Vence</th>
										<th className="py-3 px-4">Corte</th>
										<th className="py-3 px-4 text-right">Total</th>
										<th className="py-3 px-4 text-right">Saldo</th>
										<th className="py-3 px-6 text-right">Estado</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{invoices.map((inv: InvoiceItemDto) => {
										const isPaid = inv.status === 'PAID'

										return (
											<tr key={inv.id} className="hover:bg-slate-50/50 transition-colors">
												<td className="py-3.5 px-4 font-mono font-medium text-slate-900 text-xs">
													{inv.invoiceNumber}
												</td>
												<td className="py-3.5 px-4 text-xs">
													<div className="font-mono text-slate-800">{inv.externalDebtId}</div>
													<div className="text-[11px] text-slate-400">Contrato #{inv.contractId}</div>
												</td>
												<td className="py-3.5 px-4 text-xs text-slate-700">
													{inv.period}
												</td>
												<td className="py-3.5 px-4 font-mono text-xs text-slate-600">
													{formatDate(inv.dueDate)}
												</td>
												<td className="py-3.5 px-4 font-mono text-xs text-slate-600">
													{formatDate(inv.cutDate)}
												</td>
												<td className="py-3.5 px-4 text-right font-mono text-xs text-slate-800">
													{formatUsd(inv.totalAmountCents)}
												</td>
												<td className="py-3.5 px-4 text-right font-mono text-xs font-semibold text-slate-900">
													{formatUsd(inv.balanceCents)}
												</td>
												<td className="py-3.5 px-6 text-right">
													{isPaid ? (
														<div className="inline-flex flex-col items-end">
															<span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
																Pagada
															</span>
															{inv.paidAt !== null && (
																<span className="text-[10px] text-slate-500 font-mono mt-0.5">
																	{formatDate(inv.paidAt)}
																</span>
															)}
															{inv.ispPaymentInvoice !== null && (
																<span className="text-[10px] text-slate-400 font-mono">
																	Recibo: {inv.ispPaymentInvoice}
																</span>
															)}
														</div>
													) : (
														<span className="inline-flex items-center text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
															Abierta
														</span>
													)}
												</td>
											</tr>
										)
									})}
								</tbody>
							</table>
						</div>
					)}
					<div className="p-4 bg-slate-50/75 border-t border-slate-100 text-xs text-slate-500 leading-relaxed">
						El vencimiento es el primer día del período, como en el sync real de Cobrix: el administrador de facturas no proporciona un vencimiento por cuota. La fecha de corte suma los días de gracia configurados.
					</div>
				</CardContent>
			</Card>

			{/* Historial de Auditoría / Eventos */}
			<Card className="border-slate-200 shadow-xs overflow-hidden">
				<CardHeader className="border-b border-slate-100 bg-white p-5">
					<div className="flex items-center justify-between">
						<CardTitle className="text-base font-semibold text-slate-900">Historial</CardTitle>
						<span className="text-xs text-slate-500 font-medium">
							{sortedEvents.length} {sortedEvents.length === 1 ? 'evento registrado' : 'eventos registrados'}
						</span>
					</div>
				</CardHeader>
				<CardContent className="p-5">
					{sortedEvents.length === 0 ? (
						<div className="py-8 text-center text-slate-500 text-sm">
							No hay eventos registrados para este cliente.
						</div>
					) : (
						<div className="space-y-4">
							{sortedEvents.map((ev: CustomerEventItemDto) => {
								let title = 'Evento'
								let IconComponent = FileText
								let iconColor = 'text-slate-500 bg-slate-100'

								if (ev.eventType === 'CUSTOMER_CREATED') {
									title = 'Cliente creado'
									IconComponent = UserPlus
									iconColor = 'text-indigo-600 bg-indigo-50 border border-indigo-200/60'
								} else if (ev.eventType === 'INVOICE_IMPORTED') {
									title = 'Factura importada'
									IconComponent = FileText
									iconColor = 'text-blue-600 bg-blue-50 border border-blue-200/60'
								} else if (ev.eventType === 'INVOICE_PAID') {
									title = 'Factura pagada'
									IconComponent = CheckCircle2
									iconColor = 'text-emerald-600 bg-emerald-50 border border-emerald-200/60'
								} else if (ev.eventType === 'PARTIAL_PAYMENT') {
									title = 'Pago parcial'
									IconComponent = CreditCard
									iconColor = 'text-amber-600 bg-amber-50 border border-amber-200/60'
								}

								return (
									<div
										key={ev.id}
										className="flex items-start gap-3.5 p-3 rounded-lg hover:bg-slate-50/75 transition-colors border border-transparent hover:border-slate-100"
									>
										<div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${iconColor}`}>
											<IconComponent className="w-4 h-4" />
										</div>
										<div className="flex-1 min-w-0">
											<div className="flex items-baseline justify-between gap-2 flex-wrap">
												<span className="text-xs font-semibold text-slate-900">{title}</span>
												<span className="text-[11px] font-mono text-slate-400">
													{formatDateTime(ev.createdAt)}
												</span>
											</div>
											<p className="text-xs text-slate-600 mt-0.5 leading-relaxed break-words">
												{ev.description}
											</p>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
