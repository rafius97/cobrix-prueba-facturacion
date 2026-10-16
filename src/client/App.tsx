import * as React from 'react'
import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom'

import { AppLayout } from './components/layout/AppLayout'
import { AssignmentPage } from './pages/AssignmentPage'
import { CustomerDossierPage } from './pages/CustomerDossierPage'
import { CustomersPage } from './pages/CustomersPage'
import { DashboardPage } from './pages/DashboardPage'
import { PlaceholderPage } from './pages/PlaceholderPage'
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
					<Route
						path="configuracion"
						element={
							<PlaceholderPage
								title="Configuración de la Empresa y Proveedor"
								section="§3.1"
								phase="Subfase 7.3"
								description="Ajustes de conexión con la API del ISP, estados de contratos, topes y corrida automática."
							/>
						}
					/>
					<Route path="enunciado" element={<AssignmentPage />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Route>
			</Routes>
		</BrowserRouter>
	)
}
