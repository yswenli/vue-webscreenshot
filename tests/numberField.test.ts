import { describe, expect, it } from 'vitest';
import { nextTick, reactive } from 'vue';
import { clampSize, formatSize, parseSize, useNumberField } from '../src/lib/numberField';

type Field = ReturnType<typeof useNumberField>;

async function type(field: Field, raw: string): Promise<void> {
	field.onInput({ target: { value: raw } } as unknown as Event);
	await nextTick();
}

describe('parseSize', () => {
	it('clamps to the 0.1 minimum and rejects empty or invalid input', () => {
		expect(parseSize('0')).toBe(0.1);
		expect(parseSize('0.05')).toBe(0.1);
		expect(parseSize('')).toBeNull();
		expect(parseSize('   ')).toBeNull();
		expect(parseSize('abc')).toBeNull();
		expect(parseSize('0.333')).toBe(0.33);
		expect(clampSize(2)).toBe(2);
		expect(formatSize(0.30000000000000004)).toBe('0.3');
	});
});

describe('useNumberField', () => {
	it('keeps the draft while typing a sub-1 size instead of rewriting it to 0.1', async () => {
		const props = reactive({ width: 2 });
		const field = useNumberField(
			() => props.width,
			(value) => (props.width = value)
		);

		// 键盘依次键入 0 -> . -> 5，复现"0.1 被回写导致只能输入 0.15"的回归
		await type(field, '0');
		expect(field.draft.value).toBe('0');
		expect(props.width).toBe(0.1);

		await type(field, '0.');
		expect(field.draft.value).toBe('0.');

		await type(field, '0.5');
		expect(field.draft.value).toBe('0.5');
		expect(props.width).toBe(0.5);

		field.onCommit();
		expect(field.draft.value).toBe('0.5');
		expect(props.width).toBe(0.5);
	});

	it('normalises an over-precise draft on commit', async () => {
		const props = reactive({ width: 2 });
		const field = useNumberField(
			() => props.width,
			(value) => (props.width = value)
		);

		await type(field, '1.234');
		expect(field.draft.value).toBe('1.234');
		expect(props.width).toBe(1.23);

		field.onCommit();
		expect(field.draft.value).toBe('1.23');
	});

	it('still follows external resets (switching tools) after typing', async () => {
		const props = reactive({ width: 2 });
		const field = useNumberField(
			() => props.width,
			(value) => (props.width = value)
		);

		await type(field, '0');
		props.width = 8; // 例：切到马赛克，块大小回到 8
		await nextTick();
		expect(field.draft.value).toBe('8');
	});
});