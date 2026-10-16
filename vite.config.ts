import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
	],
	root: '.',
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src/client'),
			'@shared': path.resolve(__dirname, './src/shared'),
		},
	},
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/api': {
				target: 'http://localhost:4300',
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: 'dist/client',
		emptyOutDir: true,
		sourcemap: true,
	},
})
