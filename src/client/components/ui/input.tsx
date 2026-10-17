import * as React from 'react'

import { cn } from '../../lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
	({ className, type = 'text', ...props }, ref) => {
		return (
			<input
				type={type}
				className={cn(
					'flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm shadow-2xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 focus-visible:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-50',
					className,
				)}
				ref={ref}
				{...props}
			/>
		)
	},
)
Input.displayName = 'Input'
