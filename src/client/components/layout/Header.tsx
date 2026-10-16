import * as React from 'react'
import { CheckCircle2, Calendar } from 'lucide-react'

import { Badge } from '../ui/badge'

export interface HeaderProps {
	readonly companyName?: string
	readonly companyTaxId?: string
}

export function Header({ companyName = 'Cobrix Telecom', companyTaxId = 'J-50000000-0' }: HeaderProps): React.JSX.Element {
	const todayDate = '13/10/2026' // Fecha fija del sandbox (SANDBOX_TODAY)

	return (
		<header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-xs px-8 flex items-center justify-between sticky top-0 z-10">
			<div className="flex items-center gap-3">
				<h2 className="text-base font-semibold text-slate-800">{companyName}</h2>
				<span className="text-xs text-slate-400 font-mono">({companyTaxId})</span>
			</div>

			<div className="flex items-center gap-4">
				<div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
					<Calendar className="w-3.5 h-3.5 text-slate-400" />
					<span>Fecha Sandbox:</span>
					<span className="font-mono text-slate-700 font-semibold">{todayDate}</span>
				</div>

				<Badge variant="outline" className="gap-1.5 py-1 text-emerald-700 border-emerald-200 bg-emerald-50/50">
					<CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
					<span>API ISP Activa</span>
				</Badge>
			</div>
		</header>
	)
}
