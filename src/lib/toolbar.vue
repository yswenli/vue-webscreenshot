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
			<template v-if="showWidths">
				<button
					v-for="w in widths"
					:key="w"
					type="button"
					class="vws-tb__dot"
					:class="{ 'is-active': width === w }"
					:title="`粗细 ${w}`"
					@click="emit('update:width', w)"
				>
					<span :style="dotStyle(w)" />
				</button>
			</template>
			<template v-if="showSizes">
				<button
					v-for="s in fontSizes"
					:key="s"
					type="button"
					class="vws-tb__size"
					:class="{ 'is-active': width === s }"
					:title="`字号 ${s}`"
					@click="emit('update:width', s)"
				>
					{{ s }}
				</button>
			</template>
			<span v-if="(showWidths || showSizes) && showColors" class="vws-tb__sep" />
			<template v-if="showColors">
				<button
					v-for="c in colors"
					:key="c"
					type="button"
					class="vws-tb__color"
					:class="{ 'is-active': color === c }"
					:title="c"
					@click="emit('update:color', c)"
				>
					<span :style="{ background: c }" />
				</button>
			</template>
			<template v-if="showStroke">
				<span class="vws-tb__sep" />
				<span class="vws-tb__label">描边</span>
				<button
					v-for="w in strokeWidths"
					:key="`stroke-${w}`"
					type="button"
					class="vws-tb__dot"
					:class="{ 'is-active': strokeWidth === w }"
					:title="w > 0 ? `描边 ${w}px` : '无描边'"
					@click="emit('update:strokeWidth', w)"
				>
					<span :style="strokeDotStyle(w)" />
				</button>
				<template v-if="strokeWidth > 0">
					<button
						v-for="c in strokeColors"
						:key="`stroke-color-${c}`"
						type="button"
						class="vws-tb__color"
						:class="{ 'is-active': strokeColor === c }"
						:title="`描边色 ${c}`"
						@click="emit('update:strokeColor', c)"
					>
						<span :style="{ background: c }" />
					</button>
				</template>
			</template>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { icons } from './icons';
import type { Rect, ToolType } from './annotation';

const COLORS = ['#ff4d4f', '#ffd400', '#22c55e', '#1677ff', '#111111', '#ffffff'];

const props = defineProps<{
	modelValue: ToolType | null;
	width: number;
	widths: number[];
	/** 文字工具的字号档位 */
	fontSizes: number[];
	/** 文字描边宽度档位；0 表示不描边 */
	strokeWidths: number[];
	/** 文字描边颜色档位 */
	strokeColors: string[];
	/** 文字描边宽度 */
	strokeWidth: number;
	/** 文字描边颜色 */
	strokeColor: string;
	color: string;
	anchor: Rect;
	canUndo: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', value: ToolType | null): void;
	(e: 'update:width', value: number): void;
	(e: 'update:strokeWidth', value: number): void;
	(e: 'update:strokeColor', value: string): void;
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

const colors = COLORS;

const rootRef = ref<HTMLElement | null>(null);
const size = reactive({ w: 0, h: 0 });

const showWidths = computed(() => !!props.modelValue && props.modelValue !== 'text');
const showSizes = computed(() => props.modelValue === 'text');
const showColors = computed(() => !!props.modelValue && props.modelValue !== 'mosaic');
const showStroke = computed(() => props.modelValue === 'text');

function dotStyle(width: number): Record<string, string> {
	const d = Math.max(5, Math.min(14, width * 1.5));
	return { width: `${d}px`, height: `${d}px` };
}

/** 描边粗细用实心圆表示，0 档画成空心圆表示「无描边」 */
function strokeDotStyle(width: number): Record<string, string> {
	if (width <= 0) {
		return {
			width: '8px',
			height: '8px',
			background: 'transparent',
			boxShadow: 'inset 0 0 0 1px #fff'
		};
	}
	const d = Math.max(8, Math.min(12, width + 6));
	return { width: `${d}px`, height: `${d}px` };
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

.vws-tb__dot {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 24px;
	height: 24px;
	padding: 0;
	border: none;
	border-radius: 4px;
	background: transparent;
	cursor: pointer;
}

.vws-tb__dot span {
	display: block;
	border-radius: 50%;
	background: #fff;
}

.vws-tb__dot.is-active {
	background: rgba(255, 255, 255, 0.22);
}

.vws-tb__size {
	display: flex;
	align-items: center;
	justify-content: center;
	min-width: 24px;
	height: 24px;
	padding: 0 4px;
	border: none;
	border-radius: 4px;
	background: transparent;
	color: #f2f2f2;
	font-size: 12px;
	line-height: 1;
	cursor: pointer;
}

.vws-tb__size:hover {
	background: rgba(255, 255, 255, 0.14);
}

.vws-tb__size.is-active {
	background: rgba(255, 255, 255, 0.26);
}

.vws-tb__label {
	color: rgba(255, 255, 255, 0.62);
	font-size: 11px;
	line-height: 1;
	white-space: nowrap;
}

.vws-tb__color {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	padding: 0;
	border: none;
	border-radius: 50%;
	background: transparent;
	cursor: pointer;
}

.vws-tb__color span {
	display: block;
	width: 14px;
	height: 14px;
	border-radius: 50%;
	box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5);
}

.vws-tb__color.is-active {
	box-shadow: 0 0 0 2px #fff;
}
</style>