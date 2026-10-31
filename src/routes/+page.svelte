<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageResult, ThemeMode } from '../lib/types';

	let url = $state('');
	let viewportWidth = $state(1440);
	let duration = $state(10);
	let fps = $state(60);
	let hideScrollbar = $state(false);
	let theme = $state<ThemeMode>('system');

	// bumping the id remounts the webview, which reloads the page
	let request = $state<{ id: number; url: string } | null>(null);
	let requestId = 0;

	let loading = $state(false);
	let loadError = $state<string | null>(null);
	let canGoBack = $state(false);
	let canGoForward = $state(false);
	let webview: any = null;
	let result = $state<PageResult | null>(null);
	let captureState = $state<'idle' | 'capturing' | 'success'>('idle');
	let imageState = $state<'idle' | 'working' | 'success'>('idle');
	let progress = $state(0);
	let error = $state<string | null>(null);
	let ready = $state(false);

	onMount(() => {
		ready = typeof window !== 'undefined' && !!window.api;
	});

	const percent = $derived(Math.round(progress * 100));
	const hasUrl = $derived(url.trim().length > 0);
	const capturing = $derived(captureState === 'capturing');

	let successTimer: ReturnType<typeof setTimeout> | undefined;
	let imageTimer: ReturnType<typeof setTimeout> | undefined;

	function normalizeUrl(input: string): string {
		const trimmed = input.trim();
		if (!trimmed) return '';
		if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return trimmed;
		return 'https://' + trimmed;
	}

	function describeError(cause: unknown): string {
		const message = cause instanceof Error ? cause.message : String(cause);
		if (/ERR_NAME_NOT_RESOLVED/.test(message)) return 'That address could not be found.';
		if (/ERR_CONNECTION/.test(message)) return 'The site refused the connection.';
		if (/ERR_ABORTED|ERR_FAILED/.test(message)) return 'The page could not be loaded.';
		if (/timeout/i.test(message)) return 'The page took too long to load.';
		return message;
	}

	function runPreview() {
		if (!ready || capturing) return;

		const target = normalizeUrl(url);
		if (!target) return;

		error = null;
		result = null;
		loadError = null;
		canGoBack = false;
		canGoForward = false;
		loading = true;
		request = { id: ++requestId, url: target };
	}

	function attachWebview(node: HTMLElement) {
		const view = node as any;
		webview = view;

		const syncHistory = () => {
			try {
				canGoBack = view.canGoBack();
				canGoForward = view.canGoForward();
			} catch {
				canGoBack = false;
				canGoForward = false;
			}
		};

		const onStart = () => {
			loading = true;
		};
		const onFinish = () => {
			loading = false;
			loadError = null;
			syncHistory();
		};
		const onFail = (event: any) => {
			// -3 is ERR_ABORTED, fired when navigating away mid-load
			if (event.errorCode === -3) return;
			loading = false;
			loadError = event.errorDescription || 'The page could not be loaded.';
		};

		view.addEventListener('loadstart', onStart);
		view.addEventListener('did-finish-load', onFinish);
		view.addEventListener('did-fail-load', onFail);
		view.addEventListener('did-navigate', syncHistory);
		view.addEventListener('did-navigate-in-page', syncHistory);

		return () => {
			view.removeEventListener('loadstart', onStart);
			view.removeEventListener('did-finish-load', onFinish);
			view.removeEventListener('did-fail-load', onFail);
			view.removeEventListener('did-navigate', syncHistory);
			view.removeEventListener('did-navigate-in-page', syncHistory);
			if (webview === view) webview = null;
		};
	}

	function goBack() {
		try {
			webview?.goBack();
		} catch {
			/* nothing to go back to */
		}
	}

	function goForward() {
		try {
			webview?.goForward();
		} catch {
			/* nothing to go forward to */
		}
	}

	async function runCapture() {
		if (!window.api) return;

		// while capturing the same button cancels
		if (captureState === 'capturing') {
			await window.api.cancel();
			return;
		}

		const target = normalizeUrl(url);
		if (!target) return;

		clearTimeout(successTimer);
		error = null;
		captureState = 'capturing';
		progress = 0;

		const stop = window.api.onProgress((update) => {
			progress = update.progress ?? 0;
		});

		try {
			const outcome = await window.api.run({
				url: target,
				width: viewportWidth,
				height: 900,
				duration,
				fps
			});

			if ('cancelled' in outcome) {
				// cancelled by the user, keep the preview as it was
				captureState = 'idle';
			} else {
				result = outcome;
				request = null;
				captureState = 'success';
				successTimer = setTimeout(() => {
					captureState = 'idle';
				}, 2500);
			}
		} catch (cause) {
			error = describeError(cause);
			captureState = 'idle';
		} finally {
			stop();
		}
	}

	async function runImage() {
		if (!window.api || imageState === 'working') return;

		const target = normalizeUrl(url);
		if (!target) return;

		clearTimeout(imageTimer);
		error = null;
		imageState = 'working';

		try {
			const saved = await window.api.saveImage({
				url: target,
				width: viewportWidth,
				height: 900
			});

			result = saved;
			request = null;
			imageState = 'success';
			imageTimer = setTimeout(() => {
				imageState = 'idle';
			}, 2500);
		} catch (cause) {
			error = describeError(cause);
			imageState = 'idle';
		}
	}

	function setTheme(mode: ThemeMode) {
		theme = mode;
		window.api?.setTheme(mode);

		// reload the preview so the page re-evaluates its colour preference
		if (request) {
			request = { id: ++requestId, url: request.url };
		}
	}

	function reset() {
		result = null;
		error = null;
		clearTimeout(successTimer);
		clearTimeout(imageTimer);
		captureState = 'idle';
		imageState = 'idle';
	}
</script>

<div class="app">
	<header class="bar">
		<div class="nav">
			<button type="button" disabled={!canGoBack} onclick={goBack} aria-label="Back">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6" />
				</svg>
			</button>
			<button type="button" disabled={!canGoForward} onclick={goForward} aria-label="Forward">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="9 18 15 12 9 6" />
				</svg>
			</button>
			<button type="button" onclick={runPreview} disabled={capturing} aria-label="Reload">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="23 4 23 10 17 10" />
					<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
				</svg>
			</button>
		</div>

		<form
			class="urlbar"
			onsubmit={(event) => {
				event.preventDefault();
				runPreview();
			}}
		>
			<span class="lock" aria-hidden="true">
				<svg width="10" height="12" viewBox="0 0 10 12" fill="none">
					<path d="M2.6 5V3.6a2.4 2.4 0 0 1 4.8 0V5" stroke="currentColor" stroke-width="1.1" />
					<rect x="1" y="5" width="8" height="6" rx="1.4" fill="currentColor" />
				</svg>
			</span>
			<input
				bind:value={url}
				placeholder="Paste a page address"
				spellcheck="false"
				autocomplete="off"
				disabled={capturing}
			/>
		</form>

		<button class="pill" type="button" onclick={runPreview} disabled={capturing || !ready || !hasUrl}>
			Preview
		</button>
	</header>

	<main class="stage" class:hide-scrollbar={hideScrollbar}>
		{#if !ready}
			<div class="empty">
				<p>Open this window from the desktop app to capture pages.</p>
			</div>
		{:else if result}
			<div class="result">
				<div class="player" class:is-image={result.kind === 'image'}>
					{#if result.kind === 'video'}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video src={result.url} controls playsinline></video>
					{:else}
						<img src={result.url} alt="Saved page screenshot" />
					{/if}
				</div>

				<div class="result-actions">
					<button class="btn" type="button" onclick={() => window.api?.saveAs(result!.path)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
							<polyline points="7 10 12 15 17 10" />
							<line x1="12" y1="15" x2="12" y2="3" />
						</svg>
						Save as
					</button>
					<button class="btn ghost" type="button" onclick={() => window.api?.reveal(result!.path)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
						</svg>
						Show in folder
					</button>
					<button class="btn ghost" type="button" onclick={reset}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
							<polyline points="23 4 23 10 17 10" />
							<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
						</svg>
						Capture another
					</button>
				</div>
			</div>
		{:else if request}
			{#key request.id}
				<!-- Same partition as the capture window, so logging in here carries over. -->
				<webview
					{@attach attachWebview}
					src={request.url}
					partition="capture"
					allowpopups
					class="live"
				></webview>
			{/key}
		{/if}

		{#if loading && !capturing}
			<div class="loading-bar" aria-hidden="true"><i></i></div>
		{/if}

		{#if loadError}
			<div class="toast">
				<span>{loadError}</span>
				<button type="button" onclick={() => (loadError = null)} aria-label="Dismiss">x</button>
			</div>
		{/if}

		{#if error}
			<div class="toast">
				<span>{error}</span>
				<button type="button" onclick={() => (error = null)} aria-label="Dismiss">x</button>
			</div>
		{/if}
	</main>

	<div class="capture-bar">
		<label class="ctl">
			<span>Width</span>
			<select bind:value={viewportWidth} disabled={capturing}>
				<option value={1280}>1280 px</option>
				<option value={1440}>1440 px</option>
				<option value={1920}>1920 px</option>
			</select>
		</label>

		<div class="divider"></div>

		<label class="ctl">
			<span>Duration</span>
			<div class="slider">
				<input type="range" min="3" max="30" step="1" bind:value={duration} disabled={capturing} />
				<b>{duration}s</b>
			</div>
		</label>

		<div class="divider"></div>

		<label class="ctl">
			<span>Frame rate</span>
			<select bind:value={fps} disabled={capturing}>
				<option value={30}>30 fps</option>
				<option value={60}>60 fps</option>
			</select>
		</label>

		<div class="divider"></div>

		<label class="ctl">
			<span>Theme</span>
			<select
				value={theme}
				disabled={capturing}
				onchange={(event) => setTheme(event.currentTarget.value as ThemeMode)}
			>
				<option value="system">System</option>
				<option value="light">Light</option>
				<option value="dark">Dark</option>
			</select>
		</label>

		<div class="divider"></div>

		<div class="ctl">
			<span>Scrollbar</span>
			<button
				type="button"
				class="switch"
				class:on={hideScrollbar}
				role="switch"
				aria-checked={hideScrollbar}
				aria-label="Hide preview scrollbar"
				onclick={() => (hideScrollbar = !hideScrollbar)}
			>
				<i></i>
			</button>
		</div>

		<div class="divider"></div>

		<div class="actions">
			<button
				class="btn-capture"
				class:is-capturing={captureState === 'capturing'}
				class:is-success={captureState === 'success'}
				type="button"
				onclick={runCapture}
				disabled={!ready || (captureState === 'idle' && !hasUrl)}
				aria-label={captureState === 'capturing' ? 'Cancel capture' : 'Capture page as MP4'}
			>
				{#if captureState === 'capturing'}
					{percent}%
				{:else if captureState === 'success'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12" />
					</svg>
					Saved
				{:else}
					<span class="dot" aria-hidden="true"></span>
					Capture MP4
				{/if}
			</button>

			<button
				class="btn-image"
				class:is-working={imageState === 'working'}
				class:is-success={imageState === 'success'}
				type="button"
				onclick={runImage}
				disabled={!ready || (imageState === 'idle' && !hasUrl)}
			>
				{#if imageState === 'working'}
					Saving
				{:else if imageState === 'success'}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="20 6 9 17 4 12" />
					</svg>
					Saved
				{:else}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<circle cx="8.5" cy="8.5" r="1.5" />
						<polyline points="21 15 16 10 5 21" />
					</svg>
					Save image
				{/if}
			</button>
		</div>
	</div>
</div>

<style>
	.app {
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-bg);
	}

	/* top bar */

	.bar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 11px var(--space-4);
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		flex: 0 0 auto;
	}

	.nav {
		display: flex;
		gap: 2px;
	}
	.nav button {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--color-text-dim);
		transition:
			background var(--transition),
			color var(--transition);
	}
	.nav svg {
		width: 15px;
		height: 15px;
		display: block;
	}
	.nav button:hover:not(:disabled) {
		background: var(--color-surface-raised);
		color: var(--color-text);
	}
	.nav button:disabled {
		cursor: default;
		opacity: 0.5;
	}

	.urlbar {
		flex: 1 1 auto;
		display: flex;
		align-items: center;
		gap: 9px;
		background: var(--color-surface-raised);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-md);
		padding: 0 var(--space-3);
		min-width: 0;
		height: 34px;
		transition: border-color var(--transition);
	}
	.urlbar:focus-within {
		border-color: var(--color-accent);
	}
	.lock {
		color: var(--color-text-dim);
		display: inline-flex;
		align-items: center;
		flex: 0 0 auto;
	}
	.urlbar input {
		flex: 1 1 auto;
		background: transparent;
		border: none;
		outline: none;
		color: var(--color-text);
		font-size: var(--text-base);
		min-width: 0;
	}
	.urlbar input::placeholder {
		color: var(--color-text-dim);
	}

	.pill {
		background: var(--color-accent);
		color: var(--color-on-accent);
		border: none;
		border-radius: var(--radius-sm);
		padding: 0 15px;
		height: 34px;
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
		transition: background var(--transition);
	}
	.pill:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}
	.pill:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* stage */

	.stage {
		position: relative;
		flex: 1 1 auto;
		overflow-y: auto;
		overflow-x: hidden;
		background: var(--color-bg);
	}

	.stage.hide-scrollbar {
		scrollbar-width: none;
	}
	.stage.hide-scrollbar::-webkit-scrollbar {
		display: none;
	}

	.live {
		display: flex;
		width: 100%;
		height: 100%;
		border: none;
		background: #fff;
	}

	.empty {
		height: 100%;
		min-height: 320px;
		padding-bottom: 96px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--space-3);
		color: var(--color-text-dim);
		font-size: 13.5px;
	}

	/* loading */

	.loading-bar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		overflow: hidden;
		background: color-mix(in srgb, var(--color-accent) 18%, transparent);
		z-index: 12;
	}
	.loading-bar i {
		display: block;
		width: 30%;
		height: 100%;
		background: var(--color-accent);
		animation: sweep 1.1s ease-in-out infinite;
	}
	@keyframes sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(400%);
		}
	}

	/* result */

	.result {
		min-height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 22px;
		padding: var(--space-6) var(--space-6) 110px;
	}

	.player {
		width: 100%;
		max-width: 920px;
		border-radius: var(--radius-xl);
		overflow: hidden;
		background: #000;
		border: 1px solid var(--color-border-strong);
		box-shadow: var(--shadow-player);
	}
	.player video {
		display: block;
		width: 100%;
	}
	.player.is-image {
		background: var(--color-surface);
	}
	.player img {
		display: block;
		margin: 0 auto;
		max-width: 100%;
		max-height: 62vh;
		width: auto;
		height: auto;
	}

	.result-actions {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		background: var(--color-accent);
		color: var(--color-on-accent);
		border: none;
		border-radius: var(--radius-md);
		padding: 10px 18px;
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
		transition: background var(--transition);
	}
	.btn svg {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
	}
	.btn:hover {
		background: var(--color-accent-hover);
	}
	.btn.ghost {
		background: var(--color-surface-raised);
		color: var(--color-text-muted);
		border: 1px solid var(--color-border-strong);
	}
	.btn.ghost:hover {
		background: var(--color-surface);
		color: var(--color-text);
	}

	/* toast */

	.toast {
		position: absolute;
		top: var(--space-4);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: var(--space-3);
		background: var(--color-danger-surface);
		border: 1px solid var(--color-danger-border);
		color: var(--color-danger);
		border-radius: var(--radius-md);
		padding: 10px 14px;
		font-size: var(--text-sm);
		max-width: 70%;
		z-index: 25;
	}
	.toast button {
		background: transparent;
		border: none;
		color: var(--color-danger);
		font-size: var(--text-base);
		line-height: 1;
		opacity: 0.7;
	}
	.toast button:hover {
		opacity: 1;
	}

	/* capture bar */

	.capture-bar {
		position: absolute;
		bottom: var(--space-5);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 14px;
		background: color-mix(in srgb, var(--color-surface) 95%, transparent);
		backdrop-filter: blur(18px);
		border: 1px solid var(--color-border-strong);
		border-radius: var(--radius-lg);
		padding: 11px 13px 11px 18px;
		box-shadow: var(--shadow-float);
		z-index: 20;
	}

	.ctl {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}
	.ctl > span {
		font-size: var(--text-label);
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--color-text-dim);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
	}
	.ctl select {
		background: transparent;
		border: none;
		color: var(--color-text);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		outline: none;
		padding: 0;
		cursor: pointer;
	}
	.ctl select:disabled {
		cursor: default;
		opacity: 0.6;
	}
	.ctl select option {
		background: var(--color-surface);
		color: var(--color-text);
	}

	.slider {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.slider input[type='range'] {
		width: 96px;
		accent-color: var(--color-accent);
		cursor: pointer;
	}
	.slider b {
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		min-width: 30px;
	}

	.divider {
		width: 1px;
		height: 26px;
		background: var(--color-border-strong);
	}

	.switch {
		width: 30px;
		height: 17px;
		border-radius: var(--radius-full);
		background: var(--color-border-strong);
		border: none;
		padding: 0;
		position: relative;
		margin-top: 2px;
		transition: background var(--transition);
	}
	.switch.on {
		background: var(--color-accent);
	}
	.switch i {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 13px;
		height: 13px;
		border-radius: var(--radius-full);
		background: var(--color-text);
		transition:
			transform var(--transition),
			background var(--transition);
	}
	.switch.on i {
		transform: translateX(13px);
		background: var(--color-on-accent);
	}

	.btn-image {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		background: transparent;
		border: 1px solid var(--color-border-strong);
		color: var(--color-text);
		border-radius: var(--radius-md);
		padding: 10px 0;
		width: 132px;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
		overflow: hidden;
		transition:
			background var(--transition),
			color var(--transition),
			border-color var(--transition);
	}
	.btn-image svg {
		width: 14px;
		height: 14px;
		flex: 0 0 auto;
	}
	.btn-image:hover:not(:disabled) {
		background: var(--color-surface-raised);
		border-color: var(--color-text-dim);
	}
	.btn-image.is-working {
		color: var(--color-text);
	}
	.btn-image.is-success {
		color: var(--color-success);
		border-color: color-mix(in srgb, var(--color-success) 55%, transparent);
	}
	.btn-image:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.btn-capture {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		background: var(--color-accent);
		color: var(--color-on-accent);
		border: none;
		border-radius: var(--radius-md);
		padding: 11px 0;
		width: 152px;
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
		overflow: hidden;
		font-variant-numeric: tabular-nums;
		transition:
			background var(--transition),
			width 0.3s var(--ease);
	}
	.btn-capture svg {
		width: 13px;
		height: 13px;
		flex: 0 0 auto;
	}
	.btn-capture:hover:not(:disabled) {
		background: var(--color-accent-hover);
	}

	.btn-capture.is-capturing {
		width: 88px;
		background: var(--color-danger);
	}
	.btn-capture.is-capturing:hover:not(:disabled) {
		background: var(--color-danger-hover);
	}
	.btn-capture.is-success {
		width: 112px;
		background: var(--color-success);
	}
	.btn-capture.is-success:hover:not(:disabled) {
		background: var(--color-success-hover);
	}

	.btn-capture:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.btn-capture .dot {
		width: 7px;
		height: 7px;
		border-radius: var(--radius-full);
		background: var(--color-on-accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-on-accent) 22%, transparent);
	}
</style>
