import {
	app,
	BrowserWindow,
	Menu,
	ipcMain,
	protocol,
	net,
	dialog,
	shell,
	nativeTheme
} from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { capturesDir } from './capture.ts';
import { renderVideo, renderImage } from './api.ts';

const isDev = !app.isPackaged && process.env.CAPTURE_PROD !== '1';
const DEV_URL = process.env.CAPTURE_DEV_URL || 'http://127.0.0.1:5173';
const BUILD_DIR = path.join(import.meta.dirname, '..', 'build');

// No application menu: the window is just the capture UI.
// macOS still needs one for standard shortcuts, but it lives in the system bar.
if (process.platform === 'darwin') {
	Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
} else {
	Menu.setApplicationMenu(null);
}

// Two instances would fight over the same user data directory.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
});

/* ---------- local protocols ---------- */

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
	{ scheme: 'capture', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

/* ---------- main window ---------- */

function createWindow(): void {
	const win = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 960,
		minHeight: 640,
		backgroundColor: '#0a0a0a',
		show: false,
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(import.meta.dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			webviewTag: true
		}
	});

	mainWindow = win;

	win.once('ready-to-show', () => win.show());

	// With no application menu there are no default accelerators, so wire quit manually.
	win.webContents.on('before-input-event', (event, input) => {
		const accel = process.platform === 'darwin' ? input.meta : input.control;
		if (accel && !input.alt && !input.shift && input.key.toLowerCase() === 'q') {
			event.preventDefault();
			app.quit();
		}
	});

	if (isDev) {
		win.loadURL(DEV_URL);
	} else {
		win.loadURL('app://bundle/');
	}

	win.on('closed', () => {
		mainWindow = null;
	});
}

/* ---------- ipc ---------- */

let activeCapture: AbortController | null = null;

ipcMain.handle('capture:run', async (event, options) => {
	const controller = new AbortController();
	activeCapture = controller;

	try {
		return await renderVideo(
			options,
			(progress) => {
				if (!event.sender.isDestroyed()) {
					event.sender.send('capture:progress', progress);
				}
			},
			controller.signal
		);
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') return { cancelled: true };
		throw error;
	} finally {
		activeCapture = null;
	}
});

ipcMain.handle('capture:cancel', () => {
	activeCapture?.abort();
	return true;
});

ipcMain.handle('capture:image', async (_event, options) => {
	return renderImage(options);
});

// Drives prefers-color-scheme for both the preview and the capture window.
ipcMain.handle('theme:set', (_event, mode) => {
	if (mode === 'light' || mode === 'dark' || mode === 'system') {
		nativeTheme.themeSource = mode;
	}
	return nativeTheme.themeSource;
});

ipcMain.handle('capture:save-as', async (_event, filePath: string) => {
	if (!mainWindow) return null;

	const isImage = path.extname(filePath).toLowerCase() === '.png';

	const { canceled, filePath: target } = await dialog.showSaveDialog(mainWindow, {
		title: isImage ? 'Save image' : 'Save video',
		defaultPath: path.join(app.getPath('videos'), path.basename(filePath)),
		filters: [
			isImage
				? { name: 'PNG image', extensions: ['png'] }
				: { name: 'MP4 video', extensions: ['mp4'] }
		]
	});

	if (canceled || !target) return null;

	fs.copyFileSync(filePath, target);
	return target;
});

ipcMain.handle('capture:reveal', async (_event, filePath) => {
	shell.showItemInFolder(filePath);
});

/* ---------- lifecycle ---------- */

app.whenReady().then(() => {
	if (!gotLock) return;

	// Pages follow the system preference until the Theme selector overrides it.
	nativeTheme.themeSource = 'system';

	// Serves the built UI. Absolute asset paths resolve against the app:// origin.
	protocol.handle('app', (request) => {
		let pathname = decodeURIComponent(new URL(request.url).pathname);
		if (!pathname || pathname === '/') pathname = '/index.html';

		const target = path.normalize(path.join(BUILD_DIR, pathname));
		const fallback = path.join(BUILD_DIR, 'index.html');

		if (!target.startsWith(BUILD_DIR)) {
			return new Response('Forbidden', { status: 403 });
		}

		if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
			return net.fetch(pathToFileURL(fallback).toString());
		}

		return net.fetch(pathToFileURL(target).toString());
	});

	// Serves finished videos, with range requests so the player can seek.
	protocol.handle('capture', (request) => {
		const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
		const file = path.join(capturesDir(), path.basename(name));

		if (!fs.existsSync(file)) {
			return new Response('Not found', { status: 404 });
		}

		return net.fetch(pathToFileURL(file).toString());
	});

	createWindow();

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit();
});
