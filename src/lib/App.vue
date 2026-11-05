<template>
	<Teleport to="body">
		<div
			v-if="state.visible"
			class="vws-root"
			:class="{ 'is-tool': !!state.tool, 'is-selecting': state.stage === 'selection' }"
			:style="{ zIndex: String(props.zIndex) }"
			@contextmenu.prevent
			@pointerdown="onPointerDown"
			@pointermove="onPointerMove"
			@pointerup="onPointerUp"
			@pointercancel="onPointerUp"
		>
			<canvas ref="canvasRef" class="vws-canvas" />
			<div v-if="sizeLabel" class="vws-size" :style="sizeLabelStyle">{{ sizeLabel }}</div>
			<textarea
				v-if="state.textEditing"
				ref="textInputRef"
				v-model="state.textValue"
				class="vws-text"
				:style="textInputStyle"
				rows="1"
				spellcheck="false"
				placeholder="输入文字"
				@pointerdown.stop
				@input="syncTextSize"
				@keydown="onTextKeyDown"
				@blur="commitText"
			/>
			<Toolbar
				v-if="state.sel && state.stage === 'annotate'"
				:model-value="state.tool"
				:width="state.width"
				:widths="widths"
				:font-sizes="fontSizes"
				:color="state.color"
				:anchor="state.sel"
				:can-undo="state.ops.length > 0"
				@update:model-value="onToolChange"
				@update:width="onWidthChange"
				@update:color="onColorChange"
				@undo="undo"
				@download="onDownload"
				@cancel="cancel"
				@confirm="onConfirm"
			/>
			<div v-if="state.toast" class="vws-toast">{{ state.toast }}</div>
		</div>
	</Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import Toolbar from './toolbar.vue';
import { captureScreen, isCaptureSupported } from './capture';
import { drawOps, normalizeRect, renderSelection, TEXT_FONT_FAMILY, TEXT_FONT_SIZE, TEXT_LINE_HEIGHT_RATIO } from './annotation';
import type { AnnotationOp, Point, Rect, ToolType } from './annotation';

const COLORS = ['#ff4d4f', '#ffd400', '#22c55e', '#1677ff', '#111111', '#ffffff'];
/** 文字字号档位，单位 CSS 像素 */
const FONT_SIZES = [12, 16, 20];
/** 输入框内容内边距（与 .vws-text 的 padding 保持一致） */
const TEXT_PAD_X = 4;
const TEXT_PAD_Y = 2;
/** 输入框最大宽度 */
const TEXT_MAX_WIDTH = 320;
/** 输入框最小宽度 */
const TEXT_MIN_WIDTH = 120;

/** 输入框行高，与画布换行步进一致 */
function textLineHeight(size: number): number {
	return size * TEXT_LINE_HEIGHT_RATIO;
}

const props = withDefaults(
	defineProps<{
		show: boolean;
		zIndex?: number;
		fileName?: string;
		/** 授权通过后到取帧的等待时间（毫秒），避开共享授权框关闭时的残影 */
		captureDelay?: number;
	}>(),
	{
		zIndex: 3000,
		fileName: '网页截图',
		captureDelay: 1000
	}
);

const emit = defineEmits<{
	(e: 'update:show', value: boolean): void;
	(e: 'success', payload: { mode: 'clipboard' | 'download'; blob: Blob }): void;
	(e: 'download', payload: { blob: Blob }): void;
	(e: 'cancel'): void;
	(e: 'error', payload: { stage: 'unsupported' | 'capture' | 'clipboard'; message: string }): void;
}>();

interface ShotState {
	visible: boolean;
	capturing: boolean;
	stage: 'selection' | 'annotate';
	display: Rect;
	sel: Rect | null;
	ops: AnnotationOp[];
	draft: AnnotationOp | null;
	tool: ToolType | null;
	width: number;
	color: string;
	textEditing: boolean;
	textValue: string;
	/** 文字锚点，静帧像素；CSS 坐标由它换算，窗口尺寸变化时自动跟随 */
	textFrameAt: Point;
	/** 输入框当前高度，用于边界夹紧 */
	textBoxH: number;
	toast: string;
}

const state = reactive<ShotState>({
	visible: false,
	capturing: false,
	stage: 'selection',
	display: { x: 0, y: 0, w: 0, h: 0 },
	sel: null,
	ops: [],
	draft: null,
	tool: null,
	width: 2,
	color: COLORS[0],
	textEditing: false,
	textValue: '',
	textFrameAt: { x: 0, y: 0 },
	textBoxH: textLineHeight(TEXT_FONT_SIZE) + TEXT_PAD_Y * 2,
	toast: ''
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const textInputRef = ref<HTMLTextAreaElement | null>(null);

let frame: HTMLCanvasElement | null = null;
let toastTimer = 0;
let drag: { mode: 'select' | 'draw'; startCss: Point; startFrame: Point; points: Point[] } | null = null;
let bodyOverflow = '';

function lockBody(): void {
	bodyOverflow = document.body.style.overflow;
	document.body.style.overflow = 'hidden';
}

function unlockBody(): void {
	document.body.style.overflow = bodyOverflow;
}

const widths = computed<number[]>(() => (state.tool === 'mosaic' ? [8, 12, 16] : [2, 4, 6]));
const fontSizes = FONT_SIZES;

const frameRatio = computed<number>(() => (frame && state.display.w > 0 ? frame.width / state.display.w : 1));

const sizeLabel = computed<string>(() => {
	const sel = state.sel;
	if (!sel || sel.w < 1 || sel.h < 1 || !frame) return '';
	const ratio = frame.width / state.display.w;
	return `${Math.round(sel.w * ratio)} × ${Math.round(sel.h * ratio)}`;
});

const sizeLabelStyle = computed((): Record<string, string> => {
	const sel = state.sel;
	if (!sel) return {};
	return { left: `${Math.round(sel.x + 6)}px`, top: `${Math.round(sel.y + 6)}px` };
});

function toCss(p: Point): Point {
	const d = state.display;
	const ratio = frameRatio.value;
	return { x: d.x + p.x / ratio, y: d.y + p.y / ratio };
}

let halfLeadingCache: { size: number; value: number } | null = null;

/**
 * 行盒半行距：CSS 行高与字体行高之差的一半。
 * 用 measureText 取真实字体度量，避免猜测导致预览与落字错位；字号可变，按字号缓存。
 */
function textHalfLeading(size: number): number {
	if (halfLeadingCache && halfLeadingCache.size === size) return halfLeadingCache.value;
	let ascent = size * 0.9;
	let descent = size * 0.2;
	const ctx = document.createElement('canvas').getContext('2d');
	if (ctx) {
		ctx.font = `${size}px ${TEXT_FONT_FAMILY}`;
		const metrics = ctx.measureText('Hg汉') as TextMetrics & {
			fontBoundingBoxAscent?: number;
			fontBoundingBoxDescent?: number;
		};
		if (typeof metrics.fontBoundingBoxAscent === 'number') ascent = metrics.fontBoundingBoxAscent;
		if (typeof metrics.fontBoundingBoxDescent === 'number') descent = metrics.fontBoundingBoxDescent;
	}
	const value = (textLineHeight(size) - (ascent + descent)) / 2;
	halfLeadingCache = { size, value };
	return value;
}

interface TextLayout {
	/** 输入框左上角（border-box），CSS 像素 */
	left: number;
	top: number;
	width: number;
	/** 首行文字上沿相对输入框顶部的偏移：内边距 + 半行距 */
	textOffsetY: number;
}

/**
 * 输入框布局。落字原点始终等于输入框内首行文字的位置，
 * 因此位置被夹紧（靠右/靠下点击）时，预览和最终落字仍然重合。
 */
const textLayout = computed<TextLayout>(() => {
	const at = toCss(state.textFrameAt);
	const sel = state.sel;
	const size = state.width;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const maxWidth = Math.max(60, Math.min(TEXT_MAX_WIDTH, vw - 8));
	const room = sel ? sel.x + sel.w - at.x : maxWidth;
	const width = Math.round(Math.min(maxWidth, Math.max(TEXT_MIN_WIDTH, room)));
	let left = at.x - TEXT_PAD_X;
	// 宽度被抬到最小宽度后可能探出选区右侧，整体左移而不是让文字被裁掉
	if (sel) left = Math.min(left, sel.x + sel.w + TEXT_PAD_X - width);
	left = Math.min(Math.max(4, left), Math.max(4, vw - width - 4));
	let top = at.y - TEXT_PAD_Y - textHalfLeading(size);
	top = Math.min(Math.max(4, top), Math.max(4, vh - state.textBoxH - 4));
	return { left: Math.round(left), top: Math.round(top), width, textOffsetY: TEXT_PAD_Y + textHalfLeading(size) };
});

const textInputStyle = computed((): Record<string, string> => {
	const box = textLayout.value;
	return {
		left: `${box.left}px`,
		top: `${box.top}px`,
		width: `${box.width}px`,
		color: state.color,
		fontFamily: TEXT_FONT_FAMILY,
		fontSize: `${state.width}px`,
		lineHeight: `${textLineHeight(state.width)}px`
	};
});

/** 输入框随内容增高：先归零再读 scrollHeight，否则缩不回去 */
function syncTextSize(): void {
	const el = textInputRef.value;
	if (!el) return;
	el.style.height = 'auto';
	const height = el.scrollHeight;
	el.style.height = `${height}px`;
	if (height !== state.textBoxH) state.textBoxH = height;
}

function setToast(text: string): void {
	state.toast = text;
	window.clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => {
		state.toast = '';
	}, 1600);
}

function unbind(): void {
	window.removeEventListener('keydown', onKeyDown, true);
	window.removeEventListener('resize', onResize);
}

function resetState(): void {
	unbind();
	unlockBody();
	state.visible = false;
	state.capturing = false;
	state.stage = 'selection';
	state.sel = null;
	state.ops = [];
	state.draft = null;
	state.tool = null;
	state.width = 2;
	state.textEditing = false;
	state.textValue = '';
	state.toast = '';
	drag = null;
	if (frame) {
		frame.width = 0;
		frame.height = 0;
	}
	frame = null;
}

function resetForShot(): void {
	state.stage = 'selection';
	state.sel = null;
	state.ops = [];
	state.draft = null;
	state.tool = null;
	state.width = 2;
	state.color = COLORS[0];
	state.textEditing = false;
	state.textValue = '';
	drag = null;
}

function bind(): void {
	window.addEventListener('keydown', onKeyDown, true);
	window.addEventListener('resize', onResize);
}

function close(): void {
	resetState();
	emit('update:show', false);
}

async function start(): Promise<void> {
	if (state.visible || state.capturing) return;
	if (!isCaptureSupported()) {
		emit('error', { stage: 'unsupported', message: '当前环境不支持网页抓屏，请使用 https 或 localhost 访问' });
		emit('update:show', false);
		return;
	}
	state.capturing = true;
	try {
		frame = await captureScreen(props.captureDelay);
		resetForShot();
		layout();
		state.visible = true;
		lockBody();
		bind();
		await nextTick();
		repaint();
	} catch (err) {
		const name = err instanceof Error ? err.name : '';
		resetState();
		if (name === 'NotAllowedError' || name === 'AbortError') emit('cancel');
		else emit('error', { stage: 'capture', message: err instanceof Error ? err.message : '抓屏失败' });
		emit('update:show', false);
	} finally {
		state.capturing = false;
	}
}

function layout(): void {
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const fw = frame?.width || vw;
	const fh = frame?.height || vh;
	const scale = Math.min(vw / fw, vh / fh);
	state.display = { x: (vw - fw * scale) / 2, y: (vh - fh * scale) / 2, w: fw * scale, h: fh * scale };
}

function clampToDisplay(x: number, y: number): Point {
	const d = state.display;
	return {
		x: Math.min(Math.max(x, d.x), d.x + d.w),
		y: Math.min(Math.max(y, d.y), d.y + d.h)
	};
}

function clampToSelection(x: number, y: number): Point {
	const sel = state.sel;
	if (!sel) return { x, y };
	return {
		x: Math.min(Math.max(x, sel.x), sel.x + sel.w),
		y: Math.min(Math.max(y, sel.y), sel.y + sel.h)
	};
}

function toFrame(p: Point): Point {
	const d = state.display;
	const ratio = frameRatio.value;
	return { x: (p.x - d.x) * ratio, y: (p.y - d.y) * ratio };
}

function insideSelection(sel: Rect, x: number, y: number): boolean {
	return x >= sel.x && x <= sel.x + sel.w && y >= sel.y && y <= sel.y + sel.h;
}

function repaint(): void {
	const canvas = canvasRef.value;
	if (!canvas || !frame) return;
	const dpr = window.devicePixelRatio || 1;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const needW = Math.max(1, Math.round(vw * dpr));
	const needH = Math.max(1, Math.round(vh * dpr));
	if (canvas.width !== needW || canvas.height !== needH) {
		canvas.width = needW;
		canvas.height = needH;
	}
	canvas.style.width = `${vw}px`;
	canvas.style.height = `${vh}px`;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, vw, vh);
	const d = state.display;
	ctx.drawImage(frame, d.x, d.y, d.w, d.h);
	ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
	ctx.fillRect(0, 0, vw, vh);
	const sel = state.sel;
	if (sel && sel.w > 0 && sel.h > 0) {
		const option = { scale: d.w / frame.width, widthScale: 1, offsetX: d.x, offsetY: d.y, source: frame as CanvasImageSource };
		ctx.save();
		ctx.beginPath();
		ctx.rect(sel.x, sel.y, sel.w, sel.h);
		ctx.clip();
		ctx.drawImage(frame, d.x, d.y, d.w, d.h);
		drawOps(ctx, state.ops, option);
		if (state.draft) drawOps(ctx, [state.draft], option);
		ctx.restore();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
		ctx.lineWidth = 1;
		ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, Math.max(0, sel.w - 1), Math.max(0, sel.h - 1));
	}
}

function buildOp(tool: ToolType, from: Point, to: Point, points: Point[]): AnnotationOp | null {
	if (tool === 'text') return null;
	if (tool === 'brush') {
		return { type: 'brush', color: state.color, width: state.width, points: points.map((p) => ({ ...p })) };
	}
	// 箭头保留起止顺序，不能用归一化矩形
	if (tool === 'arrow') {
		return { type: 'arrow', color: state.color, width: state.width, from: { ...from }, to: { ...to } };
	}
	return { type: tool, color: state.color, width: state.width, rect: normalizeRect(from, to) };
}

function isMeaningful(op: AnnotationOp): boolean {
	if (op.type === 'brush') return op.points.length > 1;
	if (op.type === 'text') return op.text.trim().length > 0;
	// 水平/垂直箭头的 w 或 h 为 0，只能按长度判
	if (op.type === 'arrow') return Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y) >= 4;
	return op.rect.w >= 2 && op.rect.h >= 2;
}

function onPointerDown(event: PointerEvent): void {
	if (state.capturing) return;
	// 输入框的 blur 晚于 pointerdown，等 blur 提交会让这一笔点击被吞掉
	if (state.textEditing) commitText();
	const host = event.currentTarget as HTMLElement | null;
	if (host && typeof host.setPointerCapture === 'function') {
		try {
			host.setPointerCapture(event.pointerId);
		} catch {
			/* 某些浏览器对已释放的指针会抛错，忽略即可 */
		}
	}
	if (state.stage === 'selection') {
		const p = clampToDisplay(event.clientX, event.clientY);
		drag = { mode: 'select', startCss: p, startFrame: toFrame(p), points: [] };
		state.sel = { x: p.x, y: p.y, w: 0, h: 0 };
		repaint();
		return;
	}
	const sel = state.sel;
	const tool = state.tool;
	if (!sel || !tool) return;
	if (!insideSelection(sel, event.clientX, event.clientY)) return;
	const p = clampToSelection(event.clientX, event.clientY);
	if (tool === 'text') {
		openTextEditor(p);
		return;
	}
	const fp = toFrame(p);
	drag = { mode: 'draw', startCss: p, startFrame: fp, points: [fp] };
	state.draft = buildOp(tool, fp, fp, [fp]);
	repaint();
}

function onPointerMove(event: PointerEvent): void {
	if (!drag) return;
	if (drag.mode === 'select') {
		const p = clampToDisplay(event.clientX, event.clientY);
		state.sel = normalizeRect(drag.startCss, p);
		repaint();
		return;
	}
	const tool = state.tool;
	if (!tool) return;
	const p = clampToSelection(event.clientX, event.clientY);
	const fp = toFrame(p);
	if (tool === 'brush') {
		drag.points.push(fp);
		state.draft = buildOp(tool, drag.startFrame, fp, drag.points);
	} else {
		state.draft = buildOp(tool, drag.startFrame, fp, drag.points);
	}
	repaint();
}

function onPointerUp(): void {
	if (!drag) return;
	const mode = drag.mode;
	drag = null;
	if (mode === 'select') {
		const sel = state.sel;
		if (!sel || sel.w < 5 || sel.h < 5) {
			state.sel = null;
			state.draft = null;
		} else {
			state.stage = 'annotate';
		}
		repaint();
		return;
	}
	const draft = state.draft;
	state.draft = null;
	if (draft && isMeaningful(draft)) state.ops.push(draft);
	repaint();
}

function openTextEditor(p: Point): void {
	state.textFrameAt = toFrame(p);
	state.textValue = '';
	state.textBoxH = textLineHeight(state.width) + TEXT_PAD_Y * 2;
	state.textEditing = true;
	void nextTick(() => {
		if (state.textEditing) focusTextEditor();
	});
}

/**
 * 聚焦文字输入框。
 * pointerdown 的默认聚焦行为排在微任务之后（会把焦点移到 body），
 * 在 nextTick 里聚焦会被它抢走并立刻触发 blur，输入框刚出现就被关掉，
 * 所以用宏任务延后一帧，确保聚焦排在默认行为之后。
 */
function focusTextEditor(): void {
	window.setTimeout(() => {
		const el = textInputRef.value;
		if (!el || !state.textEditing) return;
		if (document.activeElement !== el) el.focus();
		syncTextSize();
	}, 0);
}

/** Shift+Enter 换行，Enter 提交；组词中的回车是选词，不能当提交 */
function onTextKeyDown(event: KeyboardEvent): void {
	if (event.key !== 'Enter' || event.shiftKey) return;
	if (event.isComposing || event.keyCode === 229) return;
	event.preventDefault();
	commitText();
}

function commitText(): void {
	if (!state.textEditing) return;
	const text = state.textValue.trim();
	const box = textLayout.value;
	state.textEditing = false;
	state.textValue = '';
	if (text) {
		// 落字原点取输入框内首行文字的位置，预览与成品完全重合
		const origin = toFrame({ x: box.left + TEXT_PAD_X, y: box.top + box.textOffsetY });
		state.ops.push({ type: 'text', color: state.color, width: state.width, x: origin.x, y: origin.y, text });
	}
	repaint();
}

function cancelText(): void {
	if (!state.textEditing) return;
	state.textEditing = false;
	state.textValue = '';
	repaint();
}

function undo(): void {
	// 输入中的文字先落地再撤销，撤销按钮点击不会因为 pointerdown 被拦截而丢字
	if (state.textEditing) commitText();
	if (!state.ops.length) return;
	state.ops.pop();
	repaint();
}

function onToolChange(tool: ToolType | null): void {
	// 切换工具时提交而不是丢弃正在输入的文字
	if (state.textEditing) commitText();
	state.tool = tool;
	if (tool === 'text') state.width = TEXT_FONT_SIZE;
	else if (tool === 'mosaic') state.width = 8;
	else if (tool) state.width = 2;
	repaint();
}

function onWidthChange(value: number): void {
	state.width = value;
}

function onColorChange(value: string): void {
	state.color = value;
}

function downloadBlob(blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `${props.fileName}-${stamp()}.png`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
	const now = new Date();
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 同步合成选区画布：Safari 的剪贴板写入要求全程留在用户手势的调用栈内，合成不能 await */
function renderOutput(): HTMLCanvasElement | null {
	const sel = state.sel;
	if (!sel || !frame) return null;
	const ratio = frame.width / state.display.w;
	const selInFrame: Rect = {
		x: (sel.x - state.display.x) * ratio,
		y: (sel.y - state.display.y) * ratio,
		w: sel.w * ratio,
		h: sel.h * ratio
	};
	return renderSelection(frame, state.ops, selInFrame, ratio);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise<Blob>((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('截图合成失败'));
		}, 'image/png');
	});
}

function canWriteClipboard(): boolean {
	return typeof ClipboardItem !== 'undefined' && !!navigator.clipboard && typeof navigator.clipboard.write === 'function';
}

/**
 * 写图片到剪贴板。
 * Safari 要求 clipboard.write 在用户手势的调用栈内同步发起，中途 await 会直接 NotAllowedError。
 * 因此这里把「待定的 Blob」交给 ClipboardItem，让浏览器自己等它，write 调用本身不跨异步边界。
 * @param blobPromise 已开始生成的图片数据，复制失败时调用方仍可取回它
 * @returns 写入成功时的 Blob，失败返回 null
 */
async function copyImage(blobPromise: Promise<Blob>): Promise<Blob | null> {
	if (!canWriteClipboard()) return null;
	let written: Promise<boolean>;
	try {
		written = navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]).then(
			() => true,
			() => false
		);
	} catch {
		// 老版本 Chromium 不接受 Promise 作为 ClipboardItem 的值，交给调用方重试
		return null;
	}
	try {
		const [ok, blob] = await Promise.all([written, blobPromise]);
		return ok ? blob : null;
	} catch {
		return null;
	}
}

/** 不支持 Promise 值时的兜底：Blob 就绪后再写一次（Chromium 不要求手势，仍可成功） */
async function writeBlob(blob: Blob): Promise<boolean> {
	if (!canWriteClipboard()) return false;
	try {
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return true;
	} catch {
		return false;
	}
}

async function onConfirm(): Promise<void> {
	if (state.capturing) return;
	// 完成时把输入中的文字一并落地，而不是只提交文字
	if (state.textEditing) commitText();
	const canvas = renderOutput();
	if (!canvas) return;
	// 从这里到 clipboard.write 之间不能有 await，否则 Safari 会认为用户手势已结束
	const blobPromise = canvasToBlob(canvas);
	const copied = await copyImage(blobPromise);
	if (copied) {
		emit('success', { mode: 'clipboard', blob: copied });
		close();
		return;
	}
	let blob: Blob;
	try {
		blob = await blobPromise;
	} catch {
		emit('error', { stage: 'clipboard', message: '截图合成失败' });
		return;
	}
	const retried = await writeBlob(blob);
	if (!retried) downloadBlob(blob);
	emit('success', { mode: retried ? 'clipboard' : 'download', blob });
	close();
}

async function onDownload(): Promise<void> {
	// 输入中的文字先落地，下载结果才包含它
	if (state.textEditing) commitText();
	const canvas = renderOutput();
	if (!canvas) return;
	let blob: Blob;
	try {
		blob = await canvasToBlob(canvas);
	} catch {
		emit('error', { stage: 'capture', message: '截图合成失败' });
		return;
	}
	downloadBlob(blob);
	emit('download', { blob });
	setToast('已下载');
}

function cancel(): void {
	close();
	emit('cancel');
}

function onResize(): void {
	if (!state.visible) return;
	layout();
	const sel = state.sel;
	if (sel) {
		state.sel = normalizeRect(clampToDisplay(sel.x, sel.y), clampToDisplay(sel.x + sel.w, sel.y + sel.h));
	}
	repaint();
	// 输入框宽度随窗口变化后会重新折行，高度需跟着重算
	if (state.textEditing) void nextTick(syncTextSize);
}

function onKeyDown(event: KeyboardEvent): void {
	if (!state.visible) return;
	if (event.key === 'Escape') {
		event.preventDefault();
		if (state.textEditing) cancelText();
		else cancel();
		return;
	}
	if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
		if (state.textEditing) return;
		event.preventDefault();
		undo();
		return;
	}
	if (event.key === 'Enter' && !state.textEditing) {
		event.preventDefault();
		void onConfirm();
	}
}

watch(
	() => props.show,
	(value) => {
		if (value) void start();
		else resetState();
	},
	{ flush: 'sync' }
);

onMounted(() => {
	if (props.show) void start();
});

onUnmounted(() => {
	window.clearTimeout(toastTimer);
	resetState();
});
</script>

<style scoped>
.vws-root {
	position: fixed;
	inset: 0;
	overflow: hidden;
	cursor: crosshair;
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
	font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.vws-root:not(.is-tool):not(.is-selecting) {
	cursor: default;
}

.vws-canvas {
	position: absolute;
	top: 0;
	left: 0;
	display: block;
	pointer-events: none;
}

.vws-size {
	position: absolute;
	padding: 1px 6px;
	border-radius: 3px;
	background: rgba(0, 0, 0, 0.62);
	color: #fff;
	font-size: 12px;
	line-height: 18px;
	white-space: nowrap;
	pointer-events: none;
}

.vws-text {
	position: absolute;
	box-sizing: border-box;
	margin: 0;
	padding: 2px 4px;
	border: 0;
	/* 用 outline 不用 border：不参与布局，首行文字起点才不会偏 */
	outline: 1px dashed currentColor;
	border-radius: 3px;
	background: rgba(0, 0, 0, 0.35);
	overflow: hidden;
	resize: none;
	white-space: pre-wrap;
	word-break: break-word;
	caret-color: currentColor;
	user-select: text;
	-webkit-user-select: text;
}

.vws-text::placeholder {
	color: rgba(255, 255, 255, 0.55);
}

.vws-toast {
	position: fixed;
	top: 24px;
	left: 50%;
	padding: 6px 14px;
	border-radius: 6px;
	background: rgba(0, 0, 0, 0.78);
	color: #fff;
	font-size: 13px;
	pointer-events: none;
	transform: translateX(-50%);
}
</style>