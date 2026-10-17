import * as React from 'react'
import { Outlet, useLocation } from 'react-router-dom'

import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppLayout(): React.JSX.Element {
	const [isMobileNavOpen, setIsMobileNavOpen] = React.useState<boolean>(false)
	const location = useLocation()

	// Cierra el drawer automáticamente al cambiar de página
	React.useEffect(() => {
		setIsMobileNavOpen(false)
	}, [location.pathname])

	return (
		<div className="flex h-screen overflow-hidden bg-[#f4f3f9] text-slate-900 font-sans selection:bg-purple-100 selection:text-purple-900">
			<Sidebar
				mobileOpen={isMobileNavOpen}
				onClose={() => setIsMobileNavOpen(false)}
			/>
			<div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
				<Header
					onMenuToggle={() => setIsMobileNavOpen(prev => !prev)}
					isMobileMenuOpen={isMobileNavOpen}
				/>
				<main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
					<div className="max-w-7xl w-full mx-auto">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	)
}
