import * as React from 'react'
import { CheckCircle2, Calendar, Menu } from 'lucide-react'

import { Badge } from '../ui/badge'

export interface HeaderProps {
	readonly companyName?: string
	readonly companyTaxId?: string
	readonly onMenuToggle?: () => void
	readonly isMobileMenuOpen?: boolean
}

export function Header({
	companyName = 'Cobrix Telecom',
	companyTaxId = 'J-50000000-0',
	onMenuToggle,
	isMobileMenuOpen = false,
}: HeaderProps): React.JSX.Element {
	const todayDate = '13/10/2026' // Fecha fija del sandbox (SANDBOX_TODAY)

	return (
		<header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-xs px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-20 shrink-0">
			{/* Bloque Izquierdo: Botón Hamburguesa móvil + Identificación de Empresa */}
			<div className="flex items-center gap-2 sm:gap-3 min-w-0">
				{onMenuToggle !== undefined && (
					<button
						type="button"
						onClick={onMenuToggle}
						aria-label={isMobileMenuOpen ? 'Cerrar menú' : 'Abrir menú de navegación'}
						aria-expanded={isMobileMenuOpen}
						className="lg:hidden w-10 h-10 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg flex items-center justify-center cursor-pointer transition-colors shrink-0"
					>
						<Menu className="w-5 h-5" />
					</button>
				)}

				<div className="flex items-center gap-1.5 sm:gap-2.5 truncate">
					<h2 className="text-sm sm:text-base font-semibold text-slate-800 truncate" title={companyName}>
						{companyName}
					</h2>
					<span className="text-[11px] sm:text-xs text-slate-400 font-mono shrink-0 hidden xs:inline">
						({companyTaxId})
					</span>
				</div>
			</div>

			{/* Bloque Derecho: Fecha Sandbox y Estado de Conexión ISP */}
			<div className="flex items-center gap-2 sm:gap-4 shrink-0">
				<div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 font-medium">
					<Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
					<span className="hidden md:inline">Fecha Sandbox:</span>
					<span className="font-mono text-slate-700 font-semibold">{todayDate}</span>
				</div>

				<Badge
					variant="outline"
					className="gap-1 sm:gap-1.5 py-1 px-2 sm:px-2.5 text-emerald-700 border-emerald-200 bg-emerald-50/50 text-[11px] sm:text-xs shrink-0"
				>
					<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
					<span className="hidden xs:inline">API ISP Activa</span>
					<span className="xs:hidden">Activa</span>
				</Badge>
			</div>
		</header>
	)
}
