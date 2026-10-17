import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

export const badgeVariants = cva(
	'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] sm:text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
	{
		variants: {
			variant: {
				default:
					'border-transparent bg-slate-900 text-slate-50 shadow-xs hover:bg-slate-800',
				secondary:
					'border-slate-200/80 bg-slate-100 text-slate-800 hover:bg-slate-200/70',
				destructive:
					'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100/80',
				outline: 'border-slate-200 bg-white/80 text-slate-700',
				success:
					'border-emerald-200/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/70',
				warn:
					'border-amber-200/70 bg-amber-50 text-amber-800 hover:bg-amber-100/70',
				simulation:
					'border-amber-200/80 bg-amber-50 text-amber-800 hover:bg-amber-100/80',
				real:
					'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200/80',
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
