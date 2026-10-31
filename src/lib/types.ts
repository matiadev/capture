export interface CaptureOptions {
	url: string;
	width?: number;
	height?: number;
	duration?: number;
	fps?: number;
}

export interface CaptureProgress {
	progress: number;
}

export interface CaptureResult {
	kind: 'video';
	path: string;
	url: string;
	name: string;
	title: string;
	href: string;
	pageHeight: number;
	width: number;
	height: number;
	duration: number;
	fps: number;
	bytes: number;
}

export interface ImageResult {
	kind: 'image';
	path: string;
	url: string;
	name: string;
	title: string;
	href: string;
	pageHeight: number;
	width: number;
	height: number;
	truncated: boolean;
	bytes: number;
}

export type PageResult = CaptureResult | ImageResult;

export type ThemeMode = 'system' | 'light' | 'dark';

export interface CaptureApi {
	run(options: CaptureOptions): Promise<CaptureResult | { cancelled: true }>;
	cancel(): Promise<boolean>;
	saveImage(options: CaptureOptions): Promise<ImageResult>;
	onProgress(callback: (progress: CaptureProgress) => void): () => void;
	saveAs(filePath: string): Promise<string | null>;
	reveal(filePath: string): Promise<void>;
	setTheme(mode: ThemeMode): Promise<ThemeMode>;
}
