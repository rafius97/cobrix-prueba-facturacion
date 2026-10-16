/**
 * Controlador de API para el directorio y expediente de clientes de Cobrix.
 * Estrictamente tipado sin `any` ni `unknown`.
 */

import type { DatabaseSync } from 'node:sqlite'

import {
	contractRepository,
	customerEventRepository,
	customerRepository,
	invoiceRepository,
} from '../../cobrix/db/repositories.ts'
import type {
	ContractItemDto,
	CustomerDetailDto,
	CustomerDossierResponseDto,
	CustomerEventItemDto,
	CustomerListItemDto,
	CustomerListResponseDto,
	CustomerMetricsDto,
	InvoiceItemDto,
} from '../../shared/api-types.ts'

/**
 * Obtiene el directorio de clientes con métricas agregadas y búsqueda opcional.
 */
export function getCustomersDirectory(
	db: DatabaseSync,
	searchQuery?: string,
): CustomerListResponseDto {
	const metricsList = customerRepository.listCustomerMetrics(db, searchQuery)

	const customers: CustomerListItemDto[] = metricsList.map(item => ({
		customerId: item.customerId,
		originalDocument: item.originalDocument,
		documentType: item.documentType,
		personType: item.personType,
		name: item.name,
		totalContractsCount: item.totalContractsCount,
		openInvoicesCount: item.openInvoicesCount,
		paidInvoicesCount: item.paidInvoicesCount,
		openBalanceCents: item.openBalanceCents,
		oldestOpenDueDate: item.oldestOpenDueDate,
	}))

	return {
		customers,
		totalCount: customers.length,
	}
}

/**
 * Obtiene el expediente integral de un cliente por su identificador normalizado.
 * Devuelve `null` si el cliente no existe.
 */
export function getCustomerDossier(
	db: DatabaseSync,
	customerId: string,
): CustomerDossierResponseDto | null {
	const customer = customerRepository.getById(db, customerId)
	if (customer === null) {
		return null
	}

	const rawMetrics = customerRepository.getCustomerMetricsById(db, customerId)
	const metrics: CustomerMetricsDto =
		rawMetrics !== null
			? {
					totalContractsCount: rawMetrics.totalContractsCount,
					openInvoicesCount: rawMetrics.openInvoicesCount,
					paidInvoicesCount: rawMetrics.paidInvoicesCount,
					openBalanceCents: rawMetrics.openBalanceCents,
					oldestOpenDueDate: rawMetrics.oldestOpenDueDate,
				}
			: {
					totalContractsCount: 0,
					openInvoicesCount: 0,
					paidInvoicesCount: 0,
					openBalanceCents: 0,
					oldestOpenDueDate: null,
				}

	const contracts: ContractItemDto[] = contractRepository
		.listByCustomerId(db, customerId)
		.map(c => ({
			id: c.id,
			customerId: c.customerId,
			code: c.code,
			status: c.status,
			plan: c.plan,
			planPriceCents: c.planPriceCents,
			branch: c.branch,
			currency: c.currency,
			billingDay: c.billingDay,
			cutoffDay: c.cutoffDay,
			createdAt: c.createdAt,
			updatedAt: c.updatedAt,
		}))

	const invoices: InvoiceItemDto[] = invoiceRepository
		.listByCustomerId(db, customerId)
		.map(inv => ({
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			externalDebtId: inv.externalDebtId,
			contractId: inv.contractId,
			customerId: inv.customerId,
			period: inv.period,
			dueDate: inv.dueDate,
			cutDate: inv.cutDate,
			totalAmountCents: inv.totalAmountCents,
			balanceCents: inv.balanceCents,
			status: inv.status,
			paidAt: inv.paidAt,
			ispPaymentInvoice: inv.ispPaymentInvoice,
			createdAt: inv.createdAt,
			updatedAt: inv.updatedAt,
		}))

	const events: CustomerEventItemDto[] = customerEventRepository
		.listByCustomerId(db, customerId)
		.map(ev => ({
			id: ev.id,
			customerId: ev.customerId,
			eventType: ev.eventType,
			description: ev.description,
			metadataJson: ev.metadataJson,
			createdAt: ev.createdAt,
		}))

	const customerDetail: CustomerDetailDto = {
		id: customer.id,
		originalDocument: customer.originalDocument,
		documentType: customer.documentType,
		personType: customer.personType,
		name: customer.name,
		phone: customer.phone,
		email: customer.email,
		address: customer.address,
		createdAt: customer.createdAt,
		updatedAt: customer.updatedAt,
	}

	return {
		customer: customerDetail,
		metrics,
		contracts,
		invoices,
		events,
	}
}
