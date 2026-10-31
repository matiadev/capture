import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron');

export const XVFB_AVAILABLE = spawnSync('which', ['xvfb-run'], { stdio: 'ignore' }).status === 0;

export const PAGE = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Capture test page</title>
<style>
html, body { margin: 0; }
main { height: 3000px; background: linear-gradient(180deg, #101418, #f0e6c8, #101418); }
</style>
</head>
<body><main></main></body>
</html>`;

export interface PageServer {
	url: string;
	close(): Promise<void>;
}

export async function servePage(html: string): Promise<PageServer> {
	const server = http.createServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		response.end(html);
	});

	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;

	return {
		url: `http://127.0.0.1:${port}/`,
		close: () => new Promise((resolve) => server.close(() => resolve()))
	};
}

export interface AppHandle {
	home: string;
	evaluate<T>(expression: string): Promise<T>;
	close(): Promise<void>;
}

async function freePort(): Promise<number> {
	const server = net.createServer();
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSocket(port: number, log: () => string): Promise<string> {
	const deadline = Date.now() + 30000;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/json/list`);
			const targets = (await response.json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
			const page = targets.find((target) => target.type === 'page' && target.url.startsWith('app://'));
			if (page) return page.webSocketDebuggerUrl;
		} catch {
			// the port is not up yet
		}
		await sleep(250);
	}

	throw new Error(`the window never exposed a devtools target\n${log()}`);
}

export async function startApp(): Promise<AppHandle> {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-test-'));
	const home = path.join(tmp, 'home');
	const profile = path.join(tmp, 'profile');
	fs.mkdirSync(home, { recursive: true });

	const port = await freePort();
	let output = '';

	const child = spawn(
		'xvfb-run',
		[
			'-a',
			ELECTRON,
			'.',
			`--remote-debugging-port=${port}`,
			`--user-data-dir=${profile}`,
			'--disable-gpu'
		],
		{
			cwd: ROOT,
			env: {
				...process.env,
				CAPTURE_PROD: '1',
				HOME: home,
				XDG_CONFIG_HOME: path.join(home, '.config'),
				XDG_CACHE_HOME: path.join(home, '.cache')
			},
			detached: true,
			stdio: ['ignore', 'ignore', 'pipe']
		}
	);

	child.stderr?.on('data', (chunk: Buffer) => {
		output = (output + chunk.toString()).slice(-4000);
	});

	let socket: WebSocket;

	try {
		const socketUrl = await waitForSocket(port, () => output);
		socket = new WebSocket(socketUrl);
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener('open', () => resolve(), { once: true });
			socket.addEventListener('error', () => reject(new Error('devtools socket failed')), { once: true });
		});
	} catch (error) {
		stopGroup(child);
		fs.rmSync(tmp, { recursive: true, force: true });
		throw error;
	}

	let nextId = 0;
	const pending = new Map<number, (message: unknown) => void>();

	socket.addEventListener('message', (event) => {
		const message = JSON.parse(String(event.data)) as { id?: number };
		if (message.id === undefined) return;

		const resolve = pending.get(message.id);
		if (!resolve) return;

		pending.delete(message.id);
		resolve(message);
	});

	const evaluate = async <T>(expression: string): Promise<T> => {
		const id = ++nextId;
		const message = await new Promise<{
			error?: { message: string };
			result?: { exceptionDetails?: { exception?: { description?: string }; text: string }; result?: { value: unknown } };
		}>((resolve) => {
			pending.set(id, resolve as (value: unknown) => void);
			socket.send(
				JSON.stringify({
					id,
					method: 'Runtime.evaluate',
					params: { expression, awaitPromise: true, returnByValue: true }
				})
			);
		});

		if (message.error) throw new Error(message.error.message);

		const details = message.result?.exceptionDetails;
		if (details) throw new Error(details.exception?.description || details.text);

		return message.result?.result?.value as T;
	};

	const deadline = Date.now() + 30000;
	while (Date.now() < deadline) {
		if (await evaluate<boolean>("typeof window.api === 'object'")) break;
		await sleep(200);
	}

	return {
		home,
		evaluate,
		close: async () => {
			socket.close();
			stopGroup(child);
			await exited(child);
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	};
}

function stopGroup(child: ChildProcess): void {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, 'SIGTERM');
	} catch {
		// already gone
	}
}

function exited(child: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		if (child.exitCode !== null) {
			resolve();
			return;
		}

		const timer = setTimeout(() => {
			stopGroup(child);
			child.kill('SIGKILL');
		}, 5000);

		child.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}
