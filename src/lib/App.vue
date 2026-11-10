<template>
	<Teleport to="body">
		<div
			v-if="state.visible"
			class="vws-root"
			:class="{ 'is-tool': !!state.tool, 'is-selecting': state.stage === 'selection' }"
			:style="{ zIndex: String(props.zIndex), cursor: state.cursor || undefined }"
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
				@blur="onTextBlur"
			/>
			<Toolbar
				v-if="state.sel && state.stage === 'annotate'"
				:model-value="state.tool"
				:width="state.width"
				:font-sizes="fontSizes"
				:stroke-width="state.strokeWidth"
				:stroke-color="state.strokeColor"
				:stroke-enabled="state.strokeEnabled"
				:fill-enabled="state.fillEnabled"
				:fill-color="state.fillColor"
				:color="state.color"
				:anchor="state.sel"
				:can-undo="state.history.length > 0"
				@update:model-value="onToolChange"
				@update:width="onWidthChange"
				@update:stroke-width="onStrokeWidthChange"
				@update:stroke-color="onStrokeColorChange"
				@update:stroke-enabled="onStrokeEnabledChange"
				@update:fill-enabled="onFillEnabledChange"
				@update:fill-color="onFillColorChange"
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
import {
	drawOps,
	normalizeRect,
	renderSelection,
	scaleOps,
	translateOps,
	TEXT_FONT_FAMILY,
	TEXT_FONT_SIZE,
	TEXT_LINE_HEIGHT_RATIO
} from './annotation';
import type { AnnotationOp, Point, Rect, TextOp, ToolType } from './annotation';

/** 主体默认颜色：图形线条色 / 文字颜色 */
const DEFAULT_COLOR = '#ff4d4f';
/** 填充默认颜色 */
const DEFAULT_FILL_COLOR = '#ff4d4f';
/** 描边默认颜色，浅色在深色截图上更显眼 */
const DEFAULT_STROKE_COLOR = '#ffffff';
/** 选区边框与控制点颜色 */
const FRAME_COLOR = '#22c55e';
/** 控制点边长，单位 CSS 像素 */
const HANDLE_SIZE = 8;
/** 控制点命中半径（在边长之外再放宽一点，方便点中） */
const HANDLE_HIT = HANDLE_SIZE / 2 + 4;
/** 边框命中容差，单位 CSS 像素 */
const EDGE_HIT = 4;
/** 选区最小尺寸，单位 CSS 像素 */
const MIN_SEL = 5;
/** 撤销栈上限，避免长时间使用后无限增长 */
const HISTORY_LIMIT = 100;
/** 文字字号下拉档位，单位 CSS 像素，默认 12 */
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 32];
/** 主体尺寸与描边宽度下限，单位 CSS 像素；所有尺寸都手输 */
const MIN_SIZE = 0.1;
/** 描边默认宽度，单位 CSS 像素 */
const DEFAULT_STROKE_WIDTH = 0.1;
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

/** 一次可撤销操作的「之前」状态：选区几何 + 标注快照 */
interface Snapshot {
	sel: Rect | null;
	ops: AnnotationOp[];
}

interface ShotState {
	visible: boolean;
	capturing: boolean;
	stage: 'selection' | 'annotate';
	display: Rect;
	sel: Rect | null;
	ops: AnnotationOp[];
	/** 撤销栈，存每次修改前的快照；标注新增、移动选区、缩放选区都记一条 */
	history: Snapshot[];
	draft: AnnotationOp | null;
	tool: ToolType | null;
	/** 当前工具的主体尺寸：图形线宽、文字字号或马赛克块大小，单位 CSS 像素 */
	width: number;
	/** 主体颜色：文字颜色 / 图形线条色 */
	color: string;
	/** 是否绘制外圈描边 */
	strokeEnabled: boolean;
	/** 描边宽度，CSS 像素，默认 0.1 */
	strokeWidth: number;
	/** 描边颜色：文字外描边 / 图形线条外圈 */
	strokeColor: string;
	/** 矩形/椭圆是否填充 */
	fillEnabled: boolean;
	/** 矩形/椭圆的填充色 */
	fillColor: string;
	textEditing: boolean;
	textValue: string;
	/** 正在编辑已有文字时的标注下标；null 表示新建文字 */
	editingTextIndex: number | null;
	/** 文字锚点，静帧像素；CSS 坐标由它换算，窗口尺寸变化时自动跟随 */
	textFrameAt: Point;
	/** 输入框当前高度，用于边界夹紧 */
	textBoxH: number;
	toast: string;
	/** 当前光标样式；空串表示交回 CSS 默认值 */
	cursor: string;
}

const state = reactive<ShotState>({
	visible: false,
	capturing: false,
	stage: 'selection',
	display: { x: 0, y: 0, w: 0, h: 0 },
	sel: null,
	ops: [],
	history: [],
	draft: null,
	tool: null,
	width: 2,
	color: DEFAULT_COLOR,
	strokeEnabled: false,
	strokeWidth: DEFAULT_STROKE_WIDTH,
	strokeColor: DEFAULT_STROKE_COLOR,
	fillEnabled: false,
	fillColor: DEFAULT_FILL_COLOR,
	textEditing: false,
	textValue: '',
	editingTextIndex: null,
	textFrameAt: { x: 0, y: 0 },
	textBoxH: textLineHeight(TEXT_FONT_SIZE) + TEXT_PAD_Y * 2,
	toast: '',
	cursor: ''
});

const canvasRef = ref<HTMLCanvasElement | null>(null);
const textInputRef = ref<HTMLTextAreaElement | null>(null);

/** 控制点方向：先纵后横，便于用 includes 判断，如 'nw' / 'e' / 's' */
type ResizeDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

type Drag =
	| { mode: 'select'; startCss: Point; startFrame: Point; points: Point[] }
	| { mode: 'draw'; startCss: Point; startFrame: Point; points: Point[] }
	| { mode: 'move'; startCss: Point; startSel: Rect; startOps: AnnotationOp[] }
	| { mode: 'resize'; dir: ResizeDir; startSel: Rect; startOps: AnnotationOp[] };

type HitTarget = { type: 'resize'; dir: ResizeDir } | { type: 'move' } | { type: 'draw' };

let frame: HTMLCanvasElement | null = null;
let toastTimer = 0;
let drag: Drag | null = null;
let bodyOverflow = '';
/** 文字测量用的离屏上下文，按需创建 */
let measureCtx: CanvasRenderingContext2D | null = null;
/**
 * 打开文字输入框的瞬间会由浏览器的默认聚焦行为触发一次 blur。
 * 用这个开关压掉那次 blur，避免刚打开的输入框被立刻提交。
 */
let ignoreBlur = false;

function lockBody(): void {
	bodyOverflow = document.body.style.overflow;
	document.body.style.overflow = 'hidden';
}

function unlockBody(): void {
	document.body.style.overflow = bodyOverflow;
}

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
	const style: Record<string, string> = {
		left: `${box.left}px`,
		top: `${box.top}px`,
		width: `${box.width}px`,
		color: state.color,
		fontFamily: TEXT_FONT_FAMILY,
		fontSize: `${state.width}px`,
		lineHeight: `${textLineHeight(state.width)}px`
	};
	// 输入框里用文字描边近似预览画布效果；关闭描边时保持纯净
	if (state.strokeEnabled && state.strokeWidth > 0) {
		style['-webkit-text-stroke'] = `${state.strokeWidth}px ${state.strokeColor}`;
		style.paintOrder = 'stroke fill';
	}
	return style;
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
	state.history = [];
	state.draft = null;
	state.tool = null;
	state.width = 2;
	state.strokeEnabled = false;
	state.strokeWidth = DEFAULT_STROKE_WIDTH;
	state.strokeColor = DEFAULT_STROKE_COLOR;
	state.fillEnabled = false;
	state.fillColor = DEFAULT_FILL_COLOR;
	state.textEditing = false;
	state.textValue = '';
	state.editingTextIndex = null;
	state.toast = '';
	state.cursor = '';
	drag = null;
	ignoreBlur = false;
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
	state.history = [];
	state.draft = null;
	state.tool = null;
	state.width = 2;
	state.color = DEFAULT_COLOR;
	state.strokeEnabled = false;
	state.strokeWidth = DEFAULT_STROKE_WIDTH;
	state.strokeColor = DEFAULT_STROKE_COLOR;
	state.fillEnabled = false;
	state.fillColor = DEFAULT_FILL_COLOR;
	state.textEditing = false;
	state.textValue = '';
	state.editingTextIndex = null;
	state.cursor = '';
	drag = null;
	ignoreBlur = false;
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

function getMeasureCtx(): CanvasRenderingContext2D | null {
	if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
	return measureCtx;
}

/**
 * 文字标注在静帧坐标下的包围盒，用于命中已落字的文字。
 * 行高取画布实际换行步进，宽度按最长一行测量，宁可稍大一点方便点中。
 */
function textBounds(op: TextOp): Rect {
	const fontPx = Math.max(6, op.width);
	const lines = op.text.split('\n');
	let width = 0;
	const ctx = getMeasureCtx();
	if (ctx) {
		ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
		for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
	} else {
		// 极端情况下取不到上下文，用字数粗估，保证还能点中
		for (const line of lines) width = Math.max(width, line.length * fontPx * 0.6);
	}
	return { x: op.x, y: op.y, w: width, h: lines.length * fontPx * TEXT_LINE_HEIGHT_RATIO };
}

/** 从后往前找落点下的文字标注；返回 -1 表示没点到 */
function textIndexAt(p: Point): number {
	const pad = 4 * frameRatio.value;
	for (let i = state.ops.length - 1; i >= 0; i--) {
		const op = state.ops[i];
		if (!op || op.type !== 'text') continue;
		const box = textBounds(op);
		if (p.x >= box.x - pad && p.x <= box.x + box.w + pad && p.y >= box.y - pad && p.y <= box.y + box.h + pad) return i;
	}
	return -1;
}

/** 8 个控制点：四角 + 四边中点，坐标是选区边界上的 CSS 像素 */
function handlePoints(sel: Rect): { dir: ResizeDir; x: number; y: number }[] {
	const right = sel.x + sel.w;
	const bottom = sel.y + sel.h;
	const cx = sel.x + sel.w / 2;
	const cy = sel.y + sel.h / 2;
	return [
		{ dir: 'nw', x: sel.x, y: sel.y },
		{ dir: 'n', x: cx, y: sel.y },
		{ dir: 'ne', x: right, y: sel.y },
		{ dir: 'e', x: right, y: cy },
		{ dir: 'se', x: right, y: bottom },
		{ dir: 's', x: cx, y: bottom },
		{ dir: 'sw', x: sel.x, y: bottom },
		{ dir: 'w', x: sel.x, y: cy }
	];
}

function resizeCursor(dir: ResizeDir): string {
	switch (dir) {
		case 'n':
		case 's':
			return 'ns-resize';
		case 'e':
		case 'w':
			return 'ew-resize';
		case 'nw':
		case 'se':
			return 'nwse-resize';
		default:
			return 'nesw-resize';
	}
}

/**
 * 命中测试：控制点 > 边框 > 选区内部。
 * 只在选区定稿后生效；内部在未选工具时是移动，选了工具就是绘图。
 */
function hitTest(x: number, y: number): HitTarget | null {
	if (state.stage !== 'annotate' || !state.sel) return null;
	const sel = state.sel;
	for (const h of handlePoints(sel)) {
		if (Math.abs(x - h.x) <= HANDLE_HIT && Math.abs(y - h.y) <= HANDLE_HIT) return { type: 'resize', dir: h.dir };
	}
	const nearX = x >= sel.x - EDGE_HIT && x <= sel.x + sel.w + EDGE_HIT;
	const nearY = y >= sel.y - EDGE_HIT && y <= sel.y + sel.h + EDGE_HIT;
	if (nearX && nearY) {
		const left = Math.abs(x - sel.x);
		const right = Math.abs(x - (sel.x + sel.w));
		const top = Math.abs(y - sel.y);
		const bottom = Math.abs(y - (sel.y + sel.h));
		let vertical: 'n' | 's' | '' = '';
		let horizontal: 'w' | 'e' | '' = '';
		if (Math.min(top, bottom) <= EDGE_HIT) vertical = top <= bottom ? 'n' : 's';
		if (Math.min(left, right) <= EDGE_HIT) horizontal = left <= right ? 'w' : 'e';
		// 先纵后横，保证拼出来是 'nw' / 'se' 这类规范顺序
		if (vertical || horizontal) return { type: 'resize', dir: (vertical + horizontal) as ResizeDir };
		if (insideSelection(sel, x, y)) return state.tool ? { type: 'draw' } : { type: 'move' };
	}
	return null;
}

function cursorForHit(hit: HitTarget | null): string {
	if (!hit) return '';
	if (hit.type === 'move') return 'move';
	if (hit.type === 'draw') return state.tool === 'text' ? 'text' : 'crosshair';
	return resizeCursor(hit.dir);
}

/** 只在光标真正变化时写回，避免每次 pointermove 都触发模板更新 */
function setCursor(value: string): void {
	if (state.cursor !== value) state.cursor = value;
}

function drawSelectionFrame(ctx: CanvasRenderingContext2D, sel: Rect): void {
	ctx.save();
	// 边框画在选区外侧，不遮挡截图内容
	ctx.strokeStyle = FRAME_COLOR;
	ctx.lineWidth = 2;
	ctx.strokeRect(sel.x - 1, sel.y - 1, sel.w + 2, sel.h + 2);
	ctx.fillStyle = '#fff';
	for (const h of handlePoints(sel)) {
		const x = Math.round(h.x - HANDLE_SIZE / 2);
		const y = Math.round(h.y - HANDLE_SIZE / 2);
		ctx.fillRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
		ctx.strokeStyle = FRAME_COLOR;
		ctx.lineWidth = 1;
		ctx.strokeRect(x + 0.5, y + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
	}
	ctx.restore();
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
		// 正在修改的文字在输入框里预览，画布上先不画，避免旧内容从半透明输入框下透出来
		const shownOps = state.editingTextIndex === null ? state.ops : state.ops.filter((_, i) => i !== state.editingTextIndex);
		drawOps(ctx, shownOps, option);
		if (state.draft) drawOps(ctx, [state.draft], option);
		ctx.restore();
		if (state.stage === 'annotate') {
			drawSelectionFrame(ctx, sel);
		} else {
			// 框选过程中先用细白线，定稿后才换成可操作的控制框
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
			ctx.lineWidth = 1;
			ctx.strokeRect(sel.x + 0.5, sel.y + 0.5, Math.max(0, sel.w - 1), Math.max(0, sel.h - 1));
		}
	}
}

function buildOp(tool: ToolType, from: Point, to: Point, points: Point[]): AnnotationOp | null {
	if (tool === 'text') return null;
	// 主体（大小 + 颜色）始终绘制，描边是可选外圈，关闭时落 0
	const width = state.width;
	const color = state.color;
	const strokeWidth = state.strokeEnabled ? state.strokeWidth : 0;
	const strokeColor = state.strokeColor;
	if (tool === 'brush') {
		return {
			type: 'brush',
			width,
			color,
			strokeWidth,
			strokeColor,
			points: points.map((p) => ({ ...p }))
		};
	}
	// 箭头保留起止顺序，不能用归一化矩形
	if (tool === 'arrow') {
		return {
			type: 'arrow',
			width,
			color,
			strokeWidth,
			strokeColor,
			from: { ...from },
			to: { ...to }
		};
	}
	const rect = normalizeRect(from, to);
	// 马赛克没有颜色与描边概念，块大小就是 width
	if (tool === 'mosaic') return { type: 'mosaic', width, color, strokeWidth: 0, strokeColor, rect };
	return {
		type: tool,
		width,
		color,
		strokeWidth,
		strokeColor,
		fill: state.fillEnabled ? state.fillColor : null,
		rect
	};
}

function isMeaningful(op: AnnotationOp): boolean {
	if (op.type === 'brush') return op.width > 0 && op.points.length > 1;
	if (op.type === 'text') return op.text.trim().length > 0;
	// 水平/垂直箭头的 w 或 h 为 0，只能按长度判
	if (op.type === 'arrow') {
		if (op.width <= 0) return false;
		return Math.hypot(op.to.x - op.from.x, op.to.y - op.from.y) >= 4;
	}
	return op.rect.w >= 2 && op.rect.h >= 2;
}

function onPointerDown(event: PointerEvent): void {
	if (state.capturing) return;
	// 只响应主键/触摸，右键与多指副指针不进入拖拽
	if (event.button !== 0 || !event.isPrimary) return;
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
	if (!sel) return;
	const hit = hitTest(event.clientX, event.clientY);
	if (!hit) return;
	if (hit.type === 'resize') {
		// 快照下按下的选区与标注，后续每次移动都从快照重算，避免累积误差
		drag = { mode: 'resize', dir: hit.dir, startSel: { ...sel }, startOps: state.ops.slice() };
		setCursor(resizeCursor(hit.dir));
		return;
	}
	if (hit.type === 'move') {
		drag = {
			mode: 'move',
			startCss: { x: event.clientX, y: event.clientY },
			startSel: { ...sel },
			startOps: state.ops.slice()
		};
		setCursor('move');
		return;
	}
	const tool = state.tool;
	if (!tool) return;
	if (tool === 'text') {
		// 点到已落字的文字优先进入修改，否则在落点新建
		const index = textIndexAt(toFrame({ x: event.clientX, y: event.clientY }));
		if (index >= 0) openTextEditorFor(index);
		else openTextEditor(clampToSelection(event.clientX, event.clientY));
		return;
	}
	const p = clampToSelection(event.clientX, event.clientY);
	const fp = toFrame(p);
	drag = { mode: 'draw', startCss: p, startFrame: fp, points: [fp] };
	state.draft = buildOp(tool, fp, fp, [fp]);
	repaint();
}

/** 拖动选区：整体夹在画面范围内，标注按相同的画面位移跟随 */
function moveSelection(event: PointerEvent): void {
	if (!drag || drag.mode !== 'move') return;
	const start = drag.startSel;
	const d = state.display;
	const dx = Math.min(Math.max(event.clientX - drag.startCss.x, d.x - start.x), d.x + d.w - (start.x + start.w));
	const dy = Math.min(Math.max(event.clientY - drag.startCss.y, d.y - start.y), d.y + d.h - (start.y + start.h));
	state.sel = { x: start.x + dx, y: start.y + dy, w: start.w, h: start.h };
	const ratio = frameRatio.value;
	state.ops = translateOps(drag.startOps, dx * ratio, dy * ratio);
	repaint();
}

/** 拖控制点缩放：对边/对角为锚点，标注坐标按比例映射，线宽与字号不变 */
function resizeSelection(event: PointerEvent, dir: ResizeDir, startSel: Rect, startOps: AnnotationOp[]): void {
	const d = state.display;
	const x = Math.min(Math.max(event.clientX, d.x), d.x + d.w);
	const y = Math.min(Math.max(event.clientY, d.y), d.y + d.h);
	let left = startSel.x;
	let top = startSel.y;
	let right = startSel.x + startSel.w;
	let bottom = startSel.y + startSel.h;
	// 拖过对边时停在最小尺寸，不做翻转
	if (dir.includes('w')) left = Math.min(x, right - MIN_SEL);
	if (dir.includes('e')) right = Math.max(x, left + MIN_SEL);
	if (dir.includes('n')) top = Math.min(y, bottom - MIN_SEL);
	if (dir.includes('s')) bottom = Math.max(y, top + MIN_SEL);
	const next: Rect = { x: left, y: top, w: right - left, h: bottom - top };
	state.sel = next;
	const ratio = frameRatio.value;
	const anchor = toFrame({
		x: dir.includes('w') ? startSel.x + startSel.w : startSel.x,
		y: dir.includes('n') ? startSel.y + startSel.h : startSel.y
	});
	// 分母兜底，避免极端情况下（窗口被压到 0 宽）算出 NaN 污染标注坐标
	state.ops = scaleOps(startOps, next.w / Math.max(startSel.w, 1), next.h / Math.max(startSel.h, 1), anchor);
	repaint();
}

function onPointerMove(event: PointerEvent): void {
	if (!drag) {
		setCursor(cursorForHit(hitTest(event.clientX, event.clientY)));
		return;
	}
	if (drag.mode === 'select') {
		const p = clampToDisplay(event.clientX, event.clientY);
		state.sel = normalizeRect(drag.startCss, p);
		repaint();
		return;
	}
	if (drag.mode === 'move') {
		moveSelection(event);
		return;
	}
	if (drag.mode === 'resize') {
		resizeSelection(event, drag.dir, drag.startSel, drag.startOps);
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

function onPointerUp(event?: PointerEvent): void {
	if (!drag) return;
	const finished = drag;
	drag = null;
	if (finished.mode === 'select') {
		const sel = state.sel;
		if (!sel || sel.w < MIN_SEL || sel.h < MIN_SEL) {
			state.sel = null;
			state.draft = null;
		} else {
			state.stage = 'annotate';
		}
		repaint();
	} else if (finished.mode === 'move' || finished.mode === 'resize') {
		// 只在选区真的变了才记一条，避免「点一下没拖动」也占一次撤销
		if (rectChanged(finished.startSel, state.sel)) {
			pushHistory(finished.startSel, finished.startOps);
		}
		repaint();
	} else {
		const draft = state.draft;
		state.draft = null;
		if (draft && isMeaningful(draft)) {
			pushHistory();
			state.ops.push(draft);
		}
		repaint();
	}
	// 松开后按落点刷新光标，不必等下一次移动
	if (event) setCursor(cursorForHit(hitTest(event.clientX, event.clientY)));
}

function rectChanged(a: Rect, b: Rect | null): boolean {
	return !b || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
}

function openTextEditor(p: Point): void {
	state.editingTextIndex = null;
	state.textFrameAt = toFrame(p);
	state.textValue = '';
	state.textBoxH = textLineHeight(state.width) + TEXT_PAD_Y * 2;
	beginTextEditing();
}

/** 点击已有文字：回到它原来的位置与样式上继续修改，确认后原位替换 */
function openTextEditorFor(index: number): void {
	const op = state.ops[index];
	if (!op || op.type !== 'text') return;
	state.editingTextIndex = index;
	state.textFrameAt = { x: op.x, y: op.y };
	state.textValue = op.text;
	state.width = op.width;
	state.color = op.color;
	state.strokeEnabled = op.strokeWidth > 0;
	state.strokeWidth = op.strokeWidth > 0 ? op.strokeWidth : DEFAULT_STROKE_WIDTH;
	state.strokeColor = op.strokeColor;
	state.textBoxH = textLineHeight(state.width) * op.text.split('\n').length + TEXT_PAD_Y * 2;
	beginTextEditing();
}

function beginTextEditing(): void {
	state.textEditing = true;
	ignoreBlur = true;
	// 修改已有文字时先把它从画布上收起来，编辑期间只显示输入框里的预览
	repaint();
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
		if (!el || !state.textEditing) {
			ignoreBlur = false;
			return;
		}
		if (document.activeElement !== el) el.focus();
		// 光标放到末尾，继续输入或修改都更顺手
		const end = el.value.length;
		try {
			el.setSelectionRange(end, end);
		} catch {
			/* 部分环境对未聚焦元素限制选区操作，忽略 */
		}
		syncTextSize();
		// 默认聚焦引起的 blur 已经过去，之后才把 blur 当作「点外部确认」
		ignoreBlur = false;
	}, 0);
}

/**
 * 文字输入框键盘处理：
 * Enter / Shift + Enter 由浏览器插入换行，Ctrl / Cmd + Enter 才确认；
 * 组词中的回车是选词，不能当确认。
 */
function onTextKeyDown(event: KeyboardEvent): void {
	if (event.key !== 'Enter') return;
	if (event.isComposing || event.keyCode === 229) return;
	if (!(event.ctrlKey || event.metaKey)) return;
	event.preventDefault();
	commitText();
}

/** 输入框失焦：点外部即确认，但忽略刚打开时浏览器默认聚焦造成的那次 blur */
function onTextBlur(event: FocusEvent): void {
	if (ignoreBlur) return;
	// 焦点落到工具栏控件（数字框 / 字号下拉 / 取色器）时保持编辑，方便边输入边调样式
	const next = event.relatedTarget as HTMLElement | null;
	if (next && typeof next.closest === 'function' && next.closest('.vws-tb')) return;
	commitText();
}

function commitText(): void {
	if (!state.textEditing) return;
	const text = state.textValue.trim();
	const box = textLayout.value;
	const editIndex = state.editingTextIndex;
	state.textEditing = false;
	state.textValue = '';
	state.editingTextIndex = null;
	ignoreBlur = false;
	if (editIndex !== null) {
		const prev = state.ops[editIndex];
		if (!prev || prev.type !== 'text') {
			repaint();
			return;
		}
		if (!text) {
			// 清空已有文字等于删除，仍可撤销
			pushHistory();
			state.ops = state.ops.filter((_, i) => i !== editIndex);
			repaint();
			return;
		}
		const next: TextOp = {
			...prev,
			color: state.color,
			width: state.width,
			text,
			strokeWidth: state.strokeEnabled ? state.strokeWidth : 0,
			strokeColor: state.strokeColor
		};
		// 只点开看了看、没改任何东西时不占撤销栈；位置沿用原锚点，避免来回漂移
		if (
			prev.text === next.text &&
			prev.color === next.color &&
			prev.width === next.width &&
			prev.strokeWidth === next.strokeWidth &&
			prev.strokeColor === next.strokeColor
		) {
			repaint();
			return;
		}
		pushHistory();
		state.ops = state.ops.map((op, i) => (i === editIndex ? next : op));
		repaint();
		return;
	}
	if (text) {
		// 落字原点取输入框内首行文字的位置，预览与成品完全重合
		const origin = toFrame({ x: box.left + TEXT_PAD_X, y: box.top + box.textOffsetY });
		pushHistory();
		state.ops.push({
			type: 'text',
			color: state.color,
			width: state.width,
			x: origin.x,
			y: origin.y,
			text,
			strokeWidth: state.strokeEnabled ? state.strokeWidth : 0,
			strokeColor: state.strokeColor
		});
	}
	repaint();
}

function cancelText(): void {
	if (!state.textEditing) return;
	state.textEditing = false;
	state.textValue = '';
	state.editingTextIndex = null;
	ignoreBlur = false;
	repaint();
}

/**
 * 记录一次可撤销操作之前的状态。
 * 默认取当前选区与标注；ops 只做浅拷贝，标注对象本身始终按不可变方式使用。
 */
function pushHistory(sel: Rect | null = state.sel, ops: AnnotationOp[] = state.ops): void {
	state.history.push({ sel: sel ? { ...sel } : null, ops: ops.slice() });
	if (state.history.length > HISTORY_LIMIT) state.history.shift();
}

function undo(): void {
	// 输入中的文字先落地再撤销，撤销按钮点击不会因为 pointerdown 被拦截而丢字
	if (state.textEditing) commitText();
	const snapshot = state.history.pop();
	if (!snapshot) return;
	// 窗口尺寸可能在拖拽后被改过，恢复时再夹一次，避免选区跑到画面外
	state.sel = snapshot.sel
		? normalizeRect(
				clampToDisplay(snapshot.sel.x, snapshot.sel.y),
				clampToDisplay(snapshot.sel.x + snapshot.sel.w, snapshot.sel.y + snapshot.sel.h)
			)
		: null;
	state.ops = snapshot.ops.slice();
	repaint();
}

function onToolChange(tool: ToolType | null): void {
	// 切换工具时提交而不是丢弃正在输入的文字
	if (state.textEditing) commitText();
	state.tool = tool;
	// 只切回该工具的主体默认尺寸；颜色与描边参数跨工具保持，避免反复重设
	if (tool === 'text') state.width = TEXT_FONT_SIZE;
	else if (tool === 'mosaic') state.width = 8;
	else if (tool) state.width = 2;
	// 工具切换后指针样式交给 CSS，等下一次 pointermove 再按命中结果刷新
	setCursor('');
	repaint();
}

function onWidthChange(value: number): void {
	state.width = Math.max(MIN_SIZE, Math.round(value * 100) / 100);
}

function onStrokeWidthChange(value: number): void {
	// 手输框放行 0.1 起的任意值，这里再兜一次底
	state.strokeWidth = Math.max(MIN_SIZE, Math.round(value * 100) / 100);
}

function onStrokeColorChange(value: string): void {
	state.strokeColor = value;
}

function onStrokeEnabledChange(value: boolean): void {
	state.strokeEnabled = value;
}

function onFillEnabledChange(value: boolean): void {
	state.fillEnabled = value;
}

function onFillColorChange(value: string): void {
	state.fillColor = value;
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
	const prev = state.display;
	layout();
	const sel = state.sel;
	// 静帧是按窗口等比适配的，选区要跟着同一比例映射，才会继续盖住同一块画面内容
	if (sel && prev.w > 0 && prev.h > 0) {
		const k = state.display.w / prev.w;
		state.sel = {
			x: state.display.x + (sel.x - prev.x) * k,
			y: state.display.y + (sel.y - prev.y) * k,
			w: sel.w * k,
			h: sel.h * k
		};
	}
	repaint();
	// 输入框宽度随窗口变化后会重新折行，高度需跟着重算
	if (state.textEditing) void nextTick(syncTextSize);
}

function onKeyDown(event: KeyboardEvent): void {
	if (!state.visible) return;
	const target = event.target as HTMLElement | null;
	const tag = target?.tagName;
	const isField = tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable;
	if (event.key === 'Escape') {
		// 工具栏里的手输框 / 字号下拉：Esc 只退出输入，不关掉整个截图
		if (tag === 'INPUT' || tag === 'SELECT') {
			event.preventDefault();
			target?.blur();
			return;
		}
		event.preventDefault();
		if (state.textEditing) cancelText();
		else cancel();
		return;
	}
	// 输入框里的其它按键交给控件自己处理（如 Ctrl+Z 撤销输入、Enter 换行）
	if (isField) return;
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