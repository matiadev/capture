const { app, nativeImage } = require('electron');
const path = require('node:path');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const { renderVideo, renderImage } = require('./api.cjs');

// A separate profile so this can run alongside the GUI without both processes
// fighting over the same Chromium user data directory.
app.setPath('userData', path.join(app.getPath('appData'), 'Capture-mcp'));

// stdout carries the protocol, so every log line goes to stderr.
const log = (message) => process.stderr.write(`[capture-mcp] ${message}\n`);

const MAX_PREVIEW_HEIGHT = 1600;

// Full-page captures can be huge, so the model gets a scaled preview, not the original.
function previewBlock(filePath) {
	try {
		const image = nativeImage.createFromPath(filePath);
		if (image.isEmpty()) return [];

		const { height } = image.getSize();
		const scaled = height > MAX_PREVIEW_HEIGHT ? image.resize({ height: MAX_PREVIEW_HEIGHT }) : image;

		return [{ type: 'image', data: scaled.toPNG().toString('base64'), mimeType: 'image/png' }];
	} catch {
		return [];
	}
}

app.whenReady().then(async () => {
	const server = new McpServer({ name: 'capture', version: '1.0.0' });

	server.registerTool(
		'capture_video',
		{
			title: 'Capture page as video',
			description:
				'Render a web page as an MP4 by scrolling it from top to bottom, then save it to the Videos folder. Use for demo clips or visual documentation of a page.',
			inputSchema: {
				url: z.string().describe('Page address, for example https://example.com'),
				width: z.number().int().min(320).max(3840).optional().describe('Viewport width in pixels. Default 1440.'),
				duration: z.number().min(1).max(60).optional().describe('Video length in seconds. Default 10.'),
				fps: z.number().int().min(10).max(60).optional().describe('Frame rate. Default 60.'),
				theme: z
					.enum(['system', 'light', 'dark'])
					.optional()
					.describe('Colour scheme to render the page in. Default system.')
			}
		},
		async ({ url, width, duration, fps, theme }) => {
			const result = await renderVideo({ url, width, duration, fps, theme });

			return {
				content: [
					{
						type: 'text',
						text: `Saved ${result.name} (${result.width}x${result.height}, ${result.duration}s) to ${result.path}`
					}
				]
			};
		}
	);

	server.registerTool(
		'capture_image',
		{
			title: 'Capture page as image',
			description:
				'Save the entire scrollable page as a PNG, and return a preview of it. Use to inspect how a page looks without scrolling it yourself.',
			inputSchema: {
				url: z.string().describe('Page address, for example https://example.com'),
				width: z.number().int().min(320).max(3840).optional().describe('Viewport width in pixels. Default 1440.'),
				theme: z
					.enum(['system', 'light', 'dark'])
					.optional()
					.describe('Colour scheme to render the page in. Default system.')
			}
		},
		async ({ url, width, theme }) => {
			const result = await renderImage({ url, width, theme });

			return {
				content: [
					{
						type: 'text',
						text: `Saved ${result.name} (${result.width}x${result.height}) to ${result.path}`
					},
					...previewBlock(result.path)
				]
			};
		}
	);

	await server.connect(new StdioServerTransport());
	log('ready');
});

process.on('uncaughtException', (error) => {
	log(`uncaught: ${error?.stack || error}`);
});

// The capture window is transient. Without this, Electron's default behaviour
// quits the app once it is destroyed, killing the server after one call.
app.on('window-all-closed', () => {
	/* keep the MCP server alive */
});
