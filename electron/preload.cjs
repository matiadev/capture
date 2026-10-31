const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
	run: (options) => ipcRenderer.invoke('capture:run', options),
	cancel: () => ipcRenderer.invoke('capture:cancel'),
	saveImage: (options) => ipcRenderer.invoke('capture:image', options),
	setTheme: (mode) => ipcRenderer.invoke('theme:set', mode),
	onProgress: (callback) => {
		const handler = (_event, data) => callback(data);
		ipcRenderer.on('capture:progress', handler);
		return () => ipcRenderer.removeListener('capture:progress', handler);
	},
	saveAs: (filePath) => ipcRenderer.invoke('capture:save-as', filePath),
	reveal: (filePath) => ipcRenderer.invoke('capture:reveal', filePath)
});
