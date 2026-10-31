import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				experimental: { async: true },
				// force runes mode except for libraries, can be dropped in Svelte 6
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter({ fallback: 'index.html' })
		})
	],
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true
	}
});
