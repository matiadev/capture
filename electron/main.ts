// entry point, --mcp runs the server, anything else opens the app
if (process.argv.includes('--mcp')) {
	void import('./mcp.ts');
} else {
	void import('./gui.ts');
}
