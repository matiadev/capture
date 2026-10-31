// Entry point, --mcp runs the MCP server, anything else opens the app
if (process.argv.includes('--mcp')) {
	void import('./mcp.ts');
} else {
	void import('./gui.ts');
}
