// Shared capture entry point. The GUI, the MCP server, and any future CLI
// all go through here so theme handling and result shape stay in one place.
const { nativeTheme } = require('electron');
const { capture, captureImage } = require('./capture.cjs');

function applyTheme(theme) {
	if (theme === 'light' || theme === 'dark' || theme === 'system') {
		nativeTheme.themeSource = theme;
	}
}

function withUrl(result) {
	return { ...result, url: `capture://media/${encodeURIComponent(result.name)}` };
}

async function renderVideo(options = {}, onProgress, signal) {
	applyTheme(options.theme);
	return withUrl(await capture(options, onProgress, signal));
}

async function renderImage(options = {}) {
	applyTheme(options.theme);
	return withUrl(await captureImage(options));
}

module.exports = { renderVideo, renderImage };
