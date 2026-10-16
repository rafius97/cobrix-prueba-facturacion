import * as React from 'react'
import { NavLink } from 'react-router-dom'
import {
	FileText,
	LayoutDashboard,
	RefreshCw,
	Settings,
	Users,
	Radio,
} from 'lucide-react'

import { cn } from '../../lib/utils'

interface NavItem {
	readonly name: string
	readonly href: string
	readonly icon: React.ComponentType<{ className?: string }>
	readonly badge?: string
}

const NAVIGATION_ITEMS: readonly NavItem[] = [
	{ name: 'Resumen', href: '/', icon: LayoutDashboard },
	{ name: 'Clientes', href: '/clientes', icon: Users },
	{ name: 'Sincronización', href: '/sincronizacion', icon: RefreshCw },
	{ name: 'Configuración', href: '/configuracion', icon: Settings },
	{ name: 'Enunciado', href: '/enunciado', icon: FileText },
]

export function Sidebar(): React.JSX.Element {
	return (
		<aside className="w-64 border-r border-slate-200 bg-white flex flex-col shrink-0 min-h-screen">
			<div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3">
				<div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
					<Radio className="w-5 h-5 animate-pulse" />
				</div>
				<div>
					<h1 className="font-bold text-slate-900 tracking-tight leading-tight">Cobrix</h1>
					<p className="text-xs text-slate-500 font-medium">Facturación ISP</p>
				</div>
			</div>

			<div className="p-4 flex-1 flex flex-col justify-between">
				<nav className="space-y-1">
					<p className="px-3 text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
						Menú Principal
					</p>
					{NAVIGATION_ITEMS.map(item => {
						const Icon = item.icon
						return (
							<NavLink
								key={item.href}
								to={item.href}
								end={item.href === '/'}
								className={({ isActive }) =>
									cn(
										'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
										isActive
											? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
											: 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
									)
								}
							>
								<div className="flex items-center gap-3">
									<Icon className="w-4 h-4 shrink-0" />
									<span>{item.name}</span>
								</div>
								{item.badge !== undefined && (
									<span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded-sm bg-slate-100 text-slate-500">
										{item.badge}
									</span>
								)}
							</NavLink>
						)
					})}
				</nav>

				<div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mt-6">
					<div className="flex items-center justify-between text-xs text-slate-500 mb-1">
						<span>Versión UI</span>
						<span className="font-mono text-[11px] font-semibold text-slate-700">v7.1</span>
					</div>
					<div className="flex items-center justify-between text-xs text-slate-500">
						<span>Motor de Estilos</span>
						<span className="font-semibold text-indigo-600 text-[11px]">Tailwind v4</span>
					</div>
				</div>
			</div>
		</aside>
	)
}
