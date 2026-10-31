import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import type { CaptureResult, ImageResult } from '../src/lib/types.ts';
import { PAGE, servePage, startApp, XVFB_AVAILABLE, type AppHandle, type PageServer } from './helpers/app.ts';

const requireModule = createRequire(import.meta.url);
const BINARY = requireModule('ffmpeg-static') as string;
const SKIP = XVFB_AVAILABLE ? false : 'xvfb-run is not installed';

let app: AppHandle;
let server: PageServer;
let videos: string;

before(async () => {
	if (!XVFB_AVAILABLE) return;

	server = await servePage(PAGE);
	app = await startApp();
	videos = path.join(app.home, 'Videos');
});

after(async () => {
	if (!XVFB_AVAILABLE) return;

	await app?.close();
	await server?.close();
});

function run(args: string[]): Promise<{ code: number | null; output: string }> {
	return new Promise((resolve) => {
		const child = spawn(BINARY, args);
		let output = '';
		child.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on('close', (code) => resolve({ code, output }));
	});
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function listVideos(): string[] {
	if (!fs.existsSync(videos)) return [];
	return fs.readdirSync(videos).filter((name) => name.endsWith('.mp4'));
}

test('records a page to a playable mp4', { timeout: 120_000, skip: SKIP }, async () => {
	const outcome = await app.evaluate<{ result: CaptureResult; seen: number[] }>(`(async () => {
		const seen = [];
		window.api.onProgress((update) => seen.push(update.progress));
		const result = await window.api.run(${JSON.stringify({
			url: server.url,
			width: 800,
			height: 600,
			duration: 3,
			fps: 30
		})});
		return { result, seen };
	})()`);

	const { result, seen } = outcome;

	assert.equal(result.kind, 'video');
	assert.match(result.name, /^127\.0\.0\.1-\d{6}\.mp4$/);
	assert.equal(result.width, 800);
	assert.equal(result.height, 600);
	assert.equal(result.fps, 30);
	assert.ok(Math.abs(result.duration - 3) < 0.01);
	assert.ok(result.path.startsWith(app.home), `wrote outside the test home: ${result.path}`);
	assert.ok(fs.existsSync(result.path));
	assert.equal(fs.statSync(result.path).size, result.bytes);
	assert.ok(result.bytes > 20_000, `only ${result.bytes} bytes`);
	assert.ok(seen.length > 1);
	assert.equal(seen.at(-1), 1);

	const probe = await run(['-hide_banner', '-i', result.path, '-f', 'null', '-']);
	assert.equal(probe.code, 0, probe.output);

	const dimensions = probe.output.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
	assert.ok(dimensions, probe.output);
	assert.equal(Number(dimensions[1]), 800);
	assert.equal(Number(dimensions[2]), 600);

	const time = probe.output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
	assert.ok(time, probe.output);
	const seconds = Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3]);
	assert.ok(Math.abs(seconds - 3) < 0.2, `video is ${seconds}s`);
});

test('saves the whole page as a png', { timeout: 120_000, skip: SKIP }, async () => {
	const result = await app.evaluate<ImageResult>(`window.api.saveImage(${JSON.stringify({
		url: server.url,
		width: 800,
		height: 600
	})})`);

	assert.equal(result.kind, 'image');
	assert.match(result.name, /^127\.0\.0\.1-\d{6}\.png$/);
	assert.ok(result.path.startsWith(app.home), `wrote outside the test home: ${result.path}`);
	assert.equal(result.truncated, false);

	const bytes = fs.readFileSync(result.path);
	assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
	assert.equal(bytes.readUInt32BE(16), 800);
	assert.equal(bytes.readUInt32BE(20), result.height);
	assert.ok(result.height > 2400, `image is only ${result.height}px tall`);
	assert.equal(result.bytes, bytes.length);
});

test('cancels a run without leaving a file', { timeout: 120_000, skip: SKIP }, async () => {
	const before = listVideos();

	const outcome = await app.evaluate<{ cancelled: true }>(`(async () => {
		const running = window.api.run(${JSON.stringify({
			url: server.url,
			width: 640,
			height: 480,
			duration: 12,
			fps: 60
		})});
		setTimeout(() => window.api.cancel(), 1200);
		return running;
	})()`);

	assert.deepEqual(outcome, { cancelled: true });

	await sleep(600);
	assert.deepEqual(listVideos(), before);
});
