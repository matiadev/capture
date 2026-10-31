import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Writable } from 'node:stream';
import { BrowserWindow, app } from 'electron';
import type { CaptureOptions, CaptureResult, ImageResult } from '../src/lib/types.ts';

const requireModule = createRequire(import.meta.url);

let ffmpegCache: string | null = null;

function resolveFfmpeg(): string {
	if (ffmpegCache) return ffmpegCache;

	let candidate: string | null = null;
	try {
		candidate = requireModule('ffmpeg-static') as string;
	} catch {
		candidate = null;
	}

	if (candidate) {
		// packaged builds keep the binary outside the asar archive
		const unpacked = candidate.replace('app.asar', 'app.asar.unpacked');
		if (fs.existsSync(unpacked)) {
			ffmpegCache = unpacked;
			return unpacked;
		}
		if (fs.existsSync(candidate)) {
			ffmpegCache = candidate;
			return candidate;
		}
	}

	ffmpegCache = 'ffmpeg';
	return ffmpegCache;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const easeInOutCubic = (t: number): number =>
	t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function capturesDir(): string {
	const dir = app.getPath('videos');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function slugify(input: string): string {
	const base = String(input || 'page')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');

	if (!base) return 'page';
	if (base.length <= 16) return base;

	// trim to a word boundary so names stay readable
	const cut = base.slice(0, 16);
	const lastDash = cut.lastIndexOf('-');
	return (lastDash > 8 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
}

// site name only, github-175134.mp4
function fileBase(href: string, title: string): string {
	if (!URL.canParse(href)) return slugify(title);

	const host = new URL(href).hostname.replace(/^www\./, '');
	if (!host) return slugify(title);

	// keep IP addresses whole, otherwise drop the domain
	const isIp = /^\d+(\.\d+){3}$/.test(host);
	const site = isIp ? host : host.split('.')[0];
	return site.replace(/[^a-zA-Z0-9.-]/g, '');
}

function timestamp(): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function uniquePath(dir: string, base: string, extension: string): string {
	let candidate = path.join(dir, `${base}${extension}`);
	let counter = 2;

	while (fs.existsSync(candidate)) {
		candidate = path.join(dir, `${base}-${counter}${extension}`);
		counter += 1;
	}

	return candidate;
}

// scrolls once so lazy content loads, then measures
const PREPARE = `(async () => {
	const doc = document.documentElement;
	const previous = doc.style.scrollBehavior;
	doc.style.scrollBehavior = 'auto';

	const measure = () => Math.max(
		doc.scrollHeight,
		document.body ? document.body.scrollHeight : 0
	);

	const step = Math.max(200, Math.floor(window.innerHeight * 0.85));
	const limit = 40000;
	for (let y = 0; y < Math.min(measure(), limit); y += step) {
		window.scrollTo(0, y);
		await new Promise((r) => setTimeout(r, 90));
	}
	window.scrollTo(0, 0);
	await new Promise((r) => setTimeout(r, 200));

	const pending = Array.from(document.images).filter((img) => !img.complete);
	await Promise.all(pending.map((img) => new Promise((resolve) => {
		img.addEventListener('load', resolve, { once: true });
		img.addEventListener('error', resolve, { once: true });
		setTimeout(resolve, 4000);
	})));

	try { await document.fonts.ready; } catch {}
	doc.style.scrollBehavior = previous;

	return {
		title: document.title || location.hostname,
		href: location.href,
		height: measure(),
		viewportWidth: window.innerWidth,
		viewportHeight: window.innerHeight
	};
})()`;

// re-injected after a reload, the style dies with the document
const CLEAN_CSS = `(() => {
	if (document.getElementById('__capture_clean')) return true;
	const style = document.createElement('style');
	style.id = '__capture_clean';
	style.textContent =
		'::-webkit-scrollbar{display:none!important;width:0!important;height:0!important}' +
		'html{scrollbar-width:none!important;-ms-overflow-style:none!important}';
	document.head.appendChild(style);
	return true;
})()`;

const MEASURE = `(async () => {
	try { await document.fonts.ready; } catch {}
	const doc = document.documentElement;
	return {
		title: document.title || location.hostname,
		height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0),
		viewportHeight: window.innerHeight
	};
})()`;

// reload restarts entry animations the warm-up scroll already played
function reloadAndWait(win: BrowserWindow, timeoutMs = 15000): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;

		const finish = (error?: Error): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			win.webContents.removeListener('did-finish-load', onLoad);
			win.webContents.removeListener('did-fail-load', onFail);
			if (error) reject(error);
			else resolve();
		};

		const onLoad = () => finish();
		const onFail = (
			_event: Electron.Event,
			code: number,
			description: string,
			_url: string,
			isMainFrame: boolean
		): void => {
			if (isMainFrame === false) return;
			finish(new Error(description || `Reload failed (${code})`));
		};

		const timer = setTimeout(() => finish(), timeoutMs);

		win.webContents.once('did-finish-load', onLoad);
		win.webContents.on('did-fail-load', onFail);
		win.webContents.reload();
	});
}

function scrollScript(y: number): string {
	return `(async () => {
		window.scrollTo({ top: ${y}, behavior: 'instant' });
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	})()`;
}

interface OpenPageOptions {
	url: string;
	width: number;
	height: number;
}

async function openPage({ url, width, height }: OpenPageOptions): Promise<BrowserWindow> {
	const win = new BrowserWindow({
		width,
		height,
		useContentSize: true,
		show: false,
		backgroundColor: '#ffffff',
		webPreferences: {
			// same partition as the preview, no persist prefix so it clears on exit
			partition: 'capture',
			offscreen: true,
			backgroundThrottling: false,
			contextIsolation: true,
			nodeIntegration: false,
			webSecurity: true
		}
	});

	win.webContents.setFrameRate(60);

	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			await win.loadURL(url);
			return win;
		} catch (error) {
			lastError = error;
			await sleep(400);
		}
	}

	win.destroy();
	throw lastError;
}

function cancelledError(): Error {
	const error = new Error('Capture cancelled');
	error.name = 'AbortError';
	return error;
}

type ProgressCallback = (progress: { progress: number }) => void;

async function capture(
	{ url, width = 1440, height = 900, duration = 10, fps = 60 }: CaptureOptions,
	onProgress: ProgressCallback = () => {},
	signal?: AbortSignal
): Promise<Omit<CaptureResult, 'url'>> {
	const win = await openPage({ url, width, height });
	const frames = Math.max(2, Math.round(duration * fps));

	let outPath: string | null = null;
	let ffmpeg: ChildProcess | null = null;
	let ffmpegIn: Writable | null = null;
	let done: Promise<void> | null = null;

	try {
		if (signal?.aborted) throw cancelledError();

		onProgress({ progress: 0 });
		const info = await win.webContents.executeJavaScript(PREPARE, true);

		await reloadAndWait(win);
		await win.webContents.executeJavaScript(CLEAN_CSS, true);

		const fresh = await win.webContents.executeJavaScript(MEASURE, true);

		const pageHeight = fresh.height || info.height;
		const viewportHeight = fresh.viewportHeight || info.viewportHeight;
		const maxScroll = Math.max(0, pageHeight - viewportHeight);
		const name = `${fileBase(info.href, fresh.title || info.title)}-${timestamp()}`;
		outPath = uniquePath(capturesDir(), name, '.mp4');
		const fileName = path.basename(outPath);

		onProgress({ progress: 0 });

		for (let i = 0; i < frames; i++) {
			if (signal?.aborted) throw cancelledError();

			const t = frames === 1 ? 1 : i / (frames - 1);
			const y = Math.round(easeInOutCubic(t) * maxScroll);

			await win.webContents.executeJavaScript(scrollScript(y), true);

			const image = await win.webContents.capturePage();

			// PNG keeps the intermediate lossless, encoding is not the bottleneck
			const png = image.toPNG();

			if (!ffmpeg) {
				ffmpeg = spawn(resolveFfmpeg(), [
					'-y',
					'-loglevel', 'error',
					'-f', 'image2pipe',
					'-framerate', String(fps),
					'-i', '-',
					'-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
					'-c:v', 'libx264',
					'-preset', 'veryfast',
					'-crf', '18',
					'-pix_fmt', 'yuv420p',
					'-movflags', '+faststart',
					outPath
				]);

				if (!ffmpeg.stdin || !ffmpeg.stderr) {
					throw new Error('ffmpeg pipes unavailable');
				}

				ffmpegIn = ffmpeg.stdin;
				let ffmpegError = '';
				ffmpeg.stderr.on('data', (d: Buffer) => {
					ffmpegError += d.toString();
				});

				const encoder = ffmpeg;
				done = new Promise<void>((resolve, reject) => {
					encoder.on('error', reject);
					encoder.on('close', (code: number | null) =>
						code === 0
							? resolve()
							: reject(new Error(ffmpegError || `ffmpeg exited with ${code}`))
					);
				});

				// we may abort before awaiting this, so keep the rejection handled
				done.catch(() => {});
			}

			const out = ffmpegIn;
			if (!out) throw new Error('ffmpeg stdin unavailable');
			if (!out.write(png)) {
				await new Promise((resolve) => out.once('drain', resolve));
			}

			if (i % 5 === 0 || i === frames - 1) {
				onProgress({ progress: (i + 1) / frames });
			}
		}

		if (!ffmpegIn || !done) throw new Error('encoder never started');
		ffmpegIn.end();
		await done;

		const stat = fs.statSync(outPath);

		return {
			kind: 'video',
			path: outPath,
			name: fileName,
			title: fresh.title || info.title,
			href: info.href,
			pageHeight,
			width,
			height,
			duration: frames / fps,
			fps,
			bytes: stat.size
		};
	} catch (error) {
		if (ffmpeg) {
			try {
				ffmpeg.kill('SIGKILL');
			} catch {
			}
		}
		if (outPath) {
			try {
				fs.unlinkSync(outPath);
			} catch {
			}
		}
		throw error;
	} finally {
		win.destroy();
	}
}

// Chromium caps a surface near 16384px, so the full-page shot is capped too
const MAX_IMAGE_HEIGHT = 16000;

async function captureImage({
	url,
	width = 1440,
	height = 900
}: CaptureOptions): Promise<Omit<ImageResult, 'url'>> {
	const win = await openPage({ url, width, height });

	try {
		const info = await win.webContents.executeJavaScript(PREPARE, true);
		await win.webContents.executeJavaScript(CLEAN_CSS, true);

		const fullHeight = Math.min(info.height, MAX_IMAGE_HEIGHT);

		win.setContentSize(width, fullHeight);
		await sleep(600);

		let image = await win.webContents.capturePage();
		let size = image.getSize();

		// some pages ignore the resize, fall back to the viewport
		if (size.height < 50) {
			win.setContentSize(width, height);
			await sleep(300);
			image = await win.webContents.capturePage();
			size = image.getSize();
		}

		const name = `${fileBase(info.href, info.title)}-${timestamp()}`;
		const outPath = uniquePath(capturesDir(), name, '.png');
		fs.writeFileSync(outPath, image.toPNG());

		return {
			kind: 'image',
			path: outPath,
			name: path.basename(outPath),
			title: info.title,
			href: info.href,
			pageHeight: info.height,
			width: size.width,
			height: size.height,
			truncated: info.height > MAX_IMAGE_HEIGHT,
			bytes: fs.statSync(outPath).size
		};
	} finally {
		win.destroy();
	}
}

export { capture, captureImage, capturesDir };
