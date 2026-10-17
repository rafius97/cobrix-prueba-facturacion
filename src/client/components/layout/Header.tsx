import * as React from 'react'
import { CheckCircle2, Calendar, Menu, Search, Bell, Building2 } from 'lucide-react'

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
		<header className="h-20 border-b border-purple-100/50 bg-white/70 backdrop-blur-md px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-20 shrink-0">
			{/* Bloque Izquierdo: Botón Hamburguesa móvil + Buscador estilo Revora */}
			<div className="flex items-center gap-3 sm:gap-4 flex-1 max-w-md">
				{onMenuToggle !== undefined && (
					<button
						type="button"
						onClick={onMenuToggle}
						aria-label={isMobileMenuOpen ? 'Cerrar menú' : 'Abrir menú de navegación'}
						aria-expanded={isMobileMenuOpen}
						className="lg:hidden w-10 h-10 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-white rounded-xl border border-transparent hover:border-purple-100 flex items-center justify-center cursor-pointer transition-colors shrink-0 shadow-2xs"
					>
						<Menu className="w-5 h-5" />
					</button>
				)}

				{/* Buscador visual estilo Revora */}
				<div className="relative w-full max-w-xs hidden sm:block">
					<Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
					<input
						type="text"
						readOnly
						placeholder="Buscar en Cobrix..."
						className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-100/60 hover:bg-slate-100/80 border border-transparent focus:border-purple-200 rounded-xl text-slate-700 placeholder-slate-400 focus:outline-none transition-colors cursor-default"
					/>
				</div>
			</div>

			{/* Bloque Derecho: Fecha Sandbox, Notificación y Perfil de Empresa */}
			<div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
				<div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-purple-50/70 border border-purple-100/60 text-xs text-purple-900 font-medium">
					<Calendar className="w-3.5 h-3.5 text-purple-600 shrink-0" />
					<span>Fecha Sandbox:</span>
					<span className="font-mono font-bold">{todayDate}</span>
				</div>

				<Badge
					variant="outline"
					className="gap-1.5 py-1 px-2.5 sm:px-3 text-emerald-700 border-emerald-200/80 bg-emerald-50/70 text-[11px] sm:text-xs shrink-0 font-medium shadow-2xs"
				>
					<span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
					<span className="hidden xs:inline">API ISP Activa</span>
					<span className="xs:hidden">Activa</span>
				</Badge>

				{/* Perfil de empresa / Operador (estilo Revora) */}
				<div className="flex items-center gap-2.5 pl-2 sm:pl-3 border-l border-slate-200/80">
					<div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-xs shadow-xs shrink-0">
						CT
					</div>
					<div className="hidden sm:block text-left">
						<p className="text-xs font-bold text-slate-800 leading-tight truncate max-w-[120px]">
							{companyName}
						</p>
						<p className="text-[10px] text-slate-400 font-mono leading-tight">
							{companyTaxId}
						</p>
					</div>
				</div>
			</div>
		</header>
	)
}
