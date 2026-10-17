/**
 * Panel Principal de Sincronización de Cobrix (/sincronizacion).
 * Permite ejecutar y simular importaciones de cuotas y conciliación de facturas pagadas.
 * Muestra el historial de corridas anteriores con sus métricas consolidadas.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones inseguras (`as`).
 */

import * as React from 'react'
import { Link } from 'react-router-dom'
import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Clock,
	DollarSign,
	Download,
	Eye,
	FileDown,
	History,
	RefreshCw,
	RotateCcw,
	Sparkles,
	XCircle,
} from 'lucide-react'

import { Badge, ExecutionModeBadge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
	ApiClientError,
	fetchSyncRuns,
	triggerImportSync,
	triggerPaymentSync,
} from '../lib/api'
import { formatDateTime, formatUsd } from '../lib/utils'
import type {
	ImportRunSummaryDto,
	PaymentSyncSummaryDto,
	SyncRunItemDto,
	SyncRunListResponseDto,
} from '../../shared/api-types'

type ActiveSyncAction =
	| 'import'
	| 'import_simulation'
	| 'payment'
	| 'payment_simulation'
	| null

type PendingConfirmation = 'import' | 'payment' | null

/**
 * Deriva un texto explicativo human-readable a partir del resumen tipado de la corrida.
 */
function formatRunSummaryText(run: SyncRunItemDto): string {
	const summary = run.summary
	if (summary === null) {
		return run.errorMessage !== null && run.errorMessage.length > 0
			? run.errorMessage
			: 'Sin detalles de resumen disponibles'
	}

	if (summary.type === 'IMPORT') {
		const parts: string[] = []
		parts.push(
			`${summary.importedInvoicesCount} ${summary.importedInvoicesCount === 1 ? 'factura importada' : 'facturas importadas'}`,
		)
		if (summary.importedAmountCents > 0) {
			parts.push(formatUsd(summary.importedAmountCents))
		}
		if (summary.newCustomersCount > 0) {
			parts.push(
				`${summary.newCustomersCount} ${summary.newCustomersCount === 1 ? 'cliente nuevo' : 'clientes nuevos'}`,
			)
		}
		if (summary.alreadyImportedCount > 0) {
			parts.push(`${summary.alreadyImportedCount} ya registradas`)
		}
		return parts.join(' • ')
	}

	const parts: string[] = []
	parts.push(
		`${summary.markedPaidCount} ${summary.markedPaidCount === 1 ? 'factura pagada' : 'facturas pagadas'}`,
	)
	if (summary.markedPaidAmountCents > 0) {
		parts.push(formatUsd(summary.markedPaidAmountCents))
	}
	if (summary.partialPaymentsCount > 0) {
		parts.push(
			`${summary.partialPaymentsCount} ${summary.partialPaymentsCount === 1 ? 'abono parcial' : 'abonos parciales'} (${formatUsd(summary.partialPaymentsAmountCents)})`,
		)
	}
	if (summary.stillOpenCount > 0) {
		parts.push(`${summary.stillOpenCount} permanecen abiertas`)
	}
	return parts.join(' • ')
}

export function SyncPage(): React.JSX.Element {
	const [historyData, setHistoryData] = React.useState<SyncRunListResponseDto | null>(null)
	const [isLoadingHistory, setIsLoadingHistory] = React.useState<boolean>(true)
	const [historyError, setHistoryError] = React.useState<string | null>(null)

	// Control de la operación actualmente en ejecución
	const [activeAction, setActiveAction] = React.useState<ActiveSyncAction>(null)
	const [pendingConfirmation, setPendingConfirmation] = React.useState<PendingConfirmation>(null)
	const [operationFeedback, setOperationFeedback] = React.useState<{
		readonly isSuccess: boolean
		readonly isConflict: boolean
		readonly message: string
		readonly runItem?: SyncRunItemDto
	} | null>(null)

	// Carga del historial con soporte para refrescar
	const loadHistory = React.useCallback(async (): Promise<void> => {
		try {
			setIsLoadingHistory(true)
			setHistoryError(null)
			const result = await fetchSyncRuns(20)
			setHistoryData(result)
		} catch (err) {
			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'No se pudo cargar el historial de sincronizaciones'
			setHistoryError(message)
		} finally {
			setIsLoadingHistory(false)
		}
	}, [])

	React.useEffect(() => {
		void loadHistory()
	}, [loadHistory])

	// Disparador genérico para las operaciones POST
	async function handleExecuteSync(
		actionType: 'import' | 'import_simulation' | 'payment' | 'payment_simulation',
		isSimulation: boolean,
	): Promise<void> {
		if (activeAction !== null) return

		setActiveAction(actionType)
		setOperationFeedback(null)

		try {
			const runItem =
				actionType === 'import' || actionType === 'import_simulation'
					? await triggerImportSync(isSimulation)
					: await triggerPaymentSync(isSimulation)

			const isImport = runItem.type === 'IMPORT'
			const opName = isImport
				? isSimulation
					? 'Simulación de importación'
					: 'Importación de cuotas'
				: isSimulation
					? 'Simulación de actualización'
					: 'Actualización de pagos'

			const summaryText = formatRunSummaryText(runItem)
			const isSuccess = runItem.status === 'COMPLETED'
			const feedbackMessage = isSuccess
				? `${opName} finalizada con éxito: ${summaryText}`
				: `${opName} falló: ${runItem.errorMessage ?? summaryText}`

			setOperationFeedback({
				isSuccess,
				isConflict: false,
				message: feedbackMessage,
				runItem,
			})

			// Refrescar el historial de corridas en segundo plano
			try {
				const updatedHistory = await fetchSyncRuns(20)
				setHistoryData(updatedHistory)
			} catch {
				// No ocultar el resultado de la operación si falla la recarga del historial
			}
		} catch (err) {
			if (err instanceof ApiClientError && err.statusCode === 409) {
				setOperationFeedback({
					isSuccess: false,
					isConflict: true,
					message:
						'Hay otra operación de sincronización ejecutándose en este momento. Espera unos segundos a que finalice para intentarlo nuevamente.',
				})
			} else {
				const message =
					err instanceof ApiClientError
						? err.message
						: err instanceof Error
							? err.message
							: 'Ocurrió un error inesperado al procesar la sincronización'
				setOperationFeedback({
					isSuccess: false,
					isConflict: false,
					message,
				})
			}
		} finally {
			setActiveAction(null)
		}
	}

	function handleRequestRealSync(action: 'import' | 'payment'): void {
		if (activeAction !== null) return
		setPendingConfirmation(action)
	}

	function handleCancelConfirmation(): void {
		setPendingConfirmation(null)
	}

	function handleConfirmRealSync(): void {
		const actionToExecute = pendingConfirmation
		setPendingConfirmation(null)
		if (actionToExecute === 'import') {
			void handleExecuteSync('import', false)
		} else if (actionToExecute === 'payment') {
			void handleExecuteSync('payment', false)
		}
	}

	// Manejo de teclado para accesibilidad del modal de confirmación
	React.useEffect(() => {
		if (pendingConfirmation === null) return

		function handleKeyDown(e: KeyboardEvent): void {
			if (e.key === 'Escape') {
				e.preventDefault()
				handleCancelConfirmation()
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [pendingConfirmation])

	const isOperating = activeAction !== null

	return (
		<div className="space-y-8">
			{/* Encabezado estilo Revora */}
			<div>
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
					Sincronización de Facturación
				</h1>
				<p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
					Gestión de cuotas y cobranzas con el administrador ISP. Ejecuta importaciones y conciliaciones reales o pruebas en modo simulación.
				</p>
			</div>

			{/* Banner de Feedback de Operación (Éxito, Error o Conflicto 409) */}
			{operationFeedback !== null && (
				<div
					className={`rounded-2xl border p-4.5 flex items-start justify-between gap-3 text-sm shadow-xs transition-all ${
						operationFeedback.isConflict
							? 'border-amber-200 bg-amber-50/90 text-amber-900'
							: operationFeedback.isSuccess
								? 'border-emerald-200 bg-emerald-50/90 text-emerald-900'
								: 'border-rose-200 bg-rose-50/90 text-rose-900'
					}`}
				>
					<div className="flex items-start gap-3">
						{operationFeedback.isConflict ? (
							<AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
						) : operationFeedback.isSuccess ? (
							<CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
						) : (
							<XCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
						)}
						<div>
							<h4 className="font-bold">
								{operationFeedback.isConflict
									? 'Operación en curso'
									: operationFeedback.isSuccess
										? 'Operación completada'
										: 'Error en la operación'}
							</h4>
							<p className="mt-0.5 text-xs sm:text-sm font-medium opacity-90">{operationFeedback.message}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => setOperationFeedback(null)}
						className="text-slate-400 hover:text-slate-600 p-1 text-xs font-bold rounded-lg cursor-pointer"
					>
						Cerrar
					</button>
				</div>
			)}

			{/* Tarjetas de Acciones Principales (Inspiradas en Revora Pricing Cards) */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				{/* 1. Tarjeta de Importación de Cuotas */}
				<Card className="rounded-2xl border-slate-100/90 bg-white shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
					<div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-600 opacity-80" />
					<CardHeader className="p-6 pb-4">
						<div className="flex items-center justify-between gap-3">
							<div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100/80 text-indigo-700 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
								<Download className="w-5 h-5" />
							</div>
							<span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60">
								Fase 1 · Deudas
							</span>
						</div>
						<div className="pt-3">
							<CardTitle className="text-xl font-extrabold text-slate-900 tracking-tight">
								Importar cuotas y deudas
							</CardTitle>
							<CardDescription className="text-xs text-slate-500 mt-1 font-medium">
								Consulta cuotas pendientes del ISP, normaliza clientes y crea facturas
							</CardDescription>
						</div>

						{/* Lista de características estilo Revora */}
						<div className="pt-4 space-y-2.5 text-xs text-slate-600 font-medium">
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Inspección de contratos y cuotas pendientes en el ISP</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Normalización y agrupación automática por documento</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Idempotencia garantizada: omite duplicadas sin alterar balances</span>
							</div>
						</div>
					</CardHeader>

					<CardContent className="p-6 pt-0">
						<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-1/2 justify-center min-h-[44px] gap-2 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs font-semibold"
								disabled={isOperating}
								onClick={() => void handleExecuteSync('import_simulation', true)}
							>
								{activeAction === 'import_simulation' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
								) : (
									<Sparkles className="w-4 h-4 text-amber-500" />
								)}
								<span>Simular importación</span>
							</Button>
							<Button
								type="button"
								variant="default"
								className="w-full sm:w-1/2 justify-center min-h-[44px] gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-xs font-semibold"
								disabled={isOperating}
								onClick={() => handleRequestRealSync('import')}
							>
								{activeAction === 'import' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-white" />
								) : (
									<FileDown className="w-4 h-4 text-purple-300" />
								)}
								<span>Importar</span>
							</Button>
						</div>
					</CardContent>
				</Card>

				{/* 2. Tarjeta de Actualización de Pagos */}
				<Card className="rounded-2xl border-slate-100/90 bg-white shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden group">
					<div className="absolute top-0 right-0 left-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-600 opacity-80" />
					<CardHeader className="p-6 pb-4">
						<div className="flex items-center justify-between gap-3">
							<div className="w-11 h-11 rounded-2xl bg-emerald-50 border border-emerald-100/80 text-emerald-700 flex items-center justify-center shrink-0 shadow-2xs group-hover:scale-105 transition-transform">
								<DollarSign className="w-5 h-5" />
							</div>
							<span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/60">
								Fase 2 · Cobranzas
							</span>
						</div>
						<div className="pt-3">
							<CardTitle className="text-xl font-extrabold text-slate-900 tracking-tight">
								Actualizar estado de pagos
							</CardTitle>
							<CardDescription className="text-xs text-slate-500 mt-1 font-medium">
								Concilia facturas abiertas contra el libro de pagos del ISP
							</CardDescription>
						</div>

						{/* Lista de características estilo Revora */}
						<div className="pt-4 space-y-2.5 text-xs text-slate-600 font-medium">
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Comprobación de pagos reales con recibos verificables</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Liquidación total o registro de abono parcial con saldo residual</span>
							</div>
							<div className="flex items-center gap-2">
								<div className="w-4 h-4 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
									✓
								</div>
								<span>Detección de exenciones y protección contra inconsistencias</span>
							</div>
						</div>
					</CardHeader>

					<CardContent className="p-6 pt-0">
						<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-4 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-1/2 justify-center min-h-[44px] gap-2 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs font-semibold"
								disabled={isOperating}
								onClick={() => void handleExecuteSync('payment_simulation', true)}
							>
								{activeAction === 'payment_simulation' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-slate-500" />
								) : (
									<Sparkles className="w-4 h-4 text-amber-500" />
								)}
								<span>Simular actualización</span>
							</Button>
							<Button
								type="button"
								variant="default"
								className="w-full sm:w-1/2 justify-center min-h-[44px] gap-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white shadow-xs font-semibold"
								disabled={isOperating}
								onClick={() => handleRequestRealSync('payment')}
							>
								{activeAction === 'payment' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-white" />
								) : (
									<CheckCircle2 className="w-4 h-4 text-emerald-400" />
								)}
								<span>Actualizar pagos</span>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Sección de Historial de Corridas */}
			<Card className="rounded-2xl border-slate-100/90 bg-white shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] overflow-hidden">
				<CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100/80 p-5 sm:p-6 pb-4">
					<div>
						<div className="flex items-center gap-2.5">
							<div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
								<History className="w-4 h-4" />
							</div>
							<CardTitle className="text-lg font-extrabold text-slate-900 tracking-tight">
								Historial de Corridas
							</CardTitle>
						</div>
						<CardDescription className="text-xs text-slate-400 mt-1 font-medium">
							Registro cronológico de sincronizaciones y simulaciones ejecutadas
						</CardDescription>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void loadHistory()}
						disabled={isLoadingHistory || isOperating}
						className="gap-2 self-start sm:self-auto text-slate-700 rounded-xl border-slate-200 bg-white hover:bg-slate-50 font-semibold shadow-2xs"
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin text-purple-600' : 'text-slate-400'}`} />
						<span>Actualizar historial</span>
					</Button>
				</CardHeader>

				<CardContent className="p-0">
					{/* Error al consultar historial */}
					{historyError !== null && (
						<div className="p-6 text-center">
							<div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-5 max-w-md mx-auto text-rose-800 text-sm">
								<div className="flex items-center justify-center gap-2 mb-2 font-bold text-rose-900">
									<AlertCircle className="w-4 h-4 text-rose-600" />
									<span>No se pudo cargar el historial</span>
								</div>
								<p className="text-xs text-rose-700 mb-3">{historyError}</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => void loadHistory()}
									className="border-rose-300 text-rose-900 hover:bg-rose-100 gap-1.5 rounded-xl font-semibold"
								>
									<RotateCcw className="w-3.5 h-3.5" />
									<span>Reintentar</span>
								</Button>
							</div>
						</div>
					)}

					{/* Estado de carga inicial con Skeleton */}
					{isLoadingHistory && historyData === null && (
						<div className="p-6 space-y-3 animate-pulse">
							{[1, 2, 3, 4, 5].map(i => (
								<div key={i} className="h-10 bg-slate-100 rounded-xl w-full"></div>
							))}
						</div>
					)}

					{/* Estado Vacío */}
					{!isLoadingHistory && historyData !== null && historyData.runs.length === 0 && (
						<div className="py-16 text-center px-4">
							<div className="w-12 h-12 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center mx-auto mb-3">
								<Clock className="w-6 h-6" />
							</div>
							<h3 className="text-base font-bold text-slate-800">
								No hay corridas registradas
							</h3>
							<p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto mt-1 font-medium">
								Todavía no se ha realizado ninguna importación ni actualización de pagos. Utiliza las opciones superiores para iniciar una simulación o importación real.
							</p>
						</div>
					)}

					{/* Tabla de Corridas */}
					{historyData !== null && historyData.runs.length > 0 && (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm border-collapse min-w-[640px]">
								<thead className="border-b border-purple-100/60 bg-[#f9f8fe] text-[11px] text-slate-400 font-bold uppercase tracking-wider">
									<tr>
										<th className="py-3.5 px-6">Tipo</th>
										<th className="py-3.5 px-4">Modalidad</th>
										<th className="py-3.5 px-4">Origen</th>
										<th className="py-3.5 px-4">Inicio</th>
										<th className="py-3.5 px-4">Estado</th>
										<th className="py-3.5 px-6">Resultado</th>
										<th className="py-3.5 px-6 text-right">Acción</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{historyData.runs.map((run: SyncRunItemDto) => {
										const isImport = run.type === 'IMPORT'
										const isSuccess = run.status === 'COMPLETED'
										const summaryText = formatRunSummaryText(run)

										return (
											<tr
												key={run.id}
												className="hover:bg-purple-50/20 transition-colors group"
											>
												{/* 1. Tipo */}
												<td className="py-3.5 px-6 font-semibold text-slate-900">
													<div className="flex items-center gap-2">
														<div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isImport ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
															{isImport ? (
																<Download className="w-3.5 h-3.5" />
															) : (
																<DollarSign className="w-3.5 h-3.5" />
															)}
														</div>
														<span>
															{isImport ? 'Importación' : 'Actualización de pagos'}
														</span>
													</div>
												</td>

												{/* 2. Modalidad */}
												<td className="py-3.5 px-4">
													<ExecutionModeBadge isSimulation={run.isSimulation} />
												</td>

												{/* 3. Origen */}
												<td className="py-3.5 px-4">
													{run.triggerType === 'SCHEDULED' ? (
														<Badge
															variant="secondary"
															className="bg-purple-50 text-purple-700 border-purple-100 font-semibold"
														>
															Automática
														</Badge>
													) : (
														<Badge
															variant="secondary"
															className="bg-slate-100 text-slate-700 font-semibold"
														>
															Manual
														</Badge>
													)}
												</td>

												{/* 4. Inicio */}
												<td className="py-3.5 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
													{formatDateTime(run.startedAt)}
												</td>

												{/* 4. Estado */}
												<td className="py-3.5 px-4">
													{isSuccess ? (
														<Badge variant="success" className="gap-1 font-semibold">
															<CheckCircle2 className="w-3 h-3" />
															<span>Completada</span>
														</Badge>
													) : (
														<Badge variant="destructive" className="gap-1 font-semibold">
															<XCircle className="w-3 h-3" />
															<span>Fallida</span>
														</Badge>
													)}
												</td>

												{/* 5. Resultado */}
												<td className="py-3.5 px-6 text-xs text-slate-700 max-w-md">
													<span className="line-clamp-2 leading-relaxed font-medium">
														{summaryText}
													</span>
												</td>

												{/* 6. Acción / Enlace a Detalle */}
												<td className="py-3.5 px-6 text-right">
													<Button asChild variant="outline" size="sm" className="gap-1.5 text-xs rounded-xl font-semibold border-slate-200 bg-white hover:bg-slate-50">
														<Link to={`/sincronizacion/corridas/${run.id}`}>
															<Eye className="w-3.5 h-3.5 text-purple-600" />
															<span>Ver detalle</span>
														</Link>
													</Button>
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

			{/* Modal de confirmación accesible para operaciones reales */}
			{pendingConfirmation !== null && (
				<div
					role="dialog"
					aria-modal="true"
					aria-labelledby="confirm-dialog-title"
					aria-describedby="confirm-dialog-desc"
					className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-150"
				>
					<div
						className="bg-white rounded-2xl border border-purple-100/80 shadow-2xl max-w-md w-full p-6 space-y-4"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-start gap-3.5">
							<div
								className={`p-3 rounded-2xl shrink-0 ${
									pendingConfirmation === 'import'
										? 'bg-indigo-50 text-indigo-600 border border-indigo-100'
										: 'bg-emerald-50 text-emerald-600 border border-emerald-100'
								}`}
							>
								<AlertTriangle className="w-5 h-5 text-amber-500" />
							</div>
							<div className="space-y-1">
								<h2 id="confirm-dialog-title" className="text-base font-extrabold text-slate-900 tracking-tight">
									{pendingConfirmation === 'import'
										? 'Confirmar importación real de cuotas'
										: 'Confirmar actualización real de pagos'}
								</h2>
								<p id="confirm-dialog-desc" className="text-xs text-slate-500 leading-relaxed font-medium">
									{pendingConfirmation === 'import'
										? 'Esta operación consultará la API del ISP y registrará o creará nuevos clientes, contratos y facturas en la base de datos de Cobrix. No se puede revertir de forma automática.'
										: 'Esta operación consultará el libro de cobros del ISP y actualizará los estados a PAGADA y los saldos de facturas abiertas en la base de datos de Cobrix.'}
								</p>
							</div>
						</div>

						<div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 text-xs text-amber-900 space-y-1">
							<span className="font-bold block">Acción con impacto en base de datos:</span>
							<p className="font-medium text-amber-800">
								Si solo deseas comprobar qué registros calificarían sin modificar los datos de Cobrix,
								cancela y utiliza la opción «Simular».
							</p>
						</div>

						<div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3 pt-3 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								onClick={handleCancelConfirmation}
								className="w-full sm:w-auto justify-center min-h-[42px] text-xs rounded-xl font-semibold border-slate-200"
							>
								Cancelar
							</Button>
							<Button
								type="button"
								variant="default"
								onClick={handleConfirmRealSync}
								className="w-full sm:w-auto justify-center min-h-[42px] text-xs text-white rounded-xl font-semibold bg-slate-900 hover:bg-slate-800 shadow-xs"
							>
								{pendingConfirmation === 'import' ? 'Confirmar importación' : 'Confirmar actualización'}
							</Button>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
