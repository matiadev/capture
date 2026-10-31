<script lang="ts">
	import '@fontsource-variable/inter';
	import '../lib/theme.css';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Capture</title>
</svelte:head>

{@render children()}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(html, body) {
		margin: 0;
		height: 100%;
		overflow: hidden;
		background: var(--color-bg);
		color: var(--color-text);
		color-scheme: dark;
		font-family: var(--font-sans);
		-webkit-font-smoothing: antialiased;
	}

	:global(::selection) {
		background: var(--color-selection);
		color: var(--color-text);
	}

	:global(button, input, select) {
		font: inherit;
	}

	:global(button) {
		cursor: pointer;
	}
</style>
