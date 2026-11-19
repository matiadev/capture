if (process.argv.includes('--mcp')) {
	void import('./mcp.ts');
} else {
	void import('./gui.ts');
}
