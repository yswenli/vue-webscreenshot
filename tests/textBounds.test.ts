import { describe, expect, it } from 'vitest';
import { TEXT_LINE_HEIGHT_RATIO, textBounds } from '../src/lib/annotation';
import type { TextMeasurer, TextOp } from '../src/lib/annotation';

const base: TextOp = {
	type: 'text',
	x: 120,
	y: 240,
	width: 12,
	color: '#ff4d4f',
	strokeWidth: 0,
	strokeColor: '#ffffff',
	text: 'abcd\nef'
};

/** 固定宽度测量，避免测试依赖真实字体度量 */
const fakeMeasure: TextMeasurer = (text, fontPx) => text.length * fontPx;

describe('textBounds', () => {
	it('measures in frame pixels and scales with the display ratio', () => {
		const css = textBounds(base, 1, fakeMeasure);
		const hidpi = textBounds(base, 2, fakeMeasure);

		expect(css.w).toBe(4 * 12);
		expect(css.h).toBeCloseTo(2 * 12 * TEXT_LINE_HEIGHT_RATIO);
		expect(css.x).toBe(base.x);
		expect(css.y).toBe(base.y);

		expect(hidpi.w).toBe(4 * 24);
		expect(hidpi.h).toBeCloseTo(2 * 24 * TEXT_LINE_HEIGHT_RATIO);
		// 回归：命中盒以前没乘 frameRatio，高倍屏上只有左上角一小块能点中
		expect(hidpi.w / css.w).toBe(2);
	});
});