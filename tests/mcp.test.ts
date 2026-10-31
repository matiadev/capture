import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { test } from 'node:test';
import { PAGE, servePage, XVFB_AVAILABLE } from './helpers/app.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const ELECTRON = path.join(ROOT, 'node_modules', '.bin', 'electron');
const SKIP = XVFB_AVAILABLE ? false : 'xvfb-run is not installed';

interface McpClient {
	request(method: string, params: unknown): Promise<Record<string, unknown>>;
	notify(method: string, params: unknown): void;
	close(): Promise<void>;
}

async function startMcp(): Promise<{ client: McpClient; home: string }> {
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-mcp-test-'));
	const child = spawn('xvfb-run', ['-a', ELECTRON, '.', '--mcp', '--disable-gpu'], {
		cwd: ROOT,
		env: {
			...process.env,
			HOME: home,
			XDG_CONFIG_HOME: path.join(home, '.config'),
			XDG_CACHE_HOME: path.join(home, '.cache')
		},
		detached: true,
		stdio: ['pipe', 'pipe', 'pipe']
	});

	let nextId = 0;
	const pending = new Map<number, (message: Record<string, unknown>) => void>();

	readline.createInterface({ input: child.stdout! }).on('line', (line) => {
		let message: { id?: number };
		try {
			message = JSON.parse(line) as { id?: number };
		} catch {
			return;
		}

		if (message.id === undefined) return;

		const resolve = pending.get(message.id);
		if (!resolve) return;

		pending.delete(message.id);
		resolve(message as Record<string, unknown>);
	});

	const client: McpClient = {
		request: (method, params) => {
			const id = ++nextId;
			return new Promise((resolve) => {
				pending.set(id, resolve);
				child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
			});
		},
		notify: (method, params) => {
			child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
		},
		close: async () => {
			if (!child.pid) return;

			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {
				// already gone
			}

			await new Promise<void>((resolve) => {
				if (child.exitCode !== null) {
					resolve();
					return;
				}

				const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
				child.once('exit', () => {
					clearTimeout(timer);
					resolve();
				});
			});

			fs.rmSync(home, { recursive: true, force: true });
		}
	};

	return { client, home };
}

test('serves captures over mcp', { timeout: 180_000, skip: SKIP }, async () => {
	const server = await servePage(PAGE);
	const { client, home } = await startMcp();

	try {
		const init = await client.request('initialize', {
			protocolVersion: '2025-06-18',
			capabilities: {},
			clientInfo: { name: 'capture-tests', version: '1.0.0' }
		});

		const info = init.result as { serverInfo: { name: string } };
		assert.equal(info.serverInfo.name, 'capture');

		client.notify('notifications/initialized', {});

		const list = (await client.request('tools/list', {})).result as {
			tools: Array<{ name: string }>;
		};
		assert.deepEqual(
			list.tools.map((tool) => tool.name).sort(),
			['capture_image', 'capture_video']
		);

		const call = await client.request('tools/call', {
			name: 'capture_image',
			arguments: { url: server.url, width: 800 }
		});

		const content = (call.result as { content: Array<{ type: string; text?: string; data?: string }> })
			.content;
		const text = content[0]?.text ?? '';
		const match = text.match(/^Saved (.+?) \((\d+)x(\d+)\) to (.+)$/);
		assert.ok(match, text);

		const [, name, width, height, file] = match;
		assert.match(name, /^127\.0\.0\.1-\d{6}\.png$/);
		assert.equal(Number(width), 800);
		assert.ok(Number(height) > 2400);
		assert.ok(file.startsWith(home), `wrote outside the test home: ${file}`);

		const bytes = fs.readFileSync(file);
		assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

		const preview = content[1];
		assert.equal(preview?.type, 'image');
		const previewBytes = Buffer.from(preview.data ?? '', 'base64');
		assert.deepEqual([...previewBytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
	} finally {
		await client.close();
		await server.close();
	}
});
