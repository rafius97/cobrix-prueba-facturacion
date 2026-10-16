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
	}, [loadCustomers])

	function handleSearchSubmit(e: React.FormEvent<HTMLFormElement>): void {
		e.preventDefault()
		void loadCustomers(searchInput)
	}

	function handleClearSearch(): void {
		setSearchInput('')
		void loadCustomers('')
	}

	const totalCount = data?.totalCount ?? 0
	const counterText = `${totalCount} ${totalCount === 1 ? 'cliente' : 'clientes'}`

	return (
		<div className="space-y-6">
			{/* Encabezado */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-slate-900">Clientes</h1>
				<p className="text-sm text-slate-500 mt-1">
					Clientes creados por el sync del administrador. Un cliente por cédula o RIF: si el titular tiene varios contratos, se agrupan aquí.
				</p>
			</div>

			{/* Mensaje de error persistiendo datos previos si existen */}
			{error !== null && data !== null && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-center justify-between gap-3 text-red-800 text-sm">
					<div className="flex items-center gap-2">
						<AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
						<span>{error}</span>
					</div>
					<Button
						variant="outline"
						size="sm"
						className="border-red-300 text-red-800 hover:bg-red-100 gap-1.5 h-8 text-xs shrink-0"
						onClick={() => void loadCustomers(lastAttemptedQueryRef.current)}
					>
						<RotateCcw className="w-3.5 h-3.5" />
						<span>Reintentar</span>
					</Button>
				</div>
			)}

			{/* Mensaje de error bloqueante solo cuando no hay datos cargados */}
			{error !== null && data === null && (
				<Card className="border-red-200 bg-red-50 text-red-900">
					<CardHeader>
						<div className="flex items-center gap-2">
							<AlertCircle className="w-5 h-5 text-red-600" />
							<CardTitle className="text-red-800">Error al consultar clientes</CardTitle>
						</div>
						<CardDescription className="text-red-600 mt-1">{error}</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant="outline"
							className="border-red-300 text-red-800 hover:bg-red-100 gap-2"
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
				<Card className="shadow-xs overflow-hidden border-slate-200">
				<CardHeader className="p-4 sm:p-6 border-b border-slate-100 bg-white">
					<div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
						{/* Formulario de búsqueda */}
						<form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-md w-full">
							<div className="relative flex-1">
								<Input
									type="text"
									placeholder="Nombre, cédula o RIF"
									value={searchInput}
									onChange={e => setSearchInput(e.target.value)}
									className="pr-8"
								/>
								{searchInput.length > 0 && (
									<button
										type="button"
										onClick={() => setSearchInput('')}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-0.5"
										title="Borrar texto"
									>
										<X className="w-3.5 h-3.5" />
									</button>
								)}
							</div>
							<Button type="submit" variant="default" className="gap-1.5 shrink-0" disabled={isLoading}>
								<Search className="w-4 h-4" />
								<span>Buscar</span>
							</Button>
							{activeSearch.length > 0 && (
								<Button
									type="button"
									variant="outline"
									onClick={handleClearSearch}
									className="gap-1 shrink-0 text-slate-600 hover:text-slate-900"
									disabled={isLoading}
									title="Restablecer listado completo"
								>
									<span>Limpiar</span>
								</Button>
							)}
						</form>

						{/* Contador de clientes */}
						<div className="flex items-center gap-2 self-end sm:self-auto text-sm text-slate-600 font-medium">
							<Users className="w-4 h-4 text-slate-400" />
							<span className="font-semibold text-slate-800">{counterText}</span>
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

					{/* 4. Tabla de Clientes */}
					{data !== null && data.customers.length > 0 && (
						<div className="overflow-auto relative max-h-[calc(100vh-280px)]">
							{/* Indicador sutil de recarga durante búsquedas secundarias */}
							{isLoading && (
								<div className="absolute inset-0 bg-white/60 backdrop-blur-2xs flex items-center justify-center z-20 transition-opacity">
									<div className="flex items-center gap-2 bg-white px-4 py-2 rounded-lg shadow-sm border border-slate-200 text-sm font-medium text-slate-700">
										<RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
										<span>Actualizando resultados...</span>
									</div>
								</div>
							)}

							<table className="w-full text-left text-sm border-collapse">
								<thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 font-semibold uppercase tracking-wider sticky top-0 z-10 shadow-xs">
									<tr>
										<th className="py-3 px-6">Cliente</th>
										<th className="py-3 px-4">Documento</th>
										<th className="py-3 px-4">Tipo</th>
										<th className="py-3 px-4 text-center">Contratos</th>
										<th className="py-3 px-4 text-center">Abiertas</th>
										<th className="py-3 px-4 text-center">Pagadas</th>
										<th className="py-3 px-4 text-right">Deuda</th>
										<th className="py-3 px-6 text-right">Vence la más antigua</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{data.customers.map((customer: CustomerListItemDto) => {
										const isJuridica = customer.personType === 'JURIDICA'
										const isPaidUp = customer.oldestOpenDueDate === null

										return (
											<tr
												key={customer.customerId}
												className="hover:bg-indigo-50/30 transition-colors group"
											>
												{/* 1. Cliente */}
												<td className="py-3.5 px-6 font-medium">
													<Link
														to={`/clientes/${customer.customerId}`}
														className="text-indigo-600 hover:text-indigo-800 font-semibold transition-colors hover:underline"
													>
														{customer.name}
													</Link>
												</td>

												{/* 2. Documento */}
												<td className="py-3.5 px-4 font-mono text-xs text-slate-700">
													<span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
														{customer.originalDocument}
													</span>
												</td>

												{/* 3. Tipo */}
												<td className="py-3.5 px-4">
													{isJuridica ? (
														<Badge
															variant="outline"
															className="border-purple-200 bg-purple-50 text-purple-700 font-medium"
														>
															Jurídica
														</Badge>
													) : (
														<Badge
															variant="secondary"
															className="bg-slate-100 text-slate-700 font-medium"
														>
															Natural
														</Badge>
													)}
												</td>

												{/* 4. Contratos */}
												<td className="py-3.5 px-4 text-center font-mono text-slate-700">
													{customer.totalContractsCount}
												</td>

												{/* 5. Abiertas */}
												<td className="py-3.5 px-4 text-center font-mono text-slate-700">
													{customer.openInvoicesCount}
												</td>

												{/* 6. Pagadas */}
												<td className="py-3.5 px-4 text-center font-mono text-slate-700">
													{customer.paidInvoicesCount}
												</td>

												{/* 7. Deuda */}
												<td className="py-3.5 px-4 text-right font-mono font-semibold text-slate-900">
													{formatUsd(customer.openBalanceCents)}
												</td>

												{/* 8. Vence la más antigua */}
												<td className="py-3.5 px-6 text-right">
													{isPaidUp ? (
														<span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
															Al día
														</span>
													) : (
														<span className="font-mono text-xs text-slate-600">
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
					)}
				</CardContent>
			</Card>
			)}
		</div>
	)
}
