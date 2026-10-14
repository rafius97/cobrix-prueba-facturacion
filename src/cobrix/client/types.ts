/**
 * External Data Transfer Objects (DTOs) representing the ISP Billing API contracts.
 * Field names follow the original ISP API specification in Spanish.
 * Strictly typed without `any` or `unknown`.
 */

// ============================================================================
// Auth DTOs
// ============================================================================

export interface IspLoginRequest {
	readonly user_name?: string
	readonly email?: string
	readonly password: string
}

export interface IspLoginResponse {
	readonly usuario: string
	readonly email: string
	readonly access_token: string
	/** Naive UTC string without offset (e.g. "2026-10-13T10:00:00"). */
	readonly access_token_expires_in: string
}

// ============================================================================
// API Error DTOs
// ============================================================================

export interface IspDetailErrorItem {
	readonly type: string
	readonly mensaje: string
}

export interface IspDetailErrorBody {
	readonly detail: IspDetailErrorItem
}

export interface IspValidationErrorItem {
	readonly source?: string
	readonly field?: string
	readonly message: string
}

// ============================================================================
// Common Envelope DTOs
// ============================================================================

export interface IspPagination {
	readonly page: number
	readonly per_page: number
	readonly total: number
	readonly total_pages: number
}

export interface IspEnvelopeError {
	readonly id: number
	readonly message: string
	readonly code: string
	readonly uuid_code: string
}

export interface IspEnvelope<T> {
	readonly success: boolean
	readonly message: string
	readonly pagination: IspPagination
	readonly errors: readonly IspEnvelopeError[]
	readonly data: T
}

// ============================================================================
// Contract Listing DTOs
// ============================================================================

export type IspContractIdsResponse = IspEnvelope<readonly number[]>

export interface IspListContractIdsParams {
	readonly estado?: string
	readonly id_sucursal?: number
	readonly id_empresa?: number
	readonly page?: number
	readonly per_page?: number
}

// ============================================================================
// Pending Installments DTOs (contrato/individual)
// ============================================================================

export type IspPendingInstallmentsResponse = readonly IspPendingInstallmentRow[]

export interface IspPendingInstallmentRow {
	readonly dia_cobro: number
	readonly dia_corte: number
	readonly id_tipo_duracion: number
	readonly duracion: number
	readonly tipo_duracion: string
	readonly fecha_cobro_prox: string
	readonly fecha_corte_prox: string
	readonly contrato_id: number
	readonly id_empresa: number
	readonly codigo: string
	readonly identificacion_contrato: string
	readonly nombre_contrato: string
	readonly telefono: string
	readonly email: string
	readonly estado: string
	readonly tipo_contrato_de_cobro: string
	readonly direccion: string
	readonly cuotas_vencidad: number
	readonly deuda: number
	readonly detalle_tipo_deuda: readonly string[]
	readonly tipo_deuda: string
	readonly deuda_id: string
	readonly nombre_servicio: string
	readonly precio_servicio: string
	readonly nombre_plan: string
	readonly nombre_empresa: string
	readonly nombre_comercial_empresa: string
	readonly identificacion_empresa: string
	readonly nombre_sucursal: string
	readonly identificacion_sucursal: string
	readonly sigla_sucursal: string
	readonly informacion_adicional: string
	readonly detalle_deuda: readonly string[]
	readonly detalle: readonly string[]
	readonly moneda: string
	readonly moneda_sigla: string
	readonly tipo_servicio: string
	readonly id_tipo_cont_serv: number
	readonly saldo_a_f_v: number
	readonly saldo_a_f_sn: string
	readonly fecha_contrato: string
	readonly fecha_instalacion: string
	readonly fecha_ultimo_corte: string
	readonly sector: string
	readonly barrio: string
	readonly ruta: string
	readonly vendedor_contrato: string
	readonly id_tipo_factura: number
	readonly tipo_factura: string
	readonly coordenadas: string | null
}

export interface IspContractIndividualParams {
	readonly id_contrato?: number
	readonly codigo?: string
	readonly identificacion?: string
}

// ============================================================================
// Payment Book DTOs (pago_informacion)
// ============================================================================

export interface IspPaymentInstallmentSubDetail {
	readonly id_contrato: number
	readonly id_cliente: number
	readonly id_cuota: number
	readonly id_detalle_cuota: number
	readonly tipo: string
	readonly periodo_detalle_cuota: string
	readonly tipo_nombre: string
	readonly codigo_producto: string
	readonly detalle_producto: string
	readonly nombre_producto: string
	readonly nombre_paquete: string
	readonly nombre_tipo_producto: string
	readonly tarifa: number
	readonly dias_uso: number
	readonly valor_uso: number
	readonly valor_no_uso: number
	readonly valor_pago: number
	readonly valor_nota_credito: number
	readonly descuento: number
	readonly saldo_cuota: number
}

export interface IspPaymentBookDetail {
	readonly id_contrato: number
	readonly id_cliente: number
	readonly id_cuota: number
	readonly tipo_contrato: string
	readonly periodo_cuota: string
	readonly tarifa: number
	readonly total_adicional: number
	readonly valor_pago: number
	readonly valor_uso: number
	readonly valor_no_uso: number
	readonly descuento: number
	readonly valor_nota_credito: number
	readonly saldo_cuota: number
	readonly detalle: readonly IspPaymentInstallmentSubDetail[]
	readonly detalle_dfac: string
}

export interface IspPaymentBookRow {
	readonly id_factura: number
	readonly cod_empresa: number
	readonly cod_sucursal: number
	readonly dmcc_cod_empresa: number
	readonly dmcc_cod_sucursal: number
	readonly cod_tran: string
	readonly asiento: string
	readonly identificacion_cliente_factura: string
	readonly nombre_cliente_factura: string
	readonly nombre_cliente: string
	readonly identificacion_cliente: string
	readonly codigo_cliente: string
	readonly tipo_contrato: string
	readonly num_factura: string
	readonly ejercio_fiscal: number
	readonly id_cliente: number
	readonly fecha_vence: string
	readonly fecha_emision: string
	readonly periodo_fecha: string
	readonly id_contrato: number
	readonly fact_cod_contr: string
	readonly compara_id_contrato_1: string
	readonly compara_id_contrato_2: string
	readonly detalle_pago: IspPaymentBookDetail
}

export type IspPaymentBookResponse = IspEnvelope<readonly IspPaymentBookRow[]>

export type IspPaymentSearchType = 'CUOTA' | 'FACTURA'

export interface IspPaymentBookParams {
	readonly id_contrato: number
	readonly tipo_busqueda: IspPaymentSearchType
	readonly fecha_inicio?: string
	readonly fecha_fin?: string
}

// ============================================================================
// Client Options & Internal Types
// ============================================================================

export interface BillingApiClientOptions {
	readonly baseUrl: string
	readonly username?: string
	readonly password?: string
	readonly timeoutMs?: number
	readonly fetchFn?: typeof fetch
}

export interface AuthSession {
	readonly accessToken: string
	readonly expiresAtMs: number
	readonly username: string
}

export interface TestConnectionResult {
	readonly ok: boolean
	readonly totalContracts: number
	readonly message: string
}
