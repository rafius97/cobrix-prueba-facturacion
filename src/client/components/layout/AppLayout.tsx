import * as React from 'react'
import { Outlet } from 'react-router-dom'

import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppLayout(): React.JSX.Element {
	return (
		<div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
			<Sidebar />
			<div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
				<Header />
				<main className="flex-1 overflow-y-auto p-8">
					<div className="max-w-7xl w-full mx-auto">
						<Outlet />
					</div>
				</main>
			</div>
		</div>
	)
}
