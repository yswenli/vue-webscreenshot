export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export type ToolType = 'rect' | 'ellipse' | 'arrow' | 'brush' | 'mosaic' | 'text';

interface BaseOp {
	type: ToolType;
	/** 描边或文字颜色 */
	color: string;
	/** 线宽、字号或马赛克块大小，单位 CSS 像素 */
	width: number;
}

export interface ShapeOp extends BaseOp {
	type: 'rect' | 'ellipse' | 'arrow' | 'mosaic';
	rect: Rect;
}

export interface BrushOp extends BaseOp {
	type: 'brush';
	points: Point[];
}

export interface TextOp extends BaseOp {
	type: 'text';
	x: number;
	y: number;
	text: string;
}

export type AnnotationOp = ShapeOp | BrushOp | TextOp;

/** 几何坐标始终是静帧像素，这里描述如何映射到当前绘制目标 */
export interface DrawOption {
	/** 静帧像素 -> 目标像素 */
	scale: number;
	/** CSS 像素 -> 目标像素 */
	widthScale: number;
	/** 静帧原点在目标画布上的位置 */
	offsetX: number;
	offsetY: number;
	/** 马赛克取样源，一般为静帧 canvas */
	source: CanvasImageSource | null;
}

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

let scratch: HTMLCanvasElement | null = null;

function getScratch(w: number, h: number): HTMLCanvasElement {
	if (!scratch) scratch = document.createElement('canvas');
	if (scratch.width !== w || scratch.height !== h) {
		scratch.width = w;
		scratch.height = h;
	}
	return scratch;
}

export function normalizeRect(a: Point, b: Point): Rect {
	return {
		x: Math.min(a.x, b.x),
		y: Math.min(a.y, b.y),
		w: Math.abs(a.x - b.x),
		h: Math.abs(a.y - b.y)
	};
}

export function drawOps(ctx: CanvasRenderingContext2D, ops: AnnotationOp[], opt: DrawOption): void {
	for (const op of ops) drawOp(ctx, op, opt);
}

function drawOp(ctx: CanvasRenderingContext2D, op: AnnotationOp, opt: DrawOption): void {
	if (op.type === 'mosaic') {
		drawMosaic(ctx, op, opt);
		return;
	}
	if (op.type === 'text') {
		drawText(ctx, op, opt);
		return;
	}
	if (op.type === 'brush') {
		drawBrush(ctx, op, opt);
		return;
	}
	drawShape(ctx, op, opt);
}

function drawShape(ctx: CanvasRenderingContext2D, op: ShapeOp, opt: DrawOption): void {
	const x = opt.offsetX + op.rect.x * opt.scale;
	const y = opt.offsetY + op.rect.y * opt.scale;
	const w = op.rect.w * opt.scale;
	const h = op.rect.h * opt.scale;
	const lineWidth = Math.max(1, op.width * opt.widthScale);
	ctx.save();
	ctx.strokeStyle = op.color;
	ctx.fillStyle = op.color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	if (op.type === 'rect') {
		ctx.strokeRect(x, y, w, h);
	} else if (op.type === 'ellipse') {
		ctx.beginPath();
		ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
		ctx.stroke();
	} else {
		const x2 = x + w;
		const y2 = y + h;
		ctx.beginPath();
		ctx.moveTo(x, y);
		ctx.lineTo(x2, y2);
		ctx.stroke();
		const angle = Math.atan2(y2 - y, x2 - x);
		const head = Math.max(10 * opt.widthScale, lineWidth * 3.5);
		ctx.beginPath();
		ctx.moveTo(x2, y2);
		ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 7), y2 - head * Math.sin(angle - Math.PI / 7));
		ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 7), y2 - head * Math.sin(angle + Math.PI / 7));
		ctx.closePath();
		ctx.fill();
	}
	ctx.restore();
}

function drawBrush(ctx: CanvasRenderingContext2D, op: BrushOp, opt: DrawOption): void {
	const points = op.points;
	if (!points.length) return;
	const lineWidth = Math.max(1, op.width * opt.widthScale);
	ctx.save();
	ctx.strokeStyle = op.color;
	ctx.fillStyle = op.color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	if (points.length === 1) {
		ctx.beginPath();
		ctx.arc(opt.offsetX + points[0].x * opt.scale, opt.offsetY + points[0].y * opt.scale, lineWidth / 2, 0, Math.PI * 2);
		ctx.fill();
		ctx.restore();
		return;
	}
	ctx.beginPath();
	ctx.moveTo(opt.offsetX + points[0].x * opt.scale, opt.offsetY + points[0].y * opt.scale);
	for (let i = 1; i < points.length; i++) {
		ctx.lineTo(opt.offsetX + points[i].x * opt.scale, opt.offsetY + points[i].y * opt.scale);
	}
	ctx.stroke();
	ctx.restore();
}

function drawText(ctx: CanvasRenderingContext2D, op: TextOp, opt: DrawOption): void {
	const fontPx = Math.max(6, op.width * opt.widthScale);
	const x = opt.offsetX + op.x * opt.scale;
	const y = opt.offsetY + op.y * opt.scale;
	ctx.save();
	ctx.fillStyle = op.color;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.font = `${fontPx}px ${FONT_FAMILY}`;
	op.text.split('\n').forEach((line, index) => {
		ctx.fillText(line, x, y + index * fontPx * 1.35);
	});
	ctx.restore();
}

function drawMosaic(ctx: CanvasRenderingContext2D, op: ShapeOp, opt: DrawOption): void {
	const x = opt.offsetX + op.rect.x * opt.scale;
	const y = opt.offsetY + op.rect.y * opt.scale;
	const w = op.rect.w * opt.scale;
	const h = op.rect.h * opt.scale;
	if (w < 1 || h < 1) return;
	const block = Math.max(2, op.width * opt.widthScale);
	const cols = Math.max(1, Math.round(w / block));
	const rows = Math.max(1, Math.round(h / block));
	const small = getScratch(cols, rows);
	const sctx = small.getContext('2d');
	if (!sctx) return;
	sctx.clearRect(0, 0, cols, rows);
	sctx.imageSmoothingEnabled = true;
	if (opt.source) {
		sctx.drawImage(opt.source, op.rect.x, op.rect.y, Math.max(1, op.rect.w), Math.max(1, op.rect.h), 0, 0, cols, rows);
	}
	ctx.save();
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(small, 0, 0, cols, rows, x, y, w, h);
	ctx.restore();
}

/** 按静帧像素裁剪选区并重放标注，返回可直接导出的 canvas */
export function renderSelection(frame: HTMLCanvasElement, ops: AnnotationOp[], sel: Rect, widthScale: number): HTMLCanvasElement {
	const sx = Math.max(0, Math.round(sel.x));
	const sy = Math.max(0, Math.round(sel.y));
	const sw = Math.max(1, Math.min(frame.width - sx, Math.round(sel.w)));
	const sh = Math.max(1, Math.min(frame.height - sy, Math.round(sel.h)));
	const out = document.createElement('canvas');
	out.width = sw;
	out.height = sh;
	const ctx = out.getContext('2d');
	if (!ctx) return out;
	ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, sw, sh);
	ctx.beginPath();
	ctx.rect(0, 0, sw, sh);
	ctx.clip();
	drawOps(ctx, ops, { scale: 1, widthScale, offsetX: -sx, offsetY: -sy, source: frame });
	return out;
}