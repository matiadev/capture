// Shared capture entry point for the GUI and the MCP server
import { nativeTheme } from 'electron';
import { capture, captureImage } from './capture.ts';
import type { CaptureOptions, CaptureResult, ImageResult } from '../src/lib/types.ts';

export type { CaptureOptions, CaptureResult, ImageResult };

export type ThemeMode = 'system' | 'light' | 'dark';

interface CaptureCallOptions extends CaptureOptions {
	theme?: ThemeMode;
}

function applyTheme(theme?: ThemeMode): void {
	if (theme === 'light' || theme === 'dark' || theme === 'system') {
		nativeTheme.themeSource = theme;
	}
}

function withUrl<T extends { name: string }>(result: T): T & { url: string } {
	return { ...result, url: `capture://media/${encodeURIComponent(result.name)}` };
}

export async function renderVideo(
	options: CaptureCallOptions = {} as CaptureCallOptions,
	onProgress?: (progress: { progress: number }) => void,
	signal?: AbortSignal
): Promise<CaptureResult & { url: string }> {
	applyTheme(options.theme);
	return withUrl(await capture(options, onProgress, signal));
}

export async function renderImage(
	options: CaptureCallOptions = {} as CaptureCallOptions
): Promise<ImageResult & { url: string }> {
	applyTheme(options.theme);
	return withUrl(await captureImage(options));
}
