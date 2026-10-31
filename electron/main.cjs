// Entry point. `--mcp` runs the MCP server, anything else opens the app.
if (process.argv.includes('--mcp')) {
	require('./mcp.cjs');
} else {
	require('./gui.cjs');
}
