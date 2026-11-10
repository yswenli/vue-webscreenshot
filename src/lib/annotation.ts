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

/** 以矩形表达的图形；矩形已归一化（w/h 非负），不携带方向 */
export interface RectShapeOp extends BaseOp {
	type: 'rect' | 'ellipse' | 'mosaic';
	rect: Rect;
}

/** 箭头必须保留起止顺序：归一化成矩形会丢掉方向，画出来会指向反方向 */
export interface ArrowOp extends BaseOp {
	type: 'arrow';
	from: Point;
	to: Point;
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
	/** 描边宽度，CSS 像素；缺省或 0 表示不描边 */
	strokeWidth?: number;
	/** 描边颜色，仅在 strokeWidth > 0 时生效 */
	strokeColor?: string;
}

export type AnnotationOp = RectShapeOp | ArrowOp | BrushOp | TextOp;

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

/** 文字标注字体族；输入框与画布共用，保证预览与成品一致 */
export const TEXT_FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
/** 文字标注默认字号，单位 CSS 像素 */
export const TEXT_FONT_SIZE = 12;
/** 文字标注行高倍数，画布换行与输入框行距共用 */
export const TEXT_LINE_HEIGHT_RATIO = 1.35;

let scratch: HTMLCanvasElement | null = null;

function getScratch(w: number, h: number): HTMLCanvasElement {
	if (!scratch) scratch = document.createElement('canvas');
	if (scratch.width !== w || scratch.height !== h) {
		scratch.width = w;
		scratch.height = h;
	}
	return scratch;
}

/** 平移一组标注。返回新对象，拖拽过程中需要反复从快照重算 */
export function translateOps(ops: AnnotationOp[], dx: number, dy: number): AnnotationOp[] {
	if (!dx && !dy) return ops.slice();
	return ops.map((op) => translateOp(op, dx, dy));
}

/** 以 anchor 为不动点缩放一组标注的坐标；线宽、字号保持不变 */
export function scaleOps(ops: AnnotationOp[], sx: number, sy: number, anchor: Point): AnnotationOp[] {
	if (sx === 1 && sy === 1) return ops.slice();
	return ops.map((op) => scaleOp(op, sx, sy, anchor));
}

function translatePoint(p: Point, dx: number, dy: number): Point {
	return { x: p.x + dx, y: p.y + dy };
}

function translateOp(op: AnnotationOp, dx: number, dy: number): AnnotationOp {
	switch (op.type) {
		case 'brush':
			return { ...op, points: op.points.map((p) => translatePoint(p, dx, dy)) };
		case 'arrow':
			return { ...op, from: translatePoint(op.from, dx, dy), to: translatePoint(op.to, dx, dy) };
		case 'text':
			return { ...op, x: op.x + dx, y: op.y + dy };
		default:
			return { ...op, rect: { ...op.rect, x: op.rect.x + dx, y: op.rect.y + dy } };
	}
}

function scalePoint(p: Point, sx: number, sy: number, anchor: Point): Point {
	return { x: anchor.x + (p.x - anchor.x) * sx, y: anchor.y + (p.y - anchor.y) * sy };
}

function scaleOp(op: AnnotationOp, sx: number, sy: number, anchor: Point): AnnotationOp {
	switch (op.type) {
		case 'brush':
			return { ...op, points: op.points.map((p) => scalePoint(p, sx, sy, anchor)) };
		case 'arrow':
			return {
				...op,
				from: scalePoint(op.from, sx, sy, anchor),
				to: scalePoint(op.to, sx, sy, anchor)
			};
		case 'text':
			return { ...op, x: anchor.x + (op.x - anchor.x) * sx, y: anchor.y + (op.y - anchor.y) * sy };
		default: {
			// 归一化矩形要重新映射对角两点；锚点那侧保持不动
			const a = { x: op.rect.x, y: op.rect.y };
			const b = { x: op.rect.x + op.rect.w, y: op.rect.y + op.rect.h };
			const pa = scalePoint(a, sx, sy, anchor);
			const pb = scalePoint(b, sx, sy, anchor);
			return { ...op, rect: normalizeRect(pa, pb) };
		}
	}
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
	switch (op.type) {
		case 'mosaic':
			drawMosaic(ctx, op, opt);
			return;
		case 'text':
			drawText(ctx, op, opt);
			return;
		case 'brush':
			drawBrush(ctx, op, opt);
			return;
		case 'arrow':
			drawArrow(ctx, op, opt);
			return;
		default:
			drawRectShape(ctx, op, opt);
	}
}

function drawRectShape(ctx: CanvasRenderingContext2D, op: RectShapeOp, opt: DrawOption): void {
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
	} else {
		ctx.beginPath();
		ctx.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 0.5), Math.max(h / 2, 0.5), 0, 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.restore();
}

/** 箭头张角的一半 */
const ARROW_HEAD_ANGLE = Math.PI / 7;

function drawArrow(ctx: CanvasRenderingContext2D, op: ArrowOp, opt: DrawOption): void {
	const x1 = opt.offsetX + op.from.x * opt.scale;
	const y1 = opt.offsetY + op.from.y * opt.scale;
	const x2 = opt.offsetX + op.to.x * opt.scale;
	const y2 = opt.offsetY + op.to.y * opt.scale;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const length = Math.hypot(dx, dy);
	if (length < 0.5) return;
	const lineWidth = Math.max(1, op.width * opt.widthScale);
	// 头部长度不超过箭杆的一半，否则短箭头的三角会翻出起点、画成反向
	const head = Math.min(Math.max(10 * opt.widthScale, lineWidth * 3.5), length * 0.5);
	const angle = Math.atan2(dy, dx);
	ctx.save();
	ctx.strokeStyle = op.color;
	ctx.fillStyle = op.color;
	ctx.lineWidth = lineWidth;
	ctx.lineCap = 'round';
	ctx.lineJoin = 'round';
	// 箭杆止于三角根部，避免粗线从尖端穿出
	ctx.beginPath();
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2 - head * Math.cos(angle), y2 - head * Math.sin(angle));
	ctx.stroke();
	ctx.beginPath();
	ctx.moveTo(x2, y2);
	ctx.lineTo(x2 - head * Math.cos(angle - ARROW_HEAD_ANGLE), y2 - head * Math.sin(angle - ARROW_HEAD_ANGLE));
	ctx.lineTo(x2 - head * Math.cos(angle + ARROW_HEAD_ANGLE), y2 - head * Math.sin(angle + ARROW_HEAD_ANGLE));
	ctx.closePath();
	ctx.fill();
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
	// 描边宽度与字号独立，同样随导出倍率放大，但不受选区缩放影响
	const strokePx = op.strokeWidth && op.strokeWidth > 0 ? Math.max(0.5, op.strokeWidth * opt.widthScale) : 0;
	const x = opt.offsetX + op.x * opt.scale;
	const y = opt.offsetY + op.y * opt.scale;
	ctx.save();
	ctx.fillStyle = op.color;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.font = `${fontPx}px ${TEXT_FONT_FAMILY}`;
	ctx.lineJoin = 'round';
	ctx.miterLimit = 2;
	op.text.split('\n').forEach((line, index) => {
		const lineY = y + index * fontPx * TEXT_LINE_HEIGHT_RATIO;
		if (strokePx > 0) {
			ctx.lineWidth = strokePx;
			ctx.strokeStyle = op.strokeColor || '#ffffff';
			ctx.strokeText(line, x, lineY);
		}
		ctx.fillText(line, x, lineY);
	});
	ctx.restore();
}

function drawMosaic(ctx: CanvasRenderingContext2D, op: RectShapeOp, opt: DrawOption): void {
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