import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
import { renderVideo, renderImage } from './api.ts';
import { capturesDir } from './capture.ts';

const isDev = !app.isPackaged && process.env.CAPTURE_PROD !== '1';
const DEV_URL = process.env.CAPTURE_DEV_URL || 'http://127.0.0.1:5173';
const BUILD_DIR = path.join(import.meta.dirname, '..', 'build');

// no window menu, macOS still needs one in the system bar
if (process.platform === 'darwin') {
	Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }]));
} else {
	Menu.setApplicationMenu(null);
}

// two instances would fight over the same user data directory
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;

app.on('second-instance', () => {
	if (!mainWindow) return;
	if (mainWindow.isMinimized()) mainWindow.restore();
	mainWindow.focus();
});

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
	{ scheme: 'capture', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

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

	// no menu means no accelerators, so wire quit manually
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

app.whenReady().then(() => {
	if (!gotLock) return;

	nativeTheme.themeSource = 'system';

	// serves the built UI, absolute paths resolve against the app origin
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

	// serves finished videos with range requests so the player can seek
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
