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
			<input
				v-if="state.textEditing"
				ref="textInputRef"
				v-model="state.textValue"
				class="vws-text"
				:style="textInputStyle"
				placeholder="输入文字"
				@pointerdown.stop
				@keydown.enter.prevent.stop="commitText"
				@keydown.esc.prevent.stop="cancelText"
				@blur="commitText"
			/>
			<Toolbar
				v-if="state.sel && state.stage === 'annotate'"
				:model-value="state.tool"
				:width="state.width"
				:widths="widths"
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
import { drawOps, normalizeRect, renderSelection } from './annotation';
import type { AnnotationOp, Point, Rect, ToolType } from './annotation';

const COLORS = ['#ff4d4f', '#ffd400', '#22c55e', '#1677ff', '#111111', '#ffffff'];
const TEXT_SIZE = 14;

const props = withDefaults(
	defineProps<{
		show: boolean;
		zIndex?: number;
		fileName?: string;
	}>(),
	{
		zIndex: 3000,
		fileName: '网页截图'
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
	textAt: Point;
	textFrameAt: Point;
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
	textAt: { x: 0, y: 0 },
	textFrameAt: { x: 0, y: 0 },
	toast: ''
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const textInputRef = ref<HTMLInputElement | null>(null);

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

const textInputStyle = computed<Record<string, string>>(() => ({
	left: `${Math.round(state.textAt.x)}px`,
	top: `${Math.round(state.textAt.y)}px`,
	color: state.color,
	fontSize: `${TEXT_SIZE}px`
}));

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
		frame = await captureScreen();
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
	return { type: tool, color: state.color, width: state.width, rect: normalizeRect(from, to) };
}

function isMeaningful(op: AnnotationOp): boolean {
	if (op.type === 'brush') return op.points.length > 1;
	if (op.type === 'text') return op.text.trim().length > 0;
	return op.rect.w >= 2 && op.rect.h >= 2;
}

function onPointerDown(event: PointerEvent): void {
	if (state.capturing || state.textEditing) return;
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
	state.textAt = { x: p.x, y: p.y };
	state.textFrameAt = toFrame(p);
	state.textValue = '';
	state.textEditing = true;
	void nextTick(() => textInputRef.value?.focus());
}

function commitText(): void {
	if (!state.textEditing) return;
	const text = state.textValue.trim();
	state.textEditing = false;
	state.textValue = '';
	if (text) {
		state.ops.push({ type: 'text', color: state.color, width: TEXT_SIZE, x: state.textFrameAt.x, y: state.textFrameAt.y, text });
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
	if (!state.ops.length) return;
	state.ops.pop();
	repaint();
}

function onToolChange(tool: ToolType | null): void {
	state.textEditing = false;
	state.textValue = '';
	state.tool = tool;
	if (tool === 'text') state.width = TEXT_SIZE;
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

async function copyImage(blob: Blob): Promise<boolean> {
	try {
		if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.write !== 'function') return false;
		await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
		return true;
	} catch {
		return false;
	}
}

async function exportBlob(): Promise<Blob | null> {
	const sel = state.sel;
	if (!sel || !frame) return null;
	const ratio = frame.width / state.display.w;
	const selInFrame: Rect = {
		x: (sel.x - state.display.x) * ratio,
		y: (sel.y - state.display.y) * ratio,
		w: sel.w * ratio,
		h: sel.h * ratio
	};
	const out = renderSelection(frame, state.ops, selInFrame, ratio);
	return new Promise<Blob | null>((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'));
}

async function onConfirm(): Promise<void> {
	if (state.capturing) return;
	if (state.textEditing) {
		commitText();
		return;
	}
	if (!state.sel) return;
	const blob = await exportBlob();
	if (!blob) {
		emit('error', { stage: 'clipboard', message: '截图合成失败' });
		return;
	}
	const copied = await copyImage(blob);
	if (!copied) downloadBlob(blob);
	emit('success', { mode: copied ? 'clipboard' : 'download', blob });
	close();
}

async function onDownload(): Promise<void> {
	if (!state.sel) return;
	const blob = await exportBlob();
	if (!blob) {
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
	min-width: 90px;
	max-width: 320px;
	padding: 2px 4px;
	border: 1px dashed currentColor;
	border-radius: 3px;
	background: rgba(0, 0, 0, 0.35);
	outline: none;
	line-height: 1.4;
	user-select: text;
	-webkit-user-select: text;
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