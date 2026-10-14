/**
 * Runtime validators for ISP Billing API responses.
 * Strictly typed without `any` or `unknown`.
 * No unsafe type assertions (`as`).
 */

import { BillingApiResponseError } from './errors.ts'
import type {
	IspContractIdsResponse,
	IspDetailErrorItem,
	IspEnvelopeError,
	IspLoginResponse,
	IspPagination,
	IspPaymentBookDetail,
	IspPaymentBookResponse,
	IspPaymentBookRow,
	IspPaymentInstallmentSubDetail,
	IspPendingInstallmentRow,
	IspPendingInstallmentsResponse,
	IspValidationErrorItem,
} from './types.ts'

// ============================================================================
// Safe JSON Types (No `any`, No `unknown`)
// ============================================================================

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonArray
export interface JsonObject {
	readonly [key: string]: JsonValue | undefined
}
export type JsonArray = readonly JsonValue[]

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonArray(value: JsonValue | undefined): value is JsonArray {
	return Array.isArray(value)
}

export function isString(value: JsonValue | undefined): value is string {
	return typeof value === 'string'
}

export function isNumber(value: JsonValue | undefined): value is number {
	return typeof value === 'number' && !Number.isNaN(value)
}

export function isBoolean(value: JsonValue | undefined): value is boolean {
	return typeof value === 'boolean'
}

export function isStringOrNull(value: JsonValue | undefined): value is string | null {
	return value === null || typeof value === 'string'
}

export function isStringArray(value: JsonValue | undefined): value is readonly string[] {
	if (!Array.isArray(value)) return false
	for (const item of value) {
		if (typeof item !== 'string') return false
	}
	return true
}

export function isNumberArray(value: JsonValue | undefined): value is readonly number[] {
	if (!Array.isArray(value)) return false
	for (const item of value) {
		if (typeof item !== 'number' || Number.isNaN(item)) return false
	}
	return true
}

/**
 * Safely parses a JSON string into a strongly-typed `JsonValue`.
 * Throws `BillingApiResponseError` if parsing fails.
 */
export function parseJsonSafe(text: string, endpoint: string): JsonValue {
	try {
		const parsed: JsonValue = JSON.parse(text)
		return parsed
	} catch (error) {
		const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text
		throw new BillingApiResponseError('Response is not valid JSON', {
			endpoint,
			responseBodyText: snippet,
			cause: error instanceof Error ? error : undefined,
		})
	}
}

/**
 * Attempts to parse a JSON string into `JsonValue`, returning `null` on syntax error.
 */
export function parseJsonSafeOrNull(text: string): JsonValue | null {
	try {
		const parsed: JsonValue = JSON.parse(text)
		return parsed
	} catch {
		return null
	}
}

// ============================================================================
// Error Payload Parsers
// ============================================================================

export function tryParseDetailError(raw: JsonValue | null): IspDetailErrorItem | null {
	if (!isJsonObject(raw)) return null
	const detail = raw['detail']
	if (!isJsonObject(detail)) return null
	const type = detail['type']
	const mensaje = detail['mensaje']
	if (!isString(type) || !isString(mensaje)) return null
	return { type, mensaje }
}

export function tryParseValidationErrors(raw: JsonValue | null): readonly IspValidationErrorItem[] | null {
	if (!isJsonArray(raw) || raw.length === 0) return null
	const results: IspValidationErrorItem[] = []
	for (const item of raw) {
		if (!isJsonObject(item)) return null
		const message = item['message']
		if (!isString(message)) return null
		const source = item['source']
		const field = item['field']
		results.push({
			source: isString(source) ? source : undefined,
			field: isString(field) ? field : undefined,
			message,
		})
	}
	return results
}

// ============================================================================
// Pagination and Envelope Helpers
// ============================================================================

export function parsePagination(raw: JsonValue | undefined, endpoint: string): IspPagination {
	if (!isJsonObject(raw)) {
		throw new BillingApiResponseError('pagination is not a valid object', {
			endpoint,
			validationDetails: 'Expected an object for pagination',
		})
	}
	const page = raw['page']
	const perPage = raw['per_page']
	const total = raw['total']
	const totalPages = raw['total_pages']

	if (!isNumber(page) || !isNumber(perPage) || !isNumber(total) || !isNumber(totalPages)) {
		throw new BillingApiResponseError('Missing or invalid numeric pagination properties', {
			endpoint,
			validationDetails: 'page, per_page, total, and total_pages must be numbers',
		})
	}

	return {
		page,
		per_page: perPage,
		total,
		total_pages: totalPages,
	}
}

export function parseEnvelopeErrors(raw: JsonValue | undefined, endpoint: string): readonly IspEnvelopeError[] {
	if (!isJsonArray(raw)) {
		throw new BillingApiResponseError('errors in envelope must be an array', {
			endpoint,
			validationDetails: 'Expected an array for errors',
		})
	}
	const list: IspEnvelopeError[] = []
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i]
		if (!isJsonObject(item)) {
			throw new BillingApiResponseError(`errors[${i}] is not an object`, {
				endpoint,
				validationDetails: `errors[${i}] must be an object`,
			})
		}
		const id = item['id']
		const message = item['message']
		const code = item['code']
		const uuidCode = item['uuid_code']
		if (!isNumber(id) || !isString(message) || !isString(code) || !isString(uuidCode)) {
			throw new BillingApiResponseError(`errors[${i}] contains fields of invalid type`, {
				endpoint,
				validationDetails: 'id must be a number, and message, code, and uuid_code must be strings',
			})
		}
		list.push({ id, message, code, uuid_code: uuidCode })
	}
	return list
}

// ============================================================================
// Endpoint Response Parsers
// ============================================================================

export function parseLoginResponse(raw: JsonValue, endpoint: string): IspLoginResponse {
	if (!isJsonObject(raw)) {
		throw new BillingApiResponseError('Login response must be an object', {
			endpoint,
			validationDetails: 'Expected a JSON object at root',
		})
	}

	const usuario = raw['usuario']
	const email = raw['email']
	const accessToken = raw['access_token']
	const expiresIn = raw['access_token_expires_in']

	if (!isString(usuario) || !isString(email) || !isString(accessToken) || !isString(expiresIn)) {
		throw new BillingApiResponseError('Incomplete login structure or invalid field types', {
			endpoint,
			validationDetails: 'usuario, email, access_token, and access_token_expires_in must be strings',
		})
	}

	return {
		usuario,
		email,
		access_token: accessToken,
		access_token_expires_in: expiresIn,
	}
}

export function parseContractIdsResponse(raw: JsonValue, endpoint: string): IspContractIdsResponse {
	if (!isJsonObject(raw)) {
		throw new BillingApiResponseError('lista_ids_contratos response must be an object', {
			endpoint,
			validationDetails: 'Expected a JSON object for envelope',
		})
	}

	const success = raw['success']
	const message = raw['message']
	const paginationRaw = raw['pagination']
	const errorsRaw = raw['errors']
	const dataRaw = raw['data']

	if (!isBoolean(success) || !isString(message)) {
		throw new BillingApiResponseError('Invalid envelope in lista_ids_contratos', {
			endpoint,
			validationDetails: 'success must be a boolean and message must be a string',
		})
	}

	const pagination = parsePagination(paginationRaw, endpoint)
	const errors = parseEnvelopeErrors(errorsRaw, endpoint)

	if (!isNumberArray(dataRaw)) {
		throw new BillingApiResponseError('data in lista_ids_contratos must be an array of numbers', {
			endpoint,
			validationDetails: 'Field data is not a valid array of numbers',
		})
	}

	return {
		success,
		message,
		pagination,
		errors,
		data: dataRaw,
	}
}

export function parsePendingInstallmentRow(row: JsonObject, index: number, endpoint: string): IspPendingInstallmentRow {
	const diaCobro = row['dia_cobro']
	const diaCorte = row['dia_corte']
	const idTipoDuracion = row['id_tipo_duracion']
	const duracion = row['duracion']
	const tipoDuracion = row['tipo_duracion']
	const fechaCobroProx = row['fecha_cobro_prox']
	const fechaCorteProx = row['fecha_corte_prox']
	const contratoId = row['contrato_id']
	const idEmpresa = row['id_empresa']
	const codigo = row['codigo']
	const identificacionContrato = row['identificacion_contrato']
	const nombreContrato = row['nombre_contrato']
	const telefono = row['telefono']
	const email = row['email']
	const estado = row['estado']
	const tipoContratoDeCobro = row['tipo_contrato_de_cobro']
	const direccion = row['direccion']
	const cuotasVencidad = row['cuotas_vencidad']
	const deuda = row['deuda']
	const detalleTipoDeuda = row['detalle_tipo_deuda']
	const tipoDeuda = row['tipo_deuda']
	const deudaId = row['deuda_id']
	const nombreServicio = row['nombre_servicio']
	const precioServicio = row['precio_servicio']
	const nombrePlan = row['nombre_plan']
	const nombreEmpresa = row['nombre_empresa']
	const nombreComercialEmpresa = row['nombre_comercial_empresa']
	const identificacionEmpresa = row['identificacion_empresa']
	const nombreSucursal = row['nombre_sucursal']
	const identificacionSucursal = row['identificacion_sucursal']
	const siglaSucursal = row['sigla_sucursal']
	const informacionAdicional = row['informacion_adicional']
	const detalleDeuda = row['detalle_deuda']
	const detalle = row['detalle']
	const moneda = row['moneda']
	const monedaSigla = row['moneda_sigla']
	const tipoServicio = row['tipo_servicio']
	const idTipoContServ = row['id_tipo_cont_serv']
	const saldoAFV = row['saldo_a_f_v']
	const saldoAFSn = row['saldo_a_f_sn']
	const fechaContrato = row['fecha_contrato']
	const fechaInstalacion = row['fecha_instalacion']
	const fechaUltimoCorte = row['fecha_ultimo_corte']
	const sector = row['sector']
	const barrio = row['barrio']
	const ruta = row['ruta']
	const vendedorContrato = row['vendedor_contrato']
	const idTipoFactura = row['id_tipo_factura']
	const tipoFactura = row['tipo_factura']
	const coordenadas = row['coordenadas']

	if (
		!isNumber(diaCobro) ||
		!isNumber(diaCorte) ||
		!isNumber(idTipoDuracion) ||
		!isNumber(duracion) ||
		!isString(tipoDuracion) ||
		!isString(fechaCobroProx) ||
		!isString(fechaCorteProx) ||
		!isNumber(contratoId) ||
		!isNumber(idEmpresa) ||
		!isString(codigo) ||
		!isString(identificacionContrato) ||
		!isString(nombreContrato) ||
		!isString(telefono) ||
		!isString(email) ||
		!isString(estado) ||
		!isString(tipoContratoDeCobro) ||
		!isString(direccion) ||
		!isNumber(cuotasVencidad) ||
		!isNumber(deuda) ||
		!isStringArray(detalleTipoDeuda) ||
		!isString(tipoDeuda) ||
		!isString(deudaId) ||
		!isString(nombreServicio) ||
		!isString(precioServicio) ||
		!isString(nombrePlan) ||
		!isString(nombreEmpresa) ||
		!isString(nombreComercialEmpresa) ||
		!isString(identificacionEmpresa) ||
		!isString(nombreSucursal) ||
		!isString(identificacionSucursal) ||
		!isString(siglaSucursal) ||
		!isString(informacionAdicional) ||
		!isStringArray(detalleDeuda) ||
		!isStringArray(detalle) ||
		!isString(moneda) ||
		!isString(monedaSigla) ||
		!isString(tipoServicio) ||
		!isNumber(idTipoContServ) ||
		!isNumber(saldoAFV) ||
		!isString(saldoAFSn) ||
		!isString(fechaContrato) ||
		!isString(fechaInstalacion) ||
		!isString(fechaUltimoCorte) ||
		!isString(sector) ||
		!isString(barrio) ||
		!isString(ruta) ||
		!isString(vendedorContrato) ||
		!isNumber(idTipoFactura) ||
		!isString(tipoFactura) ||
		!isStringOrNull(coordenadas)
	) {
		throw new BillingApiResponseError(`Row ${index} in contrato/individual does not conform to contract`, {
			endpoint,
			validationDetails: `Missing or invalid properties in pending installment row ${index}`,
		})
	}

	return {
		dia_cobro: diaCobro,
		dia_corte: diaCorte,
		id_tipo_duracion: idTipoDuracion,
		duracion,
		tipo_duracion: tipoDuracion,
		fecha_cobro_prox: fechaCobroProx,
		fecha_corte_prox: fechaCorteProx,
		contrato_id: contratoId,
		id_empresa: idEmpresa,
		codigo,
		identificacion_contrato: identificacionContrato,
		nombre_contrato: nombreContrato,
		telefono,
		email,
		estado,
		tipo_contrato_de_cobro: tipoContratoDeCobro,
		direccion,
		cuotas_vencidad: cuotasVencidad,
		deuda,
		detalle_tipo_deuda: detalleTipoDeuda,
		tipo_deuda: tipoDeuda,
		deuda_id: deudaId,
		nombre_servicio: nombreServicio,
		precio_servicio: precioServicio,
		nombre_plan: nombrePlan,
		nombre_empresa: nombreEmpresa,
		nombre_comercial_empresa: nombreComercialEmpresa,
		identificacion_empresa: identificacionEmpresa,
		nombre_sucursal: nombreSucursal,
		identificacion_sucursal: identificacionSucursal,
		sigla_sucursal: siglaSucursal,
		informacion_adicional: informacionAdicional,
		detalle_deuda: detalleDeuda,
		detalle,
		moneda,
		moneda_sigla: monedaSigla,
		tipo_servicio: tipoServicio,
		id_tipo_cont_serv: idTipoContServ,
		saldo_a_f_v: saldoAFV,
		saldo_a_f_sn: saldoAFSn,
		fecha_contrato: fechaContrato,
		fecha_instalacion: fechaInstalacion,
		fecha_ultimo_corte: fechaUltimoCorte,
		sector,
		barrio,
		ruta,
		vendedor_contrato: vendedorContrato,
		id_tipo_factura: idTipoFactura,
		tipo_factura: tipoFactura,
		coordenadas,
	}
}

export function parsePendingInstallmentsResponse(raw: JsonValue, endpoint: string): IspPendingInstallmentsResponse {
	if (!isJsonArray(raw)) {
		throw new BillingApiResponseError('contrato/individual must return a JSON array at root', {
			endpoint,
			validationDetails: 'Expected a flat JSON array',
		})
	}

	const rows: IspPendingInstallmentRow[] = []
	for (let i = 0; i < raw.length; i++) {
		const item = raw[i]
		if (!isJsonObject(item)) {
			throw new BillingApiResponseError(`Element ${i} in contrato/individual is not an object`, {
				endpoint,
				validationDetails: `Element at index ${i} is not a JSON object`,
			})
		}
		rows.push(parsePendingInstallmentRow(item, i, endpoint))
	}

	return rows
}

export function parsePaymentSubDetail(raw: JsonObject, index: number, endpoint: string): IspPaymentInstallmentSubDetail {
	const idContrato = raw['id_contrato']
	const idCliente = raw['id_cliente']
	const idCuota = raw['id_cuota']
	const idDetalleCuota = raw['id_detalle_cuota']
	const tipo = raw['tipo']
	const periodoDetalleCuota = raw['periodo_detalle_cuota']
	const tipoNombre = raw['tipo_nombre']
	const codigoProducto = raw['codigo_producto']
	const detalleProducto = raw['detalle_producto']
	const nombreProducto = raw['nombre_producto']
	const nombrePaquete = raw['nombre_paquete']
	const nombreTipoProducto = raw['nombre_tipo_producto']
	const tarifa = raw['tarifa']
	const diasUso = raw['dias_uso']
	const valorUso = raw['valor_uso']
	const valorNoUso = raw['valor_no_uso']
	const valorPago = raw['valor_pago']
	const valorNotaCredito = raw['valor_nota_credito']
	const descuento = raw['descuento']
	const saldoCuota = raw['saldo_cuota']

	if (
		!isNumber(idContrato) ||
		!isNumber(idCliente) ||
		!isNumber(idCuota) ||
		!isNumber(idDetalleCuota) ||
		!isString(tipo) ||
		!isString(periodoDetalleCuota) ||
		!isString(tipoNombre) ||
		!isString(codigoProducto) ||
		!isString(detalleProducto) ||
		!isString(nombreProducto) ||
		!isString(nombrePaquete) ||
		!isString(nombreTipoProducto) ||
		!isNumber(tarifa) ||
		!isNumber(diasUso) ||
		!isNumber(valorUso) ||
		!isNumber(valorNoUso) ||
		!isNumber(valorPago) ||
		!isNumber(valorNotaCredito) ||
		!isNumber(descuento) ||
		!isNumber(saldoCuota)
	) {
		throw new BillingApiResponseError(`Installment subdetail ${index} is incomplete or invalid`, {
			endpoint,
			validationDetails: `Missing or invalid properties in subdetail ${index}`,
		})
	}

	return {
		id_contrato: idContrato,
		id_cliente: idCliente,
		id_cuota: idCuota,
		id_detalle_cuota: idDetalleCuota,
		tipo,
		periodo_detalle_cuota: periodoDetalleCuota,
		tipo_nombre: tipoNombre,
		codigo_producto: codigoProducto,
		detalle_producto: detalleProducto,
		nombre_producto: nombreProducto,
		nombre_paquete: nombrePaquete,
		nombre_tipo_producto: nombreTipoProducto,
		tarifa,
		dias_uso: diasUso,
		valor_uso: valorUso,
		valor_no_uso: valorNoUso,
		valor_pago: valorPago,
		valor_nota_credito: valorNotaCredito,
		descuento,
		saldo_cuota: saldoCuota,
	}
}

export function parsePaymentBookDetail(raw: JsonValue | undefined, endpoint: string): IspPaymentBookDetail {
	if (!isJsonObject(raw)) {
		throw new BillingApiResponseError('detalle_pago is not a valid object', {
			endpoint,
			validationDetails: 'Expected an object for detalle_pago',
		})
	}

	const idContrato = raw['id_contrato']
	const idCliente = raw['id_cliente']
	const idCuota = raw['id_cuota']
	const tipoContrato = raw['tipo_contrato']
	const periodoCuota = raw['periodo_cuota']
	const tarifa = raw['tarifa']
	const totalAdicional = raw['total_adicional']
	const valorPago = raw['valor_pago']
	const valorUso = raw['valor_uso']
	const valorNoUso = raw['valor_no_uso']
	const descuento = raw['descuento']
	const valorNotaCredito = raw['valor_nota_credito']
	const saldoCuota = raw['saldo_cuota']
	const detalleRaw = raw['detalle']
	const detalleDfac = raw['detalle_dfac']

	if (
		!isNumber(idContrato) ||
		!isNumber(idCliente) ||
		!isNumber(idCuota) ||
		!isString(tipoContrato) ||
		!isString(periodoCuota) ||
		!isNumber(tarifa) ||
		!isNumber(totalAdicional) ||
		!isNumber(valorPago) ||
		!isNumber(valorUso) ||
		!isNumber(valorNoUso) ||
		!isNumber(descuento) ||
		!isNumber(valorNotaCredito) ||
		!isNumber(saldoCuota) ||
		!isJsonArray(detalleRaw) ||
		!isString(detalleDfac)
	) {
		throw new BillingApiResponseError('detalle_pago contains invalid properties', {
			endpoint,
			validationDetails: 'Missing or invalid numeric, text, or detail properties in detalle_pago',
		})
	}

	const subDetails: IspPaymentInstallmentSubDetail[] = []
	for (let j = 0; j < detalleRaw.length; j++) {
		const subItem = detalleRaw[j]
		if (!isJsonObject(subItem)) {
			throw new BillingApiResponseError(`detalle_pago.detalle[${j}] is not an object`, {
				endpoint,
				validationDetails: `Element at index ${j} is not a valid object`,
			})
		}
		subDetails.push(parsePaymentSubDetail(subItem, j, endpoint))
	}

	return {
		id_contrato: idContrato,
		id_cliente: idCliente,
		id_cuota: idCuota,
		tipo_contrato: tipoContrato,
		periodo_cuota: periodoCuota,
		tarifa,
		total_adicional: totalAdicional,
		valor_pago: valorPago,
		valor_uso: valorUso,
		valor_no_uso: valorNoUso,
		descuento,
		valor_nota_credito: valorNotaCredito,
		saldo_cuota: saldoCuota,
		detalle: subDetails,
		detalle_dfac: detalleDfac,
	}
}

export function parsePaymentBookRow(row: JsonObject, index: number, endpoint: string): IspPaymentBookRow {
	const idFactura = row['id_factura']
	const codEmpresa = row['cod_empresa']
	const codSucursal = row['cod_sucursal']
	const dmccCodEmpresa = row['dmcc_cod_empresa']
	const dmccCodSucursal = row['dmcc_cod_sucursal']
	const codTran = row['cod_tran']
	const asiento = row['asiento']
	const identificacionClienteFactura = row['identificacion_cliente_factura']
	const nombreClienteFactura = row['nombre_cliente_factura']
	const nombreCliente = row['nombre_cliente']
	const identificacionCliente = row['identificacion_cliente']
	const codigoCliente = row['codigo_cliente']
	const tipoContrato = row['tipo_contrato']
	const numFactura = row['num_factura']
	const ejercioFiscal = row['ejercio_fiscal']
	const idCliente = row['id_cliente']
	const fechaVence = row['fecha_vence']
	const fechaEmision = row['fecha_emision']
	const periodoFecha = row['periodo_fecha']
	const idContrato = row['id_contrato']
	const factCodContr = row['fact_cod_contr']
	const comparaIdContrato1 = row['compara_id_contrato_1']
	const comparaIdContrato2 = row['compara_id_contrato_2']
	const detallePagoRaw = row['detalle_pago']

	if (
		!isNumber(idFactura) ||
		!isNumber(codEmpresa) ||
		!isNumber(codSucursal) ||
		!isNumber(dmccCodEmpresa) ||
		!isNumber(dmccCodSucursal) ||
		!isString(codTran) ||
		!isString(asiento) ||
		!isString(identificacionClienteFactura) ||
		!isString(nombreClienteFactura) ||
		!isString(nombreCliente) ||
		!isString(identificacionCliente) ||
		!isString(codigoCliente) ||
		!isString(tipoContrato) ||
		!isString(numFactura) ||
		!isNumber(ejercioFiscal) ||
		!isNumber(idCliente) ||
		!isString(fechaVence) ||
		!isString(fechaEmision) ||
		!isString(periodoFecha) ||
		!isNumber(idContrato) ||
		!isString(factCodContr) ||
		!isString(comparaIdContrato1) ||
		!isString(comparaIdContrato2)
	) {
		throw new BillingApiResponseError(`Row ${index} in pago_informacion does not conform to contract`, {
			endpoint,
			validationDetails: `Missing or invalid properties in payment book row ${index}`,
		})
	}

	const detallePago = parsePaymentBookDetail(detallePagoRaw, endpoint)

	return {
		id_factura: idFactura,
		cod_empresa: codEmpresa,
		cod_sucursal: codSucursal,
		dmcc_cod_empresa: dmccCodEmpresa,
		dmcc_cod_sucursal: dmccCodSucursal,
		cod_tran: codTran,
		asiento,
		identificacion_cliente_factura: identificacionClienteFactura,
		nombre_cliente_factura: nombreClienteFactura,
		nombre_cliente: nombreCliente,
		identificacion_cliente: identificacionCliente,
		codigo_cliente: codigoCliente,
		tipo_contrato: tipoContrato,
		num_factura: numFactura,
		ejercio_fiscal: ejercioFiscal,
		id_cliente: idCliente,
		fecha_vence: fechaVence,
		fecha_emision: fechaEmision,
		periodo_fecha: periodoFecha,
		id_contrato: idContrato,
		fact_cod_contr: factCodContr,
		compara_id_contrato_1: comparaIdContrato1,
		compara_id_contrato_2: comparaIdContrato2,
		detalle_pago: detallePago,
	}
}

export function parsePaymentBookResponse(raw: JsonValue, endpoint: string): IspPaymentBookResponse {
	if (!isJsonObject(raw)) {
		throw new BillingApiResponseError('pago_informacion response must be an object', {
			endpoint,
			validationDetails: 'Expected a JSON object for envelope',
		})
	}

	const success = raw['success']
	const message = raw['message']
	const paginationRaw = raw['pagination']
	const errorsRaw = raw['errors']
	const dataRaw = raw['data']

	// Note: In pago_informacion, success is false even when returning valid data.
	// We accept any boolean for success as confirmed by the server audit.
	if (!isBoolean(success) || !isString(message)) {
		throw new BillingApiResponseError('Invalid envelope in pago_informacion', {
			endpoint,
			validationDetails: 'success must be a boolean and message must be a string',
		})
	}

	const pagination = parsePagination(paginationRaw, endpoint)
	const errors = parseEnvelopeErrors(errorsRaw, endpoint)

	if (!isJsonArray(dataRaw)) {
		throw new BillingApiResponseError('data in pago_informacion must be an array', {
			endpoint,
			validationDetails: 'Field data is not an array',
		})
	}

	const rows: IspPaymentBookRow[] = []
	for (let i = 0; i < dataRaw.length; i++) {
		const item = dataRaw[i]
		if (!isJsonObject(item)) {
			throw new BillingApiResponseError(`Element ${i} in data of pago_informacion is not an object`, {
				endpoint,
				validationDetails: `Element at index ${i} is not a JSON object`,
			})
		}
		rows.push(parsePaymentBookRow(item, i, endpoint))
	}

	return {
		success,
		message,
		pagination,
		errors,
		data: rows,
	}
}
