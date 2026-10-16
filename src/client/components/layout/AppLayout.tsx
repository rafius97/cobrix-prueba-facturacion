import * as React from 'react'
import { Outlet } from 'react-router-dom'

import { Header } from './Header'
import { Sidebar } from './Sidebar'

export function AppLayout(): React.JSX.Element {
	return (
		<div className="flex min-h-screen bg-slate-50 text-slate-900">
			<Sidebar />
			<div className="flex-1 flex flex-col min-w-0">
				<Header />
				<main className="flex-1 p-8 max-w-7xl w-full mx-auto">
					<Outlet />
				</main>
			</div>
		</div>
	)
}
