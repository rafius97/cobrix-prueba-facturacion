import * as React from 'react'
import { Link } from 'react-router-dom'
import {
	AlertCircle,
	ArrowRight,
	RefreshCw,
	RotateCcw,
	Search,
	SearchX,
	Users,
	X,
} from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { ApiClientError, fetchCustomers } from '../lib/api'
import { formatDate, formatUsd } from '../lib/utils'
import type { CustomerListItemDto, CustomerListResponseDto } from '../../shared/api-types'

export function CustomersPage(): React.JSX.Element {
	const [data, setData] = React.useState<CustomerListResponseDto | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [error, setError] = React.useState<string | null>(null)
	const [searchInput, setSearchInput] = React.useState<string>('')
	const [activeSearch, setActiveSearch] = React.useState<string>('')

	// Control de concurrencia para invalidar respuestas desfasadas
	const activeRequestIdRef = React.useRef<number>(0)
	// Registro de la última consulta intentada para reintentos exactos
	const lastAttemptedQueryRef = React.useRef<string>('')

	const loadCustomers = React.useCallback(async (query: string): Promise<void> => {
		const requestId = ++activeRequestIdRef.current
		const trimmed = query.trim()
		lastAttemptedQueryRef.current = trimmed

		try {
			setIsLoading(true)
			setError(null)
			const result = await fetchCustomers(trimmed.length > 0 ? trimmed : undefined)

			// Descartar si una solicitud posterior ya fue emitida
			if (requestId !== activeRequestIdRef.current) {
				return
			}

			setData(result)
			setActiveSearch(trimmed)
		} catch (err) {
			if (requestId !== activeRequestIdRef.current) {
				return
			}

			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'No se pudo cargar el directorio de clientes'
			setError(message)
		} finally {
			if (requestId === activeRequestIdRef.current) {
				setIsLoading(false)
			}
		}
	}, [])

	React.useEffect(() => {
		void loadCustomers('')
		return () => {
			// Invalida solicitudes en vuelo al desmontar el componente
			activeRequestIdRef.current++
		}
	}, [loadCustomers])

	function handleInputChange(e: React.ChangeEvent<HTMLInputElement>): void {
		const nextValue = e.target.value
		setSearchInput(nextValue)
		const trimmed = nextValue.trim()

		// 1. Si el término normalizado ya coincide con la búsqueda activa y los resultados de ella ya están visibles y sin error:
		if (trimmed === activeSearch && data !== null && error === null) {
			// Si había una petición intermedia en vuelo (ej. A -> B -> A),
			// invalidamos la petición de B para que su respuesta tardía no sobrescriba a A.
			if (isLoading) {
				activeRequestIdRef.current++
				setIsLoading(false)
			}
			lastAttemptedQueryRef.current = trimmed
			return
		}

		// 2. Si ya hay una petición en vuelo para exactamente este mismo término normalizado:
		if (trimmed === lastAttemptedQueryRef.current && isLoading) {
			return
		}

		// 3. De lo contrario, iniciar la búsqueda del nuevo término (o directorio completo si trimmed === '')
		void loadCustomers(trimmed)
	}

	function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>): void {
		e.preventDefault()
		const trimmed = searchInput.trim()

		if (trimmed === activeSearch && data !== null && error === null) {
			if (isLoading) {
				activeRequestIdRef.current++
				setIsLoading(false)
			}
			lastAttemptedQueryRef.current = trimmed
			return
		}

		if (trimmed === lastAttemptedQueryRef.current && isLoading) {
			return
		}

		void loadCustomers(trimmed)
	}

	function handleClearSearch(): void {
		setSearchInput('')

		// Si el directorio completo ya está visible y sin error:
		if (activeSearch === '' && data !== null && error === null) {
			// Si había una solicitud en vuelo, la invalidamos sin realizar una petición innecesaria
			if (isLoading) {
				activeRequestIdRef.current++
				setIsLoading(false)
			}
			lastAttemptedQueryRef.current = ''
			return
		}

		// Si ya está en curso una solicitud para el término vacío (directorio completo), no duplicarla
		if (lastAttemptedQueryRef.current === '' && isLoading) {
			return
		}

		// Si el directorio no estaba visible o había error, cargar el directorio completo
		void loadCustomers('')
	}

	const totalCount = data?.totalCount ?? 0
	const counterText = `${totalCount} ${totalCount === 1 ? 'cliente' : 'clientes'}`

	return (
		<div className="space-y-8">
			{/* Encabezado */}
			<div>
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
					Directorio de Clientes
				</h1>
				<p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
					Clientes consolidados por cédula o RIF. Si un titular posee varios contratos, se unifican bajo el mismo expediente.
				</p>
			</div>

			{/* Mensaje de error persistiendo datos previos si existen */}
			{error !== null && data !== null && (
				<div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-4 flex items-center justify-between gap-3 text-rose-800 text-sm">
					<div className="flex items-center gap-2">
						<AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
						<span>{error}</span>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="border-rose-300 text-rose-800 hover:bg-rose-100 gap-1.5 h-8 text-xs shrink-0 rounded-xl"
						onClick={() => void loadCustomers(lastAttemptedQueryRef.current)}
					>
						<RotateCcw className="w-3.5 h-3.5" />
						<span>Reintentar</span>
					</Button>
				</div>
			)}

			{/* Mensaje de error bloqueante solo cuando no hay datos cargados */}
			{error !== null && data === null && (
				<Card className="rounded-2xl border-rose-200 bg-rose-50 text-rose-900">
					<CardHeader>
						<div className="flex items-center gap-2">
							<AlertCircle className="w-5 h-5 text-rose-600" />
							<CardTitle className="text-rose-800 font-bold">Error al consultar clientes</CardTitle>
						</div>
						<CardDescription className="text-rose-600 mt-1">{error}</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant="outline"
							className="border-rose-300 text-rose-800 hover:bg-rose-100 gap-2 rounded-xl"
							onClick={() => void loadCustomers(lastAttemptedQueryRef.current)}
						>
							<RotateCcw className="w-4 h-4" />
							<span>Reintentar</span>
						</Button>
					</CardContent>
				</Card>
			)}

			{/* Tarjeta principal con Buscador y Tabla: visible con datos o durante carga inicial sin error */}
			{(data !== null || (isLoading && error === null)) && (
				<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] overflow-hidden">
				<CardHeader className="p-4 sm:p-6 border-b border-slate-100/80 bg-white">
					<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
						{/* Formulario de búsqueda estilo Revora */}
						<form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-md w-full">
							<div className="relative flex-1">
								<Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
								<Input
									type="text"
									placeholder="Buscar por nombre, cédula o RIF..."
									value={searchInput}
									onChange={handleInputChange}
									className="pl-9 pr-8 rounded-xl bg-slate-50/70 border-slate-200/80 focus:bg-white text-xs sm:text-sm"
								/>
								{searchInput.length > 0 && (
									<button
										type="button"
										onClick={handleClearSearch}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5 cursor-pointer"
										title="Borrar texto"
									>
										<X className="w-3.5 h-3.5" />
									</button>
								)}
							</div>
							{(activeSearch.length > 0 || searchInput.length > 0) && (
								<Button
									type="button"
									variant="outline"
									onClick={handleClearSearch}
									className="gap-1 shrink-0 text-slate-600 hover:text-slate-900 rounded-xl"
									disabled={isLoading}
									title="Restablecer listado completo"
								>
									<span>Limpiar</span>
								</Button>
							)}
						</form>

						{/* Contador de clientes */}
						<div className="flex items-center gap-2 self-end sm:self-auto text-xs sm:text-sm text-slate-500 font-medium">
							<div className="w-7 h-7 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center">
								<Users className="w-3.5 h-3.5" />
							</div>
							<span className="font-bold text-slate-800">{counterText}</span>
						</div>
					</div>
				</CardHeader>

				<CardContent className="p-0">
					{/* 1. Estado de carga inicial con filas Skeleton */}
					{isLoading && data === null && (
						<div className="p-6 space-y-4 animate-pulse">
							<div className="h-4 bg-slate-200 rounded-md w-full mb-4"></div>
							{[1, 2, 3, 4, 5, 6].map(i => (
								<div key={i} className="h-10 bg-slate-100 rounded-md w-full"></div>
							))}
						</div>
					)}

					{/* 2. Estado vacío: Búsqueda sin coincidencias */}
					{!isLoading && data !== null && data.customers.length === 0 && activeSearch.length > 0 && (
						<div className="py-16 text-center px-4">
							<div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
								<SearchX className="w-6 h-6" />
							</div>
							<h3 className="text-base font-semibold text-slate-800">Sin resultados</h3>
							<p className="text-sm text-slate-500 max-w-sm mx-auto mt-1">
								No se encontraron clientes que coincidan con &ldquo;{activeSearch}&rdquo;.
							</p>
							<div className="mt-4">
								<Button variant="outline" size="sm" onClick={handleClearSearch} className="gap-1.5">
									<RotateCcw className="w-3.5 h-3.5" />
									<span>Limpiar búsqueda</span>
								</Button>
							</div>
						</div>
					)}

					{/* 3. Estado vacío: Base de datos sin clientes importados */}
					{!isLoading && data !== null && data.customers.length === 0 && activeSearch.length === 0 && (
						<div className="py-16 text-center px-4">
							<div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto mb-3">
								<Users className="w-6 h-6" />
							</div>
							<h3 className="text-base font-semibold text-slate-800">No hay clientes importados</h3>
							<p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
								Aún no se han importado registros desde el administrador de facturas. Realiza una corrida de importación para poblar el directorio.
							</p>
							<div className="mt-4">
								<Button asChild variant="default" size="sm" className="gap-1.5">
									<Link to="/sincronizacion">
										<span>Ir a Sincronización</span>
										<ArrowRight className="w-3.5 h-3.5" />
									</Link>
								</Button>
							</div>
						</div>
					)}

					{/* 4. Lista de Clientes: Vista dual (Tarjetas en móvil, Tabla en tablet/escritorio) */}
					{data !== null && data.customers.length > 0 && (
						<div className="relative">
							{/* Indicador sutil de recarga durante búsquedas secundarias */}
							{isLoading && (
								<div className="absolute inset-0 bg-white/60 backdrop-blur-2xs flex items-center justify-center z-20 transition-opacity">
									<div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200 text-sm font-medium text-slate-700">
										<RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
										<span>Actualizando resultados...</span>
									</div>
								</div>
							)}

							{/* A. Vista de Tarjetas para Móviles (< sm / 640px) */}
							<div className="sm:hidden divide-y divide-purple-100/60">
								{data.customers.map((customer: CustomerListItemDto) => {
									const isJuridica = customer.personType === 'JURIDICA'
									const isPaidUp = customer.oldestOpenDueDate === null

									return (
										<div
											key={customer.customerId}
											className="p-4 space-y-3 hover:bg-purple-50/20 transition-colors"
										>
											<div className="flex items-start justify-between gap-3">
												<div className="flex items-center gap-2.5 min-w-0 flex-1">
													<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-100 to-indigo-100 text-purple-800 font-bold text-xs flex items-center justify-center shrink-0 border border-purple-200/50 shadow-2xs">
														{customer.name.slice(0, 2).toUpperCase()}
													</div>
													<div className="min-w-0 flex-1">
														<Link
															to={`/clientes/${customer.customerId}`}
															className="text-sm font-bold text-slate-900 hover:text-purple-700 transition-colors block truncate"
														>
															{customer.name}
														</Link>
														<div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
															<span className="font-mono text-[11px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200/50">
																{customer.originalDocument}
															</span>
															{isJuridica ? (
																<Badge
																	variant="outline"
																	className="border-purple-200 bg-purple-50 text-purple-700 font-semibold text-[10px]"
																>
																	Jurídica
																</Badge>
															) : (
																<Badge
																	variant="secondary"
																	className="bg-slate-100 text-slate-700 font-semibold text-[10px]"
																>
																	Natural
																</Badge>
															)}
														</div>
													</div>
												</div>

												<div className="text-right shrink-0">
													<div className="font-mono font-extrabold text-sm text-slate-900">
														{formatUsd(customer.openBalanceCents)}
													</div>
													<div className="text-[11px] mt-0.5">
														{isPaidUp ? (
															<span className="text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200/80 px-2 py-0.5 rounded-full">
																Al día
															</span>
														) : (
															<span className="text-slate-400 font-mono text-[10px]">
																Vence: {formatDate(customer.oldestOpenDueDate)}
															</span>
														)}
													</div>
												</div>
											</div>

											<div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-purple-50">
												<span className="font-medium text-slate-600">
													{customer.totalContractsCount} {customer.totalContractsCount === 1 ? 'contrato' : 'contratos'}
												</span>
												<div className="flex items-center gap-2 font-mono text-[11px]">
													<span className="text-amber-700 font-medium bg-amber-50 px-1.5 py-0.5 rounded-full">
														{customer.openInvoicesCount} abiertas
													</span>
													<span className="text-emerald-700 font-medium bg-emerald-50 px-1.5 py-0.5 rounded-full">
														{customer.paidInvoicesCount} pagadas
													</span>
												</div>
											</div>
										</div>
									)
								})}
							</div>

							{/* B. Vista de Tabla para Tablet y Escritorio (>= sm / 640px) */}
							<div className="hidden sm:block overflow-auto max-h-[calc(100vh-280px)]">
								<table className="w-full text-left text-sm border-collapse min-w-[680px]">
									<thead className="border-b border-purple-100/60 bg-[#f9f8fe] text-[11px] text-slate-400 font-bold uppercase tracking-wider sticky top-0 z-10 shadow-2xs">
										<tr>
											<th className="py-3.5 px-6">Cliente</th>
											<th className="py-3.5 px-4">Documento</th>
											<th className="py-3.5 px-4">Tipo</th>
											<th className="py-3.5 px-4 text-center">Contratos</th>
											<th className="py-3.5 px-4 text-center">Abiertas</th>
											<th className="py-3.5 px-4 text-center">Pagadas</th>
											<th className="py-3.5 px-4 text-right">Deuda</th>
											<th className="py-3.5 px-6 text-right">Vence la más antigua</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{data.customers.map((customer: CustomerListItemDto) => {
											const isJuridica = customer.personType === 'JURIDICA'
											const isPaidUp = customer.oldestOpenDueDate === null

											return (
												<tr
													key={customer.customerId}
													className="hover:bg-purple-50/20 transition-colors group"
												>
													{/* 1. Cliente con Squircle Avatar */}
													<td className="py-3 px-6">
														<div className="flex items-center gap-3">
															<div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-100 to-indigo-100 text-purple-800 font-bold text-xs flex items-center justify-center shrink-0 border border-purple-200/50 shadow-2xs">
																{customer.name.slice(0, 2).toUpperCase()}
															</div>
															<Link
																to={`/clientes/${customer.customerId}`}
																className="text-slate-900 font-bold hover:text-purple-700 transition-colors"
															>
																{customer.name}
															</Link>
														</div>
													</td>

													{/* 2. Documento */}
													<td className="py-3 px-4 font-mono text-xs text-slate-700">
														<span className="bg-slate-100/80 px-2 py-0.5 rounded-lg border border-slate-200/50">
															{customer.originalDocument}
														</span>
													</td>

													{/* 3. Tipo */}
													<td className="py-3 px-4">
														{isJuridica ? (
															<Badge
																variant="outline"
																className="border-purple-200 bg-purple-50 text-purple-700 font-semibold"
															>
																Jurídica
															</Badge>
														) : (
															<Badge
																variant="secondary"
																className="bg-slate-100 text-slate-700 font-semibold"
															>
																Natural
															</Badge>
														)}
													</td>

													{/* 4. Contratos */}
													<td className="py-3 px-4 text-center font-mono font-medium text-slate-700">
														{customer.totalContractsCount}
													</td>

													{/* 5. Abiertas */}
													<td className="py-3 px-4 text-center font-mono font-medium text-slate-700">
														{customer.openInvoicesCount}
													</td>

													{/* 6. Pagadas */}
													<td className="py-3 px-4 text-center font-mono font-medium text-slate-700">
														{customer.paidInvoicesCount}
													</td>

													{/* 7. Deuda */}
													<td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
														{formatUsd(customer.openBalanceCents)}
													</td>

													{/* 8. Vence la más antigua */}
													<td className="py-3 px-6 text-right">
														{isPaidUp ? (
															<span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
																Al día
															</span>
														) : (
															<span className="font-mono text-xs text-slate-500 font-medium">
																{formatDate(customer.oldestOpenDueDate)}
															</span>
														)}
													</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</CardContent>
			</Card>
			)}
		</div>
	)
}
