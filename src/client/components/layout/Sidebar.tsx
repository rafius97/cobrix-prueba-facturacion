import * as React from 'react'
import { NavLink } from 'react-router-dom'
import {
	LayoutDashboard,
	RefreshCw,
	Settings,
	Users,
	Activity,
	Radio,
	X,
	CheckCircle2,
} from 'lucide-react'

import { cn } from '../../lib/utils'

const COBRIX_LOGO_PATH = '/cobrix-logo.png'

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
		<div className="flex flex-col h-full justify-between">
			<nav className="space-y-1.5">
				<p className="px-3.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
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
									'group flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 min-h-[44px]',
									isActive
										? 'bg-gradient-to-r from-purple-100/90 to-indigo-100/80 text-purple-950 font-bold border border-purple-200/60 shadow-xs'
										: 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
								)
							}
						>
							{({ isActive }) => (
								<>
									<div className="flex items-center gap-3">
										<Icon
											className={cn(
												'w-5 h-5 shrink-0 transition-colors',
												isActive
													? 'text-purple-700'
													: 'text-slate-400 group-hover:text-slate-600',
											)}
										/>
										<span>{item.name}</span>
									</div>
									{item.badge !== undefined && (
										<span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-purple-200/70 text-purple-900">
											{item.badge}
										</span>
									)}
								</>
							)}
						</NavLink>
					)
				})}
			</nav>

			{/* Widget inferior: Estado del ISP Simulador (Inspirado en la tarjeta Pro Features de Revora) */}
			<div className="mt-6 pt-4 border-t border-purple-100/60">
				<div className="p-3.5 rounded-2xl bg-white/70 border border-purple-100/80 shadow-2xs backdrop-blur-xs space-y-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
							Entorno ISP
						</span>
						<span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
							<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
							En línea
						</span>
					</div>
					<div className="flex items-center gap-2.5">
						<div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white shadow-xs shrink-0">
							<Radio className="w-4 h-4" />
						</div>
						<div className="min-w-0">
							<p className="text-xs font-bold text-slate-800 truncate">
								Simulador ISP
							</p>
							<p className="text-[11px] text-slate-400 font-mono truncate">
								:4410 · Caracas
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	)

	return (
		<>
			{/* 1. Barra lateral fija para escritorio (>= lg / 1024px) */}
			<aside className="hidden lg:flex w-64 border-r border-purple-100/70 bg-gradient-to-b from-[#f3f0fb] via-[#f7f5fd] to-[#f2effb] flex-col shrink-0 h-full select-none">
				<div className="h-20 flex items-center px-6 border-b border-purple-100/60 gap-3 shrink-0">
					<img
						src={COBRIX_LOGO_PATH}
						alt="Cobrix"
						className="h-10 w-auto object-contain drop-shadow-xs shrink-0"
					/>
					<div>
						<h1 className="font-extrabold text-xl text-slate-900 tracking-tight leading-tight">
							Cobrix
						</h1>
						<p className="text-[11px] text-purple-700 font-semibold tracking-wide">
							Facturación ISP
						</p>
					</div>
				</div>

				<div className="p-4 flex-1 overflow-y-auto">
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
						className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity duration-200"
						onClick={onClose}
						aria-hidden="true"
					/>

					{/* Contenedor del drawer */}
					<aside className="relative flex flex-col w-72 max-w-[85vw] h-full bg-gradient-to-b from-[#f3f0fb] via-[#f7f5fd] to-[#f2effb] border-r border-purple-100/80 shadow-2xl z-10 animate-in slide-in-from-left duration-200 select-none">
						<div className="h-20 flex items-center justify-between px-6 border-b border-purple-100/60 shrink-0">
							<div className="flex items-center gap-3">
								<img
									src={COBRIX_LOGO_PATH}
									alt="Cobrix"
									className="h-9 w-auto object-contain drop-shadow-xs shrink-0"
								/>
								<div>
									<h2 className="font-extrabold text-xl text-slate-900 tracking-tight leading-tight">
										Cobrix
									</h2>
									<p className="text-[11px] text-purple-700 font-semibold tracking-wide">
										Facturación ISP
									</p>
								</div>
							</div>
							<button
								type="button"
								onClick={onClose}
								className="w-10 h-10 -mr-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white/60 flex items-center justify-center cursor-pointer transition-colors"
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
