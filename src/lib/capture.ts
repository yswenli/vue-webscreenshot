export function isCaptureSupported(): boolean {
	return typeof navigator !== 'undefined' && !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function';
}

/**
 * 抓取一帧屏幕静帧。
 * 必须在用户手势的调用栈内直接调用（前面不能有 await），否则浏览器会因失去用户激活而拒绝。
 */
export async function captureScreen(): Promise<HTMLCanvasElement> {
	const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
	try {
		const video = document.createElement('video');
		video.muted = true;
		video.playsInline = true;
		video.srcObject = stream;
		await video.play();
		await waitFirstFrame(video);
		const width = video.videoWidth;
		const height = video.videoHeight;
		if (!width || !height) throw new Error('未能获取屏幕画面');
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('当前浏览器不支持 Canvas 2D');
		ctx.drawImage(video, 0, 0, width, height);
		return canvas;
	} finally {
		stream.getTracks().forEach((track) => track.stop());
	}
}

function waitFirstFrame(video: HTMLVideoElement): Promise<void> {
	return new Promise<void>((resolve) => {
		if (video.readyState >= 2 && video.videoWidth > 0) {
			resolve();
			return;
		}
		let settled = false;
		const finish = (): void => {
			if (settled) return;
			settled = true;
			resolve();
		};
		video.addEventListener('loadeddata', finish, { once: true });
		const withCallback = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
		if (typeof withCallback.requestVideoFrameCallback === 'function') {
			withCallback.requestVideoFrameCallback(() => finish());
		}
		window.setTimeout(finish, 1200);
	});
}