import * as React from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'

import { AppLayout } from './components/layout/AppLayout'
import { CustomerDossierPage } from './pages/CustomerDossierPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { ConfigPage } from './pages/ConfigPage'
import { SyncPage } from './pages/SyncPage'
import { SyncRunDetailPage } from './pages/SyncRunDetailPage'

export function App(): React.JSX.Element {
	return (
		<BrowserRouter>
			<Routes>
				<Route path="/" element={<AppLayout />}>
					<Route index element={<DashboardPage />} />
					<Route path="clientes" element={<CustomersPage />} />
					<Route path="clientes/:id" element={<CustomerDossierPage />} />
					<Route path="sincronizacion" element={<SyncPage />} />
					<Route path="sincronizacion/corridas/:id" element={<SyncRunDetailPage />} />
					<Route path="configuracion" element={<ConfigPage />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Route>
			</Routes>
		</BrowserRouter>
	)
}
