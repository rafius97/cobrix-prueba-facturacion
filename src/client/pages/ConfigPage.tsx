/**
 * Pantalla de Configuración de Cobrix (/configuracion).
 * Permite consultar y actualizar los parámetros de la empresa, credenciales del ISP,
 * reglas de importación y topes por corrida, y probar la conexión con el ISP.
 * Estrictamente tipado sin `any` ni `unknown`. Sin aserciones inseguras (`as`).
 */

import * as React from 'react'
import {
	AlertCircle,
	Building2,
	CheckCircle2,
	Clock,
	DollarSign,
	FileText,
	HelpCircle,
	Loader2,
	Save,
	Server,
	SlidersHorizontal,
	Wifi,
	XCircle,
} from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import {
	ApiClientError,
	fetchConfig,
	testIspConnection,
	updateConfig,
} from '../lib/api'
import type {
	ConfigResponseDto,
	TestConnectionRequestDto,
	TestConnectionResponseDto,
	UpdateConfigRequestDto,
} from '../../shared/api-types'

// Opciones de estados de contrato soportadas por el ISP simulado y Cobrix
const AVAILABLE_CONTRACT_STATUSES: readonly string[] = [
	'ACTIVO',
	'CORTADO',
	'CORTESIA',
	'RETIRADO',
	'RECHAZADO',
	'ANULADO',
]

interface DocumentTypeOption {
	readonly type: string
	readonly label: string
}

const AVAILABLE_DOCUMENT_TYPES: readonly DocumentTypeOption[] = [
	{ type: 'V', label: 'V (Venezolano)' },
	{ type: 'E', label: 'E (Extranjero)' },
	{ type: 'J', label: 'J (Jurídico)' },
	{ type: 'G', label: 'G (Gubernamental)' },
	{ type: 'P', label: 'P (Pasaporte)' },
]

interface ConfigFormState {
	readonly companyName: string
	readonly companyTaxId: string
	readonly companyEmail: string
	readonly apiUrl: string
	readonly apiUsername: string
	readonly apiPassword: string
	readonly importableStatuses: readonly string[]
	readonly windowMonths: number | null
	readonly maxRecentInstallments: number | null
	readonly graceDays: number
	readonly runInvoiceLimit: number | null
	readonly runAmountLimitUsd: string
	readonly excludedDocumentTypes: readonly string[]
	readonly autoRunHour: string
	readonly autoRunActive: boolean
}

interface ActionFeedback {
	readonly success: boolean
	readonly message: string
}

function mapDtoToFormState(dto: ConfigResponseDto): ConfigFormState {
	const amountUsd =
		dto.runAmountLimitCents !== null
			? (dto.runAmountLimitCents / 100).toFixed(2)
			: ''

	return {
		companyName: dto.companyName,
		companyTaxId: dto.companyTaxId,
		companyEmail: dto.companyEmail,
		apiUrl: dto.apiUrl,
		apiUsername: dto.apiUsername,
		apiPassword: '', // Siempre vacía en la UI; la contraseña almacenada nunca se expone
		importableStatuses: dto.importableStatuses,
		windowMonths: dto.windowMonths,
		maxRecentInstallments: dto.maxRecentInstallments,
		graceDays: dto.graceDays,
		runInvoiceLimit: dto.runInvoiceLimit,
		runAmountLimitUsd: amountUsd,
		excludedDocumentTypes: dto.excludedDocumentTypes,
		autoRunHour: dto.autoRunHour,
		autoRunActive: dto.autoRunActive,
	}
}

export function ConfigPage(): React.JSX.Element {
	const [formState, setFormState] = React.useState<ConfigFormState | null>(null)
	const [isLoading, setIsLoading] = React.useState<boolean>(true)
	const [loadError, setLoadError] = React.useState<string | null>(null)

	// Estados de acción asíncrona
	const [isSavingCompany, setIsSavingCompany] = React.useState<boolean>(false)
	const [isSavingProvider, setIsSavingProvider] = React.useState<boolean>(false)
	const [isTestingConnection, setIsTestingConnection] = React.useState<boolean>(false)

	// Respuestas y retroalimentación para el usuario
	const [companyFeedback, setCompanyFeedback] = React.useState<ActionFeedback | null>(null)
	const [providerFeedback, setProviderFeedback] = React.useState<ActionFeedback | null>(null)
	const [testFeedback, setTestFeedback] = React.useState<ActionFeedback | null>(null)

	const isBusy = isSavingCompany || isSavingProvider || isTestingConnection

	const loadConfiguration = React.useCallback(async (): Promise<void> => {
		try {
			setIsLoading(true)
			setLoadError(null)
			const configDto = await fetchConfig()
			setFormState(mapDtoToFormState(configDto))
		} catch (err) {
			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'No se pudo cargar la configuración del sistema'
			setLoadError(message)
		} finally {
			setIsLoading(false)
		}
	}, [])

	React.useEffect(() => {
		void loadConfiguration()
	}, [loadConfiguration])

	// Handlers de edición de estados importables y tipos excluidos
	const handleToggleStatus = (status: string): void => {
		setFormState(prev => {
			if (prev === null) return null
			const exists = prev.importableStatuses.includes(status)
			const updated = exists
				? prev.importableStatuses.filter(s => s !== status)
				: [...prev.importableStatuses, status]
			return { ...prev, importableStatuses: updated }
		})
	}

	const handleToggleDocumentType = (docType: string): void => {
		setFormState(prev => {
			if (prev === null) return null
			const exists = prev.excludedDocumentTypes.includes(docType)
			const updated = exists
				? prev.excludedDocumentTypes.filter(d => d !== docType)
				: [...prev.excludedDocumentTypes, docType]
			return { ...prev, excludedDocumentTypes: updated }
		})
	}

	// Guardar bloque Empresa
	const handleSaveCompany = async (e: React.FormEvent): Promise<void> => {
		e.preventDefault()
		if (formState === null || isBusy) return

		setCompanyFeedback(null)

		const trimmedName = formState.companyName.trim()
		const trimmedTaxId = formState.companyTaxId.trim()
		const trimmedEmail = formState.companyEmail.trim()

		if (trimmedName.length === 0) {
			setCompanyFeedback({ success: false, message: 'El nombre de la empresa es obligatorio.' })
			return
		}
		if (trimmedTaxId.length === 0) {
			setCompanyFeedback({ success: false, message: 'El RIF de la empresa es obligatorio.' })
			return
		}
		if (trimmedEmail.length === 0 || !trimmedEmail.includes('@')) {
			setCompanyFeedback({ success: false, message: 'Debe ingresar un correo electrónico de cobranza válido.' })
			return
		}

		try {
			setIsSavingCompany(true)
			const payload: UpdateConfigRequestDto = {
				companyName: trimmedName,
				companyTaxId: trimmedTaxId,
				companyEmail: trimmedEmail,
			}
			const updated = await updateConfig(payload)
			setFormState(prev =>
				prev !== null
					? {
							...prev,
							companyName: updated.companyName,
							companyTaxId: updated.companyTaxId,
							companyEmail: updated.companyEmail,
						}
					: null,
			)
			setCompanyFeedback({ success: true, message: 'Datos de la empresa guardados correctamente.' })
		} catch (err) {
			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'Error al actualizar los datos de la empresa'
			setCompanyFeedback({ success: false, message })
		} finally {
			setIsSavingCompany(false)
		}
	}

	// Guardar bloque Proveedor y Reglas
	const handleSaveProvider = async (e: React.FormEvent): Promise<void> => {
		e.preventDefault()
		if (formState === null || isBusy) return

		setProviderFeedback(null)

		const trimmedUrl = formState.apiUrl.trim()
		const trimmedUser = formState.apiUsername.trim()

		if (trimmedUrl.length === 0 || !/^https?:\/\//i.test(trimmedUrl)) {
			setProviderFeedback({ success: false, message: 'La URL de la API debe ser válida y comenzar con http:// o https://.' })
			return
		}
		if (trimmedUser.length === 0) {
			setProviderFeedback({ success: false, message: 'El usuario de la API es obligatorio.' })
			return
		}
		if (formState.importableStatuses.length === 0) {
			setProviderFeedback({ success: false, message: 'Debe seleccionar al menos un estado de contrato importable.' })
			return
		}
		if (
			formState.maxRecentInstallments !== null &&
			(!Number.isInteger(formState.maxRecentInstallments) || formState.maxRecentInstallments < 1 || formState.maxRecentInstallments > 60)
		) {
			setProviderFeedback({ success: false, message: 'El máximo de cuotas recientes debe estar entre 1 y 60, o dejarse vacío.' })
			return
		}
		if (
			!Number.isInteger(formState.graceDays) ||
			formState.graceDays < 0 ||
			formState.graceDays > 60
		) {
			setProviderFeedback({ success: false, message: 'Los días de gracia deben ser un número entero entre 0 y 60.' })
			return
		}
		if (
			formState.runInvoiceLimit !== null &&
			(!Number.isInteger(formState.runInvoiceLimit) || formState.runInvoiceLimit < 1)
		) {
			setProviderFeedback({ success: false, message: 'El tope de facturas debe ser un número entero mayor o igual a 1, o dejarse vacío.' })
			return
		}

		let parsedAmountCents: number | null = null
		const trimmedAmountUsd = formState.runAmountLimitUsd.trim()
		if (trimmedAmountUsd.length > 0) {
			if (!/^\d+(\.\d+)?$/.test(trimmedAmountUsd)) {
				setProviderFeedback({
					success: false,
					message: 'El tope de monto en USD debe ser un número positivo, o dejarse vacío.',
				})
				return
			}
			if (!/^\d+(\.\d{1,2})?$/.test(trimmedAmountUsd)) {
				setProviderFeedback({
					success: false,
					message: 'El tope de monto en USD no puede tener más de 2 decimales.',
				})
				return
			}
			const num = Number.parseFloat(trimmedAmountUsd)
			parsedAmountCents = Math.round(num * 100)
		}

		if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(formState.autoRunHour.trim())) {
			setProviderFeedback({ success: false, message: 'La hora de corrida automática debe tener formato HH:MM (24 horas).' })
			return
		}

		try {
			setIsSavingProvider(true)

			const payload: UpdateConfigRequestDto = {
				apiUrl: trimmedUrl,
				apiUsername: trimmedUser,
				...(formState.apiPassword.trim().length > 0 ? { apiPassword: formState.apiPassword } : {}),
				importableStatuses: formState.importableStatuses,
				windowMonths: formState.windowMonths,
				maxRecentInstallments: formState.maxRecentInstallments,
				graceDays: formState.graceDays,
				runInvoiceLimit: formState.runInvoiceLimit,
				runAmountLimitCents: parsedAmountCents,
				excludedDocumentTypes: formState.excludedDocumentTypes,
				autoRunHour: formState.autoRunHour.trim(),
				autoRunActive: formState.autoRunActive,
			}

			const updated = await updateConfig(payload)
			const updatedAmountUsd =
				updated.runAmountLimitCents !== null
					? (updated.runAmountLimitCents / 100).toFixed(2)
					: ''

			// Al guardar con éxito, actualizamos únicamente los campos del proveedor y reglas, limpiando la contraseña
			setFormState(prev =>
				prev !== null
					? {
							...prev,
							apiUrl: updated.apiUrl,
							apiUsername: updated.apiUsername,
							apiPassword: '',
							importableStatuses: updated.importableStatuses,
							windowMonths: updated.windowMonths,
							maxRecentInstallments: updated.maxRecentInstallments,
							graceDays: updated.graceDays,
							runInvoiceLimit: updated.runInvoiceLimit,
							runAmountLimitUsd: updatedAmountUsd,
							excludedDocumentTypes: updated.excludedDocumentTypes,
							autoRunHour: updated.autoRunHour,
							autoRunActive: updated.autoRunActive,
						}
					: null,
			)
			setProviderFeedback({ success: true, message: 'Configuración del proveedor y reglas guardadas correctamente.' })
		} catch (err) {
			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'Error al actualizar la configuración del proveedor'
			setProviderFeedback({ success: false, message })
		} finally {
			setIsSavingProvider(false)
		}
	}

	// Probar conexión contra la API del ISP usando los valores actuales del formulario
	const handleTestConnection = async (): Promise<void> => {
		if (formState === null || isBusy) return

		setTestFeedback(null)
		setIsTestingConnection(true)

		try {
			const payload: TestConnectionRequestDto = {
				...(formState.apiUrl.trim().length > 0 ? { apiUrl: formState.apiUrl.trim() } : {}),
				...(formState.apiUsername.trim().length > 0 ? { apiUsername: formState.apiUsername.trim() } : {}),
				...(formState.apiPassword.length > 0 ? { apiPassword: formState.apiPassword } : {}),
			}

			const result = await testIspConnection(payload)
			setTestFeedback({
				success: result.success,
				message: result.message,
			})
		} catch (err) {
			const message =
				err instanceof ApiClientError
					? err.message
					: err instanceof Error
						? err.message
						: 'Error inesperado al probar conexión con el ISP'
			setTestFeedback({
				success: false,
				message,
			})
		} finally {
			setIsTestingConnection(false)
		}
	}

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h2 className="text-2xl font-bold tracking-tight text-slate-900">Configuración</h2>
					<p className="text-slate-500">Cargando parámetros del sistema...</p>
				</div>
				<div className="space-y-6 animate-pulse">
					<div className="h-64 bg-slate-200 rounded-xl"></div>
					<div className="h-96 bg-slate-200 rounded-xl"></div>
				</div>
			</div>
		)
	}

	if (loadError !== null || formState === null) {
		return (
			<div className="space-y-6">
				<div>
					<h2 className="text-2xl font-bold tracking-tight text-slate-900">Configuración</h2>
					<p className="text-slate-500">Ajustes de la empresa y del administrador de facturas.</p>
				</div>
				<Card className="border-red-200 bg-red-50 text-red-900">
					<CardHeader>
						<div className="flex items-center gap-2">
							<AlertCircle className="w-5 h-5 text-red-600" />
							<CardTitle className="text-red-800">Error al cargar la configuración</CardTitle>
						</div>
						<CardDescription className="text-red-600">
							{loadError ?? 'No se pudo obtener la configuración del servidor.'}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button
							variant="outline"
							className="border-red-300 text-red-800 hover:bg-red-100"
							onClick={() => void loadConfiguration()}
						>
							Reintentar
						</Button>
					</CardContent>
				</Card>
			</div>
		)
	}

	return (
		<div className="space-y-8 pb-12">
			{/* Encabezado estilo Revora */}
			<div>
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
					Configuración del Sistema
				</h1>
				<p className="text-xs sm:text-sm text-slate-500 mt-1 font-medium">
					Parámetros de la empresa y del administrador de facturas, con las mismas opciones del formulario «Configurar proveedor» de Cobrix.
				</p>
			</div>

			{/* ==================================================================== */}
			{/* BLOQUE 1: DATOS DE LA EMPRESA */}
			{/* ==================================================================== */}
			<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] overflow-hidden">
				<CardHeader className="border-b border-slate-100/80 p-5 sm:p-6 pb-4">
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
							<Building2 className="w-4 h-4" />
						</div>
						<CardTitle className="text-lg font-bold text-slate-900">Empresa</CardTitle>
					</div>
					<CardDescription className="text-xs text-slate-400 mt-0.5 font-medium">
						Identificación fiscal y correo electrónico de cobranza de la organización.
					</CardDescription>
				</CardHeader>

				<form onSubmit={e => void handleSaveCompany(e)}>
					<CardContent className="space-y-4">
						<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
							<div className="space-y-1.5">
								<label htmlFor="companyName" className="text-sm font-medium text-slate-700">
									Nombre <span className="text-red-500">*</span>
								</label>
								<Input
									id="companyName"
									type="text"
									value={formState.companyName}
									onChange={e => {
										const val = e.target.value
										setFormState(prev => (prev !== null ? { ...prev, companyName: val } : null))
									}}
									disabled={isBusy}
									placeholder="Ej. ISP de Prueba (sandbox)"
								/>
							</div>

							<div className="space-y-1.5">
								<label htmlFor="companyTaxId" className="text-sm font-medium text-slate-700">
									RIF <span className="text-red-500">*</span>
								</label>
								<Input
									id="companyTaxId"
									type="text"
									value={formState.companyTaxId}
									onChange={e => {
										const val = e.target.value
										setFormState(prev => (prev !== null ? { ...prev, companyTaxId: val } : null))
									}}
									disabled={isBusy}
									placeholder="Ej. J-00000000-0"
								/>
							</div>

							<div className="space-y-1.5">
								<label htmlFor="companyEmail" className="text-sm font-medium text-slate-700">
									Correo de cobranza <span className="text-red-500">*</span>
								</label>
								<Input
									id="companyEmail"
									type="email"
									value={formState.companyEmail}
									onChange={e => {
										const val = e.target.value
										setFormState(prev => (prev !== null ? { ...prev, companyEmail: val } : null))
									}}
									disabled={isBusy}
									placeholder="cobranza@example.com"
								/>
							</div>
						</div>

						<div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
							<div className="space-y-1.5">
								<label className="text-sm font-medium text-slate-700">
									Zona horaria y moneda
								</label>
								<Input
									type="text"
									value="America/Caracas · USD"
									disabled
									readOnly
									className="bg-slate-50 text-slate-500 cursor-not-allowed"
								/>
								<p className="text-xs text-slate-400">
									Parámetro fijo del sistema para facturación en Venezuela.
								</p>
							</div>
						</div>

						{companyFeedback !== null && (
							<div
								className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
									companyFeedback.success
										? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
										: 'bg-red-50 border border-red-200 text-red-800'
								}`}
							>
								{companyFeedback.success ? (
									<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
								) : (
									<AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
								)}
								<span>{companyFeedback.message}</span>
							</div>
						)}
					</CardContent>

					<CardFooter className="flex items-center justify-between border-t border-slate-100 pt-4">
						<Button
							type="submit"
							className="bg-slate-900 hover:bg-slate-800 text-white w-full sm:w-auto rounded-xl font-semibold shadow-xs min-h-[42px]"
							disabled={isBusy}
						>
							{isSavingCompany ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-400" />
									Guardando...
								</>
							) : (
								<>
									<Save className="w-4 h-4 mr-2 text-purple-300" />
									Guardar empresa
								</>
							)}
						</Button>
					</CardFooter>
				</form>
			</Card>

			{/* ==================================================================== */}
			{/* BLOQUE 2: ADMINISTRADOR DE FACTURAS (PROVEEDOR ISP Y REGLAS) */}
			{/* ==================================================================== */}
			<Card className="rounded-2xl border-slate-100/90 shadow-[0_2px_14px_-4px_rgba(20,20,40,0.04)] overflow-hidden">
				<CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100/80 p-5 sm:p-6 pb-4">
					<div>
						<div className="flex items-center gap-2.5">
							<div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
								<Server className="w-4 h-4" />
							</div>
							<CardTitle className="text-lg font-bold text-slate-900">Administrador de facturas</CardTitle>
						</div>
						<CardDescription className="text-xs text-slate-400 mt-1 font-medium">
							Ajustes de conexión con la API externa, reglas de filtrado de cuotas y topes de importación.
						</CardDescription>
					</div>
					<Button
						type="button"
						variant="outline"
						className="border-slate-200 text-slate-700 hover:bg-slate-50 w-full sm:w-auto shrink-0 rounded-xl font-semibold shadow-2xs"
						onClick={() => void handleTestConnection()}
						disabled={isBusy}
					>
						{isTestingConnection ? (
							<>
								<Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-600" />
								Probando...
							</>
						) : (
							<>
								<Wifi className="w-4 h-4 mr-2 text-purple-600" />
								Probar conexión
							</>
						)}
					</Button>
				</CardHeader>

				<form onSubmit={e => void handleSaveProvider(e)}>
					<CardContent className="space-y-6">
						{/* Feedback de la prueba de conexión */}
						{testFeedback !== null && (
							<div
								className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
									testFeedback.success
										? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
										: 'bg-red-50 border border-red-200 text-red-800'
								}`}
							>
								{testFeedback.success ? (
									<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
								) : (
									<XCircle className="w-4 h-4 text-red-600 shrink-0" />
								)}
								<span className="font-medium">{testFeedback.message}</span>
							</div>
						)}

						{/* Sección A: Credenciales de conexión */}
						<div className="space-y-4">
							<h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Conexión con la API del ISP
							</h4>

							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="space-y-1.5">
									<label className="text-sm font-medium text-slate-700">
										Nombre visible
									</label>
									<Input
										type="text"
										value="Administrador de facturas"
										disabled
										readOnly
										className="bg-slate-50 text-slate-500 cursor-not-allowed"
									/>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="apiUrl" className="text-sm font-medium text-slate-700">
										URL de la API <span className="text-red-500">*</span>
									</label>
									<Input
										id="apiUrl"
										type="text"
										value={formState.apiUrl}
										onChange={e => {
											const val = e.target.value
											setFormState(prev => (prev !== null ? { ...prev, apiUrl: val } : null))
										}}
										disabled={isBusy}
										placeholder="http://127.0.0.1:4410"
									/>
									<p className="text-xs text-slate-500">
										Con o sin /api/v1. El simulador local es http://127.0.0.1:4410
									</p>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="apiUsername" className="text-sm font-medium text-slate-700">
										Usuario o correo <span className="text-red-500">*</span>
									</label>
									<Input
										id="apiUsername"
										type="text"
										value={formState.apiUsername}
										onChange={e => {
											const val = e.target.value
											setFormState(prev => (prev !== null ? { ...prev, apiUsername: val } : null))
										}}
										disabled={isBusy}
										placeholder="cobrix"
									/>
								</div>
							</div>

							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="space-y-1.5">
									<label htmlFor="apiPassword" className="text-sm font-medium text-slate-700">
										Contraseña
									</label>
									<Input
										id="apiPassword"
										type="password"
										autoComplete="new-password"
										value={formState.apiPassword}
										onChange={e => {
											const val = e.target.value
											setFormState(prev => (prev !== null ? { ...prev, apiPassword: val } : null))
										}}
										disabled={isBusy}
										placeholder="••••••••"
									/>
									<p className="text-xs text-slate-500">
										Déjala vacía para conservar la actual almacenada en la base de datos.
									</p>
								</div>
							</div>
						</div>

						{/* Sección B: Reglas de Importación */}
						<div className="space-y-4 pt-2">
							<h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
								Reglas de importación de contratos y cuotas
							</h4>

							{/* Estados de contrato que se importan */}
							<div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
								<div className="flex items-center justify-between">
									<label className="text-sm font-semibold text-slate-800">
										Estados de contrato que se importan <span className="text-red-500">*</span>
									</label>
									<span className="text-xs text-slate-500">Por defecto: ACTIVO y CORTADO</span>
								</div>
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 pt-1">
									{AVAILABLE_CONTRACT_STATUSES.map(st => {
										const checked = formState.importableStatuses.includes(st)
										return (
											<label
												key={st}
												className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
													checked
														? 'bg-indigo-50 border-indigo-200 text-indigo-900 font-semibold'
														: 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
												}`}
											>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => handleToggleStatus(st)}
													disabled={isBusy}
													className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
												/>
												<span>{st}</span>
											</label>
										)
									})}
								</div>
							</div>

							{/* Ventana, cuotas recientes y días de gracia */}
							<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
								<div className="space-y-1.5">
									<label htmlFor="windowMonths" className="text-sm font-medium text-slate-700">
										Ventana de importación
									</label>
									<select
										id="windowMonths"
										value={formState.windowMonths === null ? '' : String(formState.windowMonths)}
										onChange={e => {
											const val = e.target.value
											const num = val === '' ? null : Number.parseInt(val, 10)
											setFormState(prev => (prev !== null ? { ...prev, windowMonths: num } : null))
										}}
										disabled={isBusy}
										className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
									>
										<option value="">Sin ventana (todas las cuotas)</option>
										<option value="3">3 meses</option>
										<option value="6">6 meses</option>
										<option value="9">9 meses</option>
										<option value="12">12 meses</option>
									</select>
									<p className="text-xs text-slate-500">
										Solo cuotas desde el mes actual menos N meses.
									</p>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="maxRecentInstallments" className="text-sm font-medium text-slate-700">
										Máx. cuotas recientes por contrato
									</label>
									<Input
										id="maxRecentInstallments"
										type="number"
										min="1"
										max="60"
										value={formState.maxRecentInstallments === null ? '' : formState.maxRecentInstallments}
										onChange={e => {
											const val = e.target.value
											if (val.trim() === '') {
												setFormState(prev => (prev !== null ? { ...prev, maxRecentInstallments: null } : null))
											} else {
												const n = Number.parseInt(val, 10)
												setFormState(prev => (prev !== null ? { ...prev, maxRecentInstallments: Number.isNaN(n) ? null : n } : null))
											}
										}}
										disabled={isBusy}
										placeholder="Vacío = todas (1 a 60)"
									/>
									<p className="text-xs text-slate-500">
										Vacío = todas (1 a 60). Se conservan las más recientes.
									</p>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="graceDays" className="text-sm font-medium text-slate-700">
										Días de gracia para el corte
									</label>
									<Input
										id="graceDays"
										type="number"
										min="0"
										max="60"
										value={formState.graceDays}
										onChange={e => {
											const val = e.target.value
											const n = Number.parseInt(val, 10)
											setFormState(prev => (prev !== null ? { ...prev, graceDays: Number.isNaN(n) ? 0 : n } : null))
										}}
										disabled={isBusy}
										placeholder="0"
									/>
									<p className="text-xs text-slate-500">
										Corte = vencimiento + días (0 a 60).
									</p>
								</div>
							</div>

							{/* Topes por corrida */}
							<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
								<div className="space-y-1.5">
									<label htmlFor="runInvoiceLimit" className="text-sm font-medium text-slate-700">
										Tope de facturas nuevas por corrida
									</label>
									<Input
										id="runInvoiceLimit"
										type="number"
										min="1"
										value={formState.runInvoiceLimit === null ? '' : formState.runInvoiceLimit}
										onChange={e => {
											const val = e.target.value
											if (val.trim() === '') {
												setFormState(prev => (prev !== null ? { ...prev, runInvoiceLimit: null } : null))
											} else {
												const n = Number.parseInt(val, 10)
												setFormState(prev => (prev !== null ? { ...prev, runInvoiceLimit: Number.isNaN(n) ? null : n } : null))
											}
										}}
										disabled={isBusy}
										placeholder="Sin límite"
									/>
									<p className="text-xs text-slate-500">
										Máximo de facturas nuevas por corrida. Lo que exceda queda frenado.
									</p>
								</div>

								<div className="space-y-1.5">
									<label htmlFor="runAmountLimitUsd" className="text-sm font-medium text-slate-700">
										Tope de monto nuevo por corrida (USD)
									</label>
									<Input
										id="runAmountLimitUsd"
										type="number"
										step="0.01"
										min="0"
										value={formState.runAmountLimitUsd}
										onChange={e => {
											const val = e.target.value
											setFormState(prev => (prev !== null ? { ...prev, runAmountLimitUsd: val } : null))
										}}
										disabled={isBusy}
										placeholder="Sin límite (ej. 50000.00)"
									/>
									<p className="text-xs text-slate-500">
										Monto nuevo acumulado en dólares. Lo que exceda queda frenado.
									</p>
								</div>
							</div>

							{/* Excluir por tipo de documento */}
							<div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
								<div className="flex items-center justify-between">
									<label className="text-sm font-semibold text-slate-800">
										Excluir por tipo de documento del titular
									</label>
									<span className="text-xs text-slate-500">Los titulares con estos tipos no se importan</span>
								</div>
								<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 pt-1">
									{AVAILABLE_DOCUMENT_TYPES.map(opt => {
										const checked = formState.excludedDocumentTypes.includes(opt.type)
										return (
											<label
												key={opt.type}
												className={`flex items-center gap-2 p-2 rounded-lg border text-xs font-medium cursor-pointer transition-colors ${
													checked
														? 'bg-amber-50 border-amber-200 text-amber-900 font-semibold'
														: 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100'
												}`}
											>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => handleToggleDocumentType(opt.type)}
													disabled={isBusy}
													className="h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-600 cursor-pointer"
												/>
												<span>{opt.label}</span>
											</label>
										)
									})}
								</div>
							</div>

							{/* Corrida automática */}
							<div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
								<h5 className="text-sm font-semibold text-slate-800">
									Corrida automática diaria
								</h5>
								<div className="flex flex-wrap items-center gap-4 text-sm text-slate-700">
									<label className="flex items-center gap-2 cursor-pointer font-medium">
										<input
											type="checkbox"
											checked={formState.autoRunActive}
											onChange={e => {
												const checked = e.target.checked
												setFormState(prev => (prev !== null ? { ...prev, autoRunActive: checked } : null))
											}}
											disabled={isBusy}
											className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 cursor-pointer"
										/>
										<span>Importar y actualizar pagadas una vez al día</span>
									</label>

									<div className="flex items-center gap-2">
										<span className="text-slate-500 text-xs">a las</span>
										<Input
											type="text"
											value={formState.autoRunHour}
											onChange={e => {
												const val = e.target.value
												setFormState(prev => (prev !== null ? { ...prev, autoRunHour: val } : null))
											}}
											disabled={isBusy || !formState.autoRunActive}
											placeholder="03:00"
											maxLength={5}
											className="w-24 text-center font-mono"
										/>
										<span className="text-slate-500 text-xs">(America/Caracas)</span>
									</div>
								</div>
							</div>

							{/* Nota informativa fija */}
							<div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 leading-relaxed">
								Fijo para este proveedor, como en Cobrix: solo cuotas pendientes (invoiceScope = unpaid), vencimiento del proveedor (dueDateSource = provider) y sin importación genérica programada.
							</div>
						</div>

						{providerFeedback !== null && (
							<div
								className={`p-3 rounded-lg flex items-center gap-2 text-sm ${
									providerFeedback.success
										? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
										: 'bg-red-50 border border-red-200 text-red-800'
								}`}
							>
								{providerFeedback.success ? (
									<CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
								) : (
									<AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
								)}
								<span>{providerFeedback.message}</span>
							</div>
						)}
					</CardContent>

					<CardFooter className="flex items-center justify-between border-t border-slate-100 pt-4">
						<Button
							type="submit"
							className="bg-slate-900 hover:bg-slate-800 text-white w-full sm:w-auto rounded-xl font-semibold shadow-xs min-h-[42px]"
							disabled={isBusy}
						>
							{isSavingProvider ? (
								<>
									<Loader2 className="w-4 h-4 mr-2 animate-spin text-purple-400" />
									Guardando...
								</>
							) : (
								<>
									<Save className="w-4 h-4 mr-2 text-purple-300" />
									Guardar proveedor
								</>
							)}
						</Button>
					</CardFooter>
				</form>
			</Card>
		</div>
	)
}
