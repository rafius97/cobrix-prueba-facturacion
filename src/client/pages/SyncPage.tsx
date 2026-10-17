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
			{/* Encabezado */}
			<div>
				<h1 className="text-2xl font-bold tracking-tight text-slate-900">
					Sincronización de Facturación
				</h1>
				<p className="text-sm text-slate-500 mt-1">
					Gestión de cuotas y cobranzas con el administrador ISP. Ejecuta importaciones y conciliaciones reales o pruebas en modo simulación.
				</p>
			</div>

			{/* Banner de Feedback de Operación (Éxito, Error o Conflicto 409) */}
			{operationFeedback !== null && (
				<div
					className={`rounded-xl border p-4 flex items-start justify-between gap-3 text-sm shadow-xs transition-all ${
						operationFeedback.isConflict
							? 'border-amber-300 bg-amber-50 text-amber-900'
							: operationFeedback.isSuccess
								? 'border-emerald-300 bg-emerald-50 text-emerald-900'
								: 'border-red-300 bg-red-50 text-red-900'
					}`}
				>
					<div className="flex items-start gap-3">
						{operationFeedback.isConflict ? (
							<AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
						) : operationFeedback.isSuccess ? (
							<CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
						) : (
							<XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
						)}
						<div>
							<h4 className="font-semibold">
								{operationFeedback.isConflict
									? 'Operación en curso'
									: operationFeedback.isSuccess
										? 'Operación completada'
										: 'Error en la operación'}
							</h4>
							<p className="mt-0.5">{operationFeedback.message}</p>
						</div>
					</div>
					<button
						type="button"
						onClick={() => setOperationFeedback(null)}
						className="text-slate-400 hover:text-slate-600 p-1 text-xs font-semibold"
					>
						Cerrar
					</button>
				</div>
			)}

			{/* Tarjetas de Acciones Principales */}
			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* 1. Tarjeta de Importación de Cuotas */}
				<Card className="border-slate-200 bg-white shadow-xs flex flex-col justify-between">
					<CardHeader>
						<div className="flex items-center gap-2.5">
							<div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
								<Download className="w-5 h-5" />
							</div>
							<div>
								<CardTitle className="text-lg">Importar cuotas y deudas</CardTitle>
								<CardDescription className="text-xs mt-0.5">
									Consulta cuotas pendientes del ISP, normaliza clientes y crea facturas
								</CardDescription>
							</div>
						</div>
						<p className="text-sm text-slate-600 pt-3">
							Inspecciona los contratos del ISP, agrupa los contratos por cédula/RIF y genera las facturas pendientes de Cobrix aplicando las reglas de divisas, límites y ventanas de cobro.
						</p>
					</CardHeader>
					<CardContent className="pt-0">
						<div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto gap-2 border-slate-300 text-slate-700 hover:bg-slate-50"
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
								className="w-full sm:w-auto gap-2 bg-indigo-600 hover:bg-indigo-700 text-white"
								disabled={isOperating}
								onClick={() => handleRequestRealSync('import')}
							>
								{activeAction === 'import' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-white" />
								) : (
									<FileDown className="w-4 h-4" />
								)}
								<span>Importar</span>
							</Button>
						</div>
					</CardContent>
				</Card>

				{/* 2. Tarjeta de Actualización de Pagos */}
				<Card className="border-slate-200 bg-white shadow-xs flex flex-col justify-between">
					<CardHeader>
						<div className="flex items-center gap-2.5">
							<div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
								<DollarSign className="w-5 h-5" />
							</div>
							<div>
								<CardTitle className="text-lg">Actualizar estado de pagos</CardTitle>
								<CardDescription className="text-xs mt-0.5">
									Concilia facturas abiertas contra el libro de pagos del ISP
								</CardDescription>
							</div>
						</div>
						<p className="text-sm text-slate-600 pt-3">
							Examina los cobros efectivos registrados en el ISP, marca como pagadas las facturas con comprobante verificable y aplica abonos parciales ajustando el balance pendiente.
						</p>
					</CardHeader>
					<CardContent className="pt-0">
						<div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								className="w-full sm:w-auto gap-2 border-slate-300 text-slate-700 hover:bg-slate-50"
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
								className="w-full sm:w-auto gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
								disabled={isOperating}
								onClick={() => handleRequestRealSync('payment')}
							>
								{activeAction === 'payment' ? (
									<RefreshCw className="w-4 h-4 animate-spin text-white" />
								) : (
									<CheckCircle2 className="w-4 h-4" />
								)}
								<span>Actualizar pagos</span>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Sección de Historial de Corridas */}
			<Card className="border-slate-200 bg-white shadow-xs overflow-hidden">
				<CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
					<div>
						<div className="flex items-center gap-2">
							<History className="w-5 h-5 text-indigo-600" />
							<CardTitle className="text-lg">Historial de Corridas</CardTitle>
						</div>
						<CardDescription className="text-xs mt-1">
							Registro cronológico de sincronizaciones y simulaciones ejecutadas
						</CardDescription>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void loadHistory()}
						disabled={isLoadingHistory || isOperating}
						className="gap-1.5 self-start sm:self-auto text-slate-600"
					>
						<RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
						<span>Actualizar historial</span>
					</Button>
				</CardHeader>

				<CardContent className="p-0">
					{/* Error al consultar historial */}
					{historyError !== null && (
						<div className="p-6 text-center">
							<div className="rounded-lg border border-red-200 bg-red-50 p-4 max-w-md mx-auto text-red-800 text-sm">
								<div className="flex items-center justify-center gap-2 mb-2 font-semibold text-red-900">
									<AlertCircle className="w-4 h-4" />
									<span>No se pudo cargar el historial</span>
								</div>
								<p className="text-xs text-red-700 mb-3">{historyError}</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => void loadHistory()}
									className="border-red-300 text-red-900 hover:bg-red-100 gap-1.5"
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
								<div key={i} className="h-10 bg-slate-100 rounded-md w-full"></div>
							))}
						</div>
					)}

					{/* Estado Vacío */}
					{!isLoadingHistory && historyData !== null && historyData.runs.length === 0 && (
						<div className="py-16 text-center px-4">
							<div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
								<Clock className="w-6 h-6" />
							</div>
							<h3 className="text-base font-semibold text-slate-800">
								No hay corridas registradas
							</h3>
							<p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
								Todavía no se ha realizado ninguna importación ni actualización de pagos. Utiliza las opciones superiores para iniciar una simulación o importación real.
							</p>
						</div>
					)}

					{/* Tabla de Corridas */}
					{historyData !== null && historyData.runs.length > 0 && (
						<div className="overflow-x-auto">
							<table className="w-full text-left text-sm border-collapse">
								<thead className="border-b border-slate-100 bg-slate-50/75 text-xs text-slate-500 font-semibold uppercase tracking-wider">
									<tr>
										<th className="py-3 px-6">Tipo</th>
										<th className="py-3 px-4">Modalidad</th>
										<th className="py-3 px-4">Origen</th>
										<th className="py-3 px-4">Inicio</th>
										<th className="py-3 px-4">Estado</th>
										<th className="py-3 px-6">Resultado</th>
										<th className="py-3 px-6 text-right">Acción</th>
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
												className="hover:bg-indigo-50/20 transition-colors group"
											>
												{/* 1. Tipo */}
												<td className="py-3.5 px-6 font-medium text-slate-900">
													<div className="flex items-center gap-2">
														{isImport ? (
															<Download className="w-4 h-4 text-indigo-600" />
														) : (
															<DollarSign className="w-4 h-4 text-emerald-600" />
														)}
														<span className="font-semibold">
															{isImport ? 'Importación' : 'Actualización de pagadas'}
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
															className="bg-indigo-50 text-indigo-700 border-indigo-200 font-medium"
														>
															Automática
														</Badge>
													) : (
														<Badge
															variant="secondary"
															className="bg-slate-100 text-slate-700 font-medium"
														>
															Manual
														</Badge>
													)}
												</td>

												{/* 4. Inicio */}
												<td className="py-3.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
													{formatDateTime(run.startedAt)}
												</td>

												{/* 4. Estado */}
												<td className="py-3.5 px-4">
													{isSuccess ? (
														<Badge variant="success" className="gap-1">
															<CheckCircle2 className="w-3 h-3" />
															<span>Completada</span>
														</Badge>
													) : (
														<Badge variant="destructive" className="gap-1">
															<XCircle className="w-3 h-3" />
															<span>Fallida</span>
														</Badge>
													)}
												</td>

												{/* 5. Resultado */}
												<td className="py-3.5 px-6 text-xs text-slate-700 max-w-md">
													<span className="line-clamp-2 leading-relaxed">
														{summaryText}
													</span>
												</td>

												{/* 6. Acción / Enlace a Detalle */}
												<td className="py-3.5 px-6 text-right">
													<Button asChild variant="outline" size="sm" className="gap-1 text-xs">
														<Link to={`/sincronizacion/corridas/${run.id}`}>
															<Eye className="w-3.5 h-3.5 text-slate-500" />
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
					className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-150"
				>
					<div
						className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4"
						onClick={e => e.stopPropagation()}
					>
						<div className="flex items-start gap-3">
							<div
								className={`p-2.5 rounded-lg shrink-0 ${
									pendingConfirmation === 'import'
										? 'bg-indigo-50 text-indigo-600'
										: 'bg-emerald-50 text-emerald-600'
								}`}
							>
								<AlertTriangle className="w-5 h-5 text-amber-500" />
							</div>
							<div className="space-y-1">
								<h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">
									{pendingConfirmation === 'import'
										? 'Confirmar importación real de cuotas'
										: 'Confirmar actualización real de pagos'}
								</h2>
								<p id="confirm-dialog-desc" className="text-xs text-slate-600 leading-relaxed">
									{pendingConfirmation === 'import'
										? 'Esta operación consultará la API del ISP y registrará o creará nuevos clientes, contratos y facturas en la base de datos de Cobrix. No se puede revertir de forma automática.'
										: 'Esta operación consultará el libro de cobros del ISP y actualizará los estados a PAGADA y los saldos de facturas abiertas en la base de datos de Cobrix.'}
								</p>
							</div>
						</div>

						<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
							<span className="font-semibold block">Acción con impacto en base de datos:</span>
							<p>
								Si solo deseas comprobar qué registros calificarían sin modificar los datos de Cobrix,
								cancela y utiliza la opción «Simular».
							</p>
						</div>

						<div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
							<Button
								type="button"
								variant="outline"
								onClick={handleCancelConfirmation}
								className="text-xs"
							>
								Cancelar
							</Button>
							<Button
								type="button"
								variant="default"
								onClick={handleConfirmRealSync}
								className={`text-xs text-white ${
									pendingConfirmation === 'import'
										? 'bg-indigo-600 hover:bg-indigo-700'
										: 'bg-emerald-600 hover:bg-emerald-700'
								}`}
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
