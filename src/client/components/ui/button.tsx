import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

export const buttonVariants = cva(
	'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 disabled:pointer-events-none disabled:opacity-50 cursor-pointer active:scale-[0.98]',
	{
		variants: {
			variant: {
				default: 'bg-slate-900 text-white shadow-xs hover:bg-slate-800',
				destructive: 'bg-rose-600 text-white shadow-xs hover:bg-rose-700',
				outline: 'border border-slate-200 bg-white text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-slate-900',
				secondary: 'bg-slate-100 text-slate-800 hover:bg-slate-200/80',
				ghost: 'hover:bg-slate-100 text-slate-600 hover:text-slate-900',
				link: 'text-indigo-600 underline-offset-4 hover:underline',
				brand: 'bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 text-white shadow-xs hover:shadow-indigo-500/20 hover:opacity-95',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-8.5 rounded-lg px-3 text-xs',
				lg: 'h-11 rounded-xl px-6 font-semibold',
				icon: 'h-9 w-9 rounded-xl',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	},
)

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, asChild = false, ...props }, ref) => {
		const Comp = asChild ? Slot : 'button'
		return (
			<Comp
				className={cn(buttonVariants({ variant, size, className }))}
				ref={ref}
				{...props}
			/>
		)
	},
)
Button.displayName = 'Button'
