<template>
	<div ref="rootRef" class="vws-tb" :style="posStyle" @pointerdown.stop.prevent @click.stop>
		<div class="vws-tb__bar">
			<button
				v-for="item in toolItems"
				:key="item.key"
				type="button"
				class="vws-tb__btn"
				:class="{ 'is-active': modelValue === item.key }"
				:title="item.title"
				v-html="icons[item.key]"
				@click="emit('update:modelValue', modelValue === item.key ? null : item.key)"
			/>
			<span class="vws-tb__sep" />
			<button type="button" class="vws-tb__btn" title="撤销 (Ctrl+Z)" :disabled="!canUndo" v-html="icons.undo" @click="emit('undo')" />
			<button type="button" class="vws-tb__btn" title="下载" v-html="icons.download" @click="emit('download')" />
			<button type="button" class="vws-tb__btn" title="取消 (Esc)" v-html="icons.close" @click="emit('cancel')" />
			<button type="button" class="vws-tb__btn is-primary" title="完成 (Enter)" v-html="icons.check" @click="emit('confirm')" />
		</div>
		<div v-if="modelValue" class="vws-tb__options">
			<!-- 主体大小：文字用下拉，其余一律手输 -->
			<span class="vws-tb__label">{{ sizeLabel }}</span>
			<select
				v-if="modelValue === 'text'"
				class="vws-tb__select"
				:value="String(width)"
				:title="`字号 ${width}px`"
				@pointerdown.stop
				@change="onFontSizeChange"
			>
				<option v-for="s in fontSizes" :key="s" :value="String(s)">{{ s }}</option>
			</select>
			<template v-else>
				<input
					class="vws-tb__num"
					type="number"
					min="0.1"
					step="0.1"
					inputmode="decimal"
					:value="sizeField.draft.value"
					:title="`${sizeLabel}，可直接输入`"
					@pointerdown.stop
					@input="sizeField.onInput"
					@change="sizeField.onCommit"
					@blur="sizeField.onCommit"
				/>
				<span class="vws-tb__unit">px</span>
			</template>

			<template v-if="modelValue !== 'mosaic'">
				<!-- 主体颜色 -->
				<span class="vws-tb__sep" />
				<span class="vws-tb__label">颜色</span>
				<input
					class="vws-tb__pick"
					type="color"
					:value="color"
					:title="`颜色 ${color}`"
					@pointerdown.stop
					@input="onColorPick"
				/>

				<!-- 描边：开关 + 手输宽度 + 颜色 -->
				<span class="vws-tb__sep" />
				<span class="vws-tb__label">描边</span>
				<button
					type="button"
					class="vws-tb__switch"
					:class="{ 'is-on': strokeEnabled }"
					role="switch"
					:aria-checked="strokeEnabled"
					:title="strokeEnabled ? '关闭描边' : '开启描边'"
					@click="emit('update:strokeEnabled', !strokeEnabled)"
				>
					<span class="vws-tb__knob" />
				</button>
				<template v-if="strokeEnabled">
					<input
						class="vws-tb__num"
						type="number"
						min="0.1"
						step="0.1"
						inputmode="decimal"
						:value="strokeField.draft.value"
						title="描边宽度，0.1px 起，可直接输入"
						@pointerdown.stop
						@input="strokeField.onInput"
						@change="strokeField.onCommit"
						@blur="strokeField.onCommit"
					/>
					<span class="vws-tb__unit">px</span>
					<input
						class="vws-tb__pick"
						type="color"
						:value="strokeColor"
						:title="`描边色 ${strokeColor}`"
						@pointerdown.stop
						@input="onStrokeColorPick"
					/>
				</template>
			</template>

			<!-- 矩形 / 椭圆：填充 -->
			<template v-if="showFill">
				<span class="vws-tb__sep" />
				<span class="vws-tb__label">填充</span>
				<button
					type="button"
					class="vws-tb__switch"
					:class="{ 'is-on': fillEnabled }"
					role="switch"
					:aria-checked="fillEnabled"
					:title="fillEnabled ? '关闭填充' : '开启填充'"
					@click="emit('update:fillEnabled', !fillEnabled)"
				>
					<span class="vws-tb__knob" />
				</button>
				<input
					v-if="fillEnabled"
					class="vws-tb__pick"
					type="color"
					:value="fillColor"
					:title="`填充色 ${fillColor}`"
					@pointerdown.stop
					@input="onFillColorPick"
				/>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { icons } from './icons';
import type { Rect, ToolType } from './annotation';

const props = defineProps<{
	modelValue: ToolType | null;
	/** 主体尺寸：图形线宽、文字字号或马赛克块大小 */
	width: number;
	/** 文字工具的字号下拉档位 */
	fontSizes: number[];
	/** 描边宽度，CSS 像素；0.1 起，手输 */
	strokeWidth: number;
	/** 描边颜色：文字外描边 / 图形线条外圈 */
	strokeColor: string;
	/** 是否绘制描边 */
	strokeEnabled: boolean;
	/** 矩形/椭圆是否开启填充 */
	fillEnabled: boolean;
	/** 矩形/椭圆的填充色 */
	fillColor: string;
	/** 主体颜色：文字颜色 / 图形线条色 */
	color: string;
	anchor: Rect;
	canUndo: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', value: ToolType | null): void;
	(e: 'update:width', value: number): void;
	(e: 'update:strokeWidth', value: number): void;
	(e: 'update:strokeColor', value: string): void;
	(e: 'update:strokeEnabled', value: boolean): void;
	(e: 'update:fillEnabled', value: boolean): void;
	(e: 'update:fillColor', value: string): void;
	(e: 'update:color', value: string): void;
	(e: 'undo'): void;
	(e: 'download'): void;
	(e: 'cancel'): void;
	(e: 'confirm'): void;
}>();

const toolItems: { key: ToolType; title: string }[] = [
	{ key: 'rect', title: '方框' },
	{ key: 'ellipse', title: '椭圆' },
	{ key: 'arrow', title: '箭头' },
	{ key: 'brush', title: '画笔' },
	{ key: 'mosaic', title: '马赛克' },
	{ key: 'text', title: '文字' }
];

const rootRef = ref<HTMLElement | null>(null);
const size = reactive({ w: 0, h: 0 });

const sizeLabel = computed(() => {
	if (props.modelValue === 'text') return '字号';
	if (props.modelValue === 'mosaic') return '块大小';
	return '大小';
});

const showFill = computed(() => props.modelValue === 'rect' || props.modelValue === 'ellipse');

function formatNumber(value: number): string {
	return String(Math.round(value * 100) / 100);
}

/**
 * 手输数字框：输入过程中允许出现空值 / 非法内容，失焦或回车时再纠正。
 * 主体尺寸与描边宽度共用这套逻辑，最小值统一 0.1px。
 */
function useNumberField(get: () => number, set: (value: number) => void) {
	const draft = ref(formatNumber(get()));

	watch(get, (value) => {
		const current = Number(draft.value);
		if (!Number.isFinite(current) || Math.abs(current - value) > 1e-6) draft.value = formatNumber(value);
	});

	function parse(raw: string): number | null {
		if (!raw.trim()) return null;
		const value = Number(raw);
		if (!Number.isFinite(value)) return null;
		return Math.max(0.1, Math.round(value * 100) / 100);
	}

	function onInput(event: Event): void {
		draft.value = (event.target as HTMLInputElement).value;
		const value = parse(draft.value);
		if (value !== null) set(value);
	}

	function onCommit(): void {
		const value = parse(draft.value);
		if (value === null) {
			draft.value = formatNumber(get());
			return;
		}
		draft.value = formatNumber(value);
		set(value);
	}

	return { draft, onInput, onCommit };
}

const sizeField = useNumberField(
	() => props.width,
	(value) => emit('update:width', value)
);
const strokeField = useNumberField(
	() => props.strokeWidth,
	(value) => emit('update:strokeWidth', value)
);

function onFontSizeChange(event: Event): void {
	emit('update:width', Number((event.target as HTMLSelectElement).value));
}

function onColorPick(event: Event): void {
	emit('update:color', (event.target as HTMLInputElement).value);
}

function onStrokeColorPick(event: Event): void {
	emit('update:strokeColor', (event.target as HTMLInputElement).value);
}

function onFillColorPick(event: Event): void {
	emit('update:fillColor', (event.target as HTMLInputElement).value);
}

function measure(): void {
	const el = rootRef.value;
	if (!el) return;
	size.w = el.offsetWidth;
	size.h = el.offsetHeight;
}

const posStyle = computed(() => {
	const { x, y, w, h } = props.anchor;
	const gap = 8;
	const vw = window.innerWidth;
	const vh = window.innerHeight;
	const tw = size.w || 310;
	const th = size.h || 38;
	let left = x + w - tw;
	let top = y + h + gap;
	if (top + th > vh - gap) top = y - gap - th;
	if (top < gap) top = y + h + gap;
	left = Math.min(Math.max(gap, left), Math.max(gap, vw - tw - gap));
	top = Math.min(Math.max(gap, top), Math.max(gap, vh - th - gap));
	return { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` };
});

watch(
	() => props.modelValue,
	() => nextTick(measure)
);

let observer: ResizeObserver | null = null;

onMounted(() => {
	measure();
	window.addEventListener('resize', measure);
	// 二级工具栏会随选项增减变宽变窄，用 ResizeObserver 跟着重算位置，避免贴边溢出
	if (typeof ResizeObserver !== 'undefined' && rootRef.value) {
		observer = new ResizeObserver(measure);
		observer.observe(rootRef.value);
	}
});

onUnmounted(() => {
	window.removeEventListener('resize', measure);
	observer?.disconnect();
	observer = null;
});
</script>

<style scoped>
.vws-tb {
	position: fixed;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 6px;
	font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
	user-select: none;
	-webkit-user-select: none;
}

.vws-tb__bar,
.vws-tb__options {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 4px;
	border-radius: 8px;
	background: #2b2b2b;
	box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
}

.vws-tb__options {
	gap: 6px;
	padding: 4px 8px;
	max-width: calc(100vw - 16px);
	flex-wrap: wrap;
	justify-content: flex-end;
	row-gap: 4px;
}

.vws-tb__btn {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border: none;
	border-radius: 5px;
	background: transparent;
	color: #f2f2f2;
	cursor: pointer;
}

.vws-tb__btn:hover {
	background: rgba(255, 255, 255, 0.14);
}

.vws-tb__btn.is-active {
	background: rgba(255, 255, 255, 0.26);
}

.vws-tb__btn.is-primary {
	background: #1677ff;
	color: #fff;
}

.vws-tb__btn.is-primary:hover {
	background: #3b8cff;
}

.vws-tb__btn:disabled {
	background: transparent;
	opacity: 0.38;
	cursor: default;
}

.vws-tb__btn :deep(svg) {
	display: block;
}

.vws-tb__sep {
	width: 1px;
	height: 18px;
	margin: 0 3px;
	background: rgba(255, 255, 255, 0.22);
}

.vws-tb__label {
	color: rgba(255, 255, 255, 0.62);
	font-size: 11px;
	line-height: 1;
	white-space: nowrap;
}

.vws-tb__switch {
	position: relative;
	width: 28px;
	height: 16px;
	padding: 0;
	border: none;
	border-radius: 8px;
	background: rgba(255, 255, 255, 0.24);
	cursor: pointer;
	transition: background 0.15s ease;
}

.vws-tb__switch.is-on {
	background: #1677ff;
}

.vws-tb__knob {
	position: absolute;
	top: 2px;
	left: 2px;
	width: 12px;
	height: 12px;
	border-radius: 50%;
	background: #fff;
	transition: transform 0.15s ease;
}

.vws-tb__switch.is-on .vws-tb__knob {
	transform: translateX(12px);
}

/* 尺寸 / 描边宽度手输框：0.1px 起，隐藏原生步进箭头省空间，方向键仍可微调 */
.vws-tb__num {
	width: 46px;
	height: 22px;
	padding: 0 4px;
	border: 1px solid rgba(255, 255, 255, 0.28);
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.08);
	color: #f2f2f2;
	font-size: 11px;
	line-height: 1;
	text-align: center;
	-moz-appearance: textfield;
	appearance: textfield;
}

.vws-tb__num:focus {
	outline: none;
	border-color: #1677ff;
	background: rgba(22, 119, 255, 0.18);
}

.vws-tb__num::-webkit-outer-spin-button,
.vws-tb__num::-webkit-inner-spin-button {
	-webkit-appearance: none;
	margin: 0;
}

/* 字号下拉：默认 12，暗色皮肤下选项也要可读 */
.vws-tb__select {
	height: 22px;
	padding: 0 2px;
	border: 1px solid rgba(255, 255, 255, 0.28);
	border-radius: 4px;
	background: rgba(255, 255, 255, 0.08);
	color: #f2f2f2;
	font-size: 11px;
	line-height: 1;
	cursor: pointer;
}

.vws-tb__select:focus {
	outline: none;
	border-color: #1677ff;
}

.vws-tb__select option {
	background: #2b2b2b;
	color: #f2f2f2;
}

.vws-tb__unit {
	margin-left: -3px;
	color: rgba(255, 255, 255, 0.5);
	font-size: 10px;
	line-height: 1;
}

/* 取色器：统一成小方块，点一下打开系统颜色面板 */
.vws-tb__pick {
	width: 24px;
	height: 22px;
	padding: 0;
	border: 1px solid rgba(255, 255, 255, 0.28);
	border-radius: 4px;
	background: transparent;
	cursor: pointer;
}

.vws-tb__pick:focus {
	outline: none;
	border-color: #1677ff;
}

.vws-tb__pick::-webkit-color-swatch-wrapper {
	padding: 2px;
}

.vws-tb__pick::-webkit-color-swatch {
	border: none;
	border-radius: 2px;
}

.vws-tb__pick::-moz-color-swatch {
	border: none;
	border-radius: 2px;
}
</style>