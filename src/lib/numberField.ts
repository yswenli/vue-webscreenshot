import { ref, watch } from 'vue';

/** 主体尺寸与描边宽度下限，单位 CSS 像素 */
export const MIN_SIZE = 0.1;

/** 统一保留两位小数，避免 0.1 + 0.2 之类的浮点尾巴 */
export function formatSize(value: number): string {
	return String(Math.round(value * 100) / 100);
}

/** 解析手输尺寸；空值 / 非法内容返回 null，其余夹到 0.1 起并保留两位小数 */
export function parseSize(raw: string): number | null {
	if (!raw.trim()) return null;
	const value = Number(raw);
	if (!Number.isFinite(value)) return null;
	return clampSize(value);
}

export function clampSize(value: number): number {
	return Math.max(MIN_SIZE, Math.round(value * 100) / 100);
}

/**
 * 手输数字框：输入过程中允许出现空值 / 非法内容，失焦或回车时再纠正。
 * 主体尺寸与描边宽度共用这套逻辑，最小值统一 0.1px。
 *
 * 输入时不能把「自己 emit 出去、又被父组件写回」的值当成外部变更来同步：
 * 键入 `0` 会先被夹到 0.1，如果立刻用 0.1 覆盖草稿，后续字符就会拼成
 * `0.1.5` 这种非法内容，导致 0.1~0.9 的尺寸无法输入。
 */
export function useNumberField(get: () => number, set: (value: number) => void) {
	const draft = ref(formatSize(get()));
	/** 最近一次由本控件写出去的值；父组件回写同一个值时视为回声，不覆盖草稿 */
	let pendingEcho: number | null = null;

	watch(get, (value) => {
		const echo = pendingEcho !== null && Math.abs(value - pendingEcho) < 1e-6;
		pendingEcho = null;
		if (echo) return;
		draft.value = formatSize(value);
	});

	function apply(value: number): void {
		pendingEcho = value;
		set(value);
	}

	function onInput(event: Event): void {
		draft.value = (event.target as HTMLInputElement).value;
		const value = parseSize(draft.value);
		if (value !== null) apply(value);
	}

	function onCommit(): void {
		const value = parseSize(draft.value);
		if (value === null) {
			draft.value = formatSize(get());
			return;
		}
		draft.value = formatSize(value);
		apply(value);
	}

	return { draft, onInput, onCommit };
}