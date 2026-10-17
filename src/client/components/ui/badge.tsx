import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

export const badgeVariants = cva(
	'inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default:
					'border-transparent bg-slate-900 text-slate-50 shadow hover:bg-slate-900/80',
				secondary:
					'border-transparent bg-slate-100 text-slate-900 hover:bg-slate-100/80',
				destructive:
					'border-transparent bg-red-500 text-slate-50 shadow hover:bg-red-500/80',
				outline: 'text-slate-950 border-slate-200',
				success:
					'border-transparent bg-emerald-600 text-white shadow hover:bg-emerald-600/80',
				warn:
					'border-transparent bg-amber-500 text-white shadow hover:bg-amber-500/80',
				simulation:
					'border-amber-200 bg-amber-100 text-amber-800 hover:bg-amber-100/80',
				real:
					'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-100/80',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	},
)

export interface BadgeProps
	extends React.HTMLAttributes<HTMLDivElement>,
		VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.JSX.Element {
	return (
		<div className={cn(badgeVariants({ variant }), className)} {...props} />
	)
}

export interface ExecutionModeBadgeProps {
	readonly isSimulation: boolean
	readonly className?: string
}

/**
 * Badge unificado para el modo de ejecución de corridas de sincronización (Simulación vs Real).
 * Centraliza el color, contraste y texto para garantizar consistencia visual en todas las vistas.
 */
export function ExecutionModeBadge({
	isSimulation,
	className,
}: ExecutionModeBadgeProps): React.JSX.Element {
	return (
		<Badge
			variant={isSimulation ? 'simulation' : 'real'}
			className={className}
		>
			{isSimulation ? 'Simulación' : 'Real'}
		</Badge>
	)
}
