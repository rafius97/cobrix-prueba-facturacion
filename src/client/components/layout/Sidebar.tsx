import * as React from 'react'
import { NavLink } from 'react-router-dom'
import {
	LayoutDashboard,
	RefreshCw,
	Settings,
	Users,
	Radio,
	X,
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
]

export interface SidebarProps {
	readonly mobileOpen?: boolean
	readonly onClose?: () => void
}

export function Sidebar({ mobileOpen = false, onClose }: SidebarProps): React.JSX.Element {
	// Manejo de tecla Escape para cerrar el drawer en móviles
	React.useEffect(() => {
		if (!mobileOpen || onClose === undefined) return

		function handleKeyDown(e: KeyboardEvent): void {
			if (e.key === 'Escape') {
				onClose?.()
			}
		}

		window.addEventListener('keydown', handleKeyDown)
		return () => {
			window.removeEventListener('keydown', handleKeyDown)
		}
	}, [mobileOpen, onClose])

	const renderNavLinks = (isMobile: boolean): React.JSX.Element => (
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
						onClick={() => {
							if (isMobile && onClose !== undefined) {
								onClose()
							}
						}}
						className={({ isActive }) =>
							cn(
								'flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]',
								isActive
									? 'bg-indigo-50 text-indigo-700 font-semibold shadow-xs'
									: 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
							)
						}
					>
						<div className="flex items-center gap-3">
							<Icon className="w-5 h-5 shrink-0" />
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
	)

	return (
		<>
			{/* 1. Barra lateral fija para escritorio (>= lg / 1024px) */}
			<aside className="hidden lg:flex w-64 border-r border-slate-200 bg-white flex-col shrink-0 h-full">
				<div className="h-16 flex items-center px-6 border-b border-slate-100 gap-3 shrink-0">
					<div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
						<Radio className="w-5 h-5 animate-pulse" />
					</div>
					<div>
						<h1 className="font-bold text-slate-900 tracking-tight leading-tight">Cobrix</h1>
						<p className="text-xs text-slate-500 font-medium">Facturación ISP</p>
					</div>
				</div>

				<div className="p-4 flex-1 overflow-y-auto flex flex-col justify-between">
					{renderNavLinks(false)}
				</div>
			</aside>

			{/* 2. Drawer móvil deslizable (< lg / pantallas menores a 1024px) */}
			{mobileOpen && (
				<div
					role="dialog"
					aria-modal="true"
					aria-label="Menú de navegación"
					className="fixed inset-0 z-50 lg:hidden"
				>
					{/* Overlay oscurecido con cierre al hacer clic fuera */}
					<div
						className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-200"
						onClick={onClose}
						aria-hidden="true"
					/>

					{/* Contenedor del drawer */}
					<aside className="relative flex flex-col w-72 max-w-[85vw] h-full bg-white shadow-2xl z-10 animate-in slide-in-from-left duration-200">
						<div className="h-16 flex items-center justify-between px-6 border-b border-slate-100 shrink-0">
							<div className="flex items-center gap-3">
								<div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-xs">
									<Radio className="w-5 h-5" />
								</div>
								<div>
									<h2 className="font-bold text-slate-900 tracking-tight leading-tight">Cobrix</h2>
									<p className="text-xs text-slate-500 font-medium">Facturación ISP</p>
								</div>
							</div>
							<button
								type="button"
								onClick={onClose}
								className="w-10 h-10 -mr-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 flex items-center justify-center cursor-pointer transition-colors"
								aria-label="Cerrar menú de navegación"
							>
								<X className="w-5 h-5" />
							</button>
						</div>

						<div className="p-4 flex-1 overflow-y-auto">
							{renderNavLinks(true)}
						</div>
					</aside>
				</div>
			)}
		</>
	)
}
