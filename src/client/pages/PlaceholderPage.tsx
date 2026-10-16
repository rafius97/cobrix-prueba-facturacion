import * as React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Clock } from 'lucide-react'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'

export interface PlaceholderPageProps {
	readonly title: string
	readonly section: string
	readonly phase: string
	readonly description: string
}

export function PlaceholderPage({ title, section, phase, description }: PlaceholderPageProps): React.JSX.Element {
	return (
		<div className="space-y-6">
			<div>
				<div className="flex items-center gap-3">
					<h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
					<Badge variant="warn" className="gap-1">
						<Clock className="w-3 h-3" />
						<span>{phase}</span>
					</Badge>
				</div>
				<p className="text-sm text-slate-500 mt-1">{description}</p>
			</div>

			<Card className="border-dashed border-slate-300 bg-slate-50/50 shadow-none">
				<CardHeader className="text-center py-12">
					<div className="w-12 h-12 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center mx-auto mb-4">
						<Clock className="w-6 h-6" />
					</div>
					<CardTitle className="text-lg font-semibold text-slate-800">
						Módulo planificado para {phase}
					</CardTitle>
					<CardDescription className="max-w-md mx-auto mt-2 text-sm text-slate-600">
						La Subfase 7.1 establece los cimientos HTTP, la integración de Tailwind CSS v4, el Dashboard y el Enunciado. Esta pantalla será implementada con sus endpoints dedicados en la siguiente etapa según la sección {section} de <span className="font-mono">docs/ENUNCIADO.md</span>.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex justify-center pb-12">
					<Button asChild variant="outline" className="gap-2">
						<Link to="/">
							<ArrowLeft className="w-4 h-4" />
							<span>Volver al Resumen</span>
						</Link>
					</Button>
				</CardContent>
			</Card>
		</div>
	)
}
