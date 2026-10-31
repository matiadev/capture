import type { CaptureApi } from './lib/types';

declare global {
	interface Window {
		api?: CaptureApi;
	}
}

export {};
