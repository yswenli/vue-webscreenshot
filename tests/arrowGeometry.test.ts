import { describe, expect, it } from 'vitest';
import { arrowBodyHalf, arrowHeadHalf, computeArrowGeometry } from '../src/lib/annotation';

/** 箭头张角一半，与绘制实现保持一致 */
const HALF_ANGLE = Math.PI / 7;

describe('computeArrowGeometry', () => {
	it('returns null for a degenerate arrow', () => {
		expect(computeArrowGeometry({ x: 0, y: 0 }, { x: 0, y: 0 }, 2, 1, 'thin')).toBeNull();
		expect(computeArrowGeometry({ x: 0, y: 0 }, { x: 0.4, y: 0 }, 2, 1, 'wedge')).toBeNull();
	});

	it('thin: shaft stops at the head base and only the tip has a head', () => {
		const geometry = computeArrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 1, 'thin');
		expect(geometry).not.toBeNull();
		const shaft = geometry!.shaft!;
		// 头部长度取 max(10, 线宽 2 × 3.5) = 10，箭杆止于三角根部
		expect(shaft[0]).toEqual({ x: 0, y: 0 });
		expect(shaft[1].x).toBeCloseTo(90);
		expect(shaft[1].y).toBeCloseTo(0);
		expect(geometry!.tailHead).toBeNull();
		expect(geometry!.wedge).toBeNull();
		const [tip, left, right] = geometry!.head;
		expect(tip).toEqual({ x: 100, y: 0 });
		expect(left.x).toBeCloseTo(100 - 10 * Math.cos(HALF_ANGLE));
		expect(right.x).toBeCloseTo(100 - 10 * Math.cos(HALF_ANGLE));
		// 两翼关于箭杆轴对称，且一上一下
		expect(left.y).toBeCloseTo(-right.y);
		expect(Math.abs(left.y)).toBeGreaterThan(0);
	});

	it('double: both ends carry a head and the shaft is shortened twice', () => {
		const geometry = computeArrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 1, 'double')!;
		const shaft = geometry.shaft!;
		expect(shaft[0].x).toBeCloseTo(10);
		expect(shaft[1].x).toBeCloseTo(90);
		const head = geometry.head;
		const tailHead = geometry.tailHead!;
		expect(head[0]).toEqual({ x: 100, y: 0 });
		expect(tailHead[0]).toEqual({ x: 0, y: 0 });
		// 尾端三角朝反方向张开，两翼落在箭杆起始侧
		expect(tailHead[1].x).toBeCloseTo(10 * Math.cos(HALF_ANGLE));
		expect(tailHead[2].x).toBeCloseTo(10 * Math.cos(HALF_ANGLE));
		expect(tailHead[1].y).toBeCloseTo(-tailHead[2].y);
		expect(geometry.wedge).toBeNull();
	});

	it('wedge: thick shaft plus a wider triangular head, seven-point outline', () => {
		const geometry = computeArrowGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, 2, 1, 'wedge')!;
		expect(geometry.wedge).toHaveLength(7);
		expect(geometry.shaft).toBeNull();
		expect(geometry.tailHead).toBeNull();
		const body = arrowBodyHalf(2, 1);
		const barb = arrowHeadHalf(2, 1);
		expect(body).toBe(2);
		expect(barb).toBe(5);
		const [tailTop, shaftTop, headTop, tip, headBottom, shaftBottom, tailBottom] = geometry.wedge!;
		expect(tailTop).toEqual({ x: 0, y: body });
		expect(tailBottom).toEqual({ x: 0, y: -body });
		// 头部从根部 90 处向外张开到 barb
		expect(headTop).toEqual({ x: 90, y: barb });
		expect(headBottom).toEqual({ x: 90, y: -barb });
		expect(tip).toEqual({ x: 100, y: 0 });
		expect(shaftTop.x).toBeCloseTo(shaftBottom.x);
		expect(shaftTop.y).toBeCloseTo(body);
	});

	it('caps the head on short arrows so the wings never cross the opposite end', () => {
		const geometry = computeArrowGeometry({ x: 0, y: 0 }, { x: 6, y: 0 }, 2, 1, 'double')!;
		const shaft = geometry.shaft!;
		// 头部长度被压到长度一半，两个三角在中点会合
		expect(shaft[0].x).toBeCloseTo(3);
		expect(shaft[1].x).toBeCloseTo(3);
		expect(geometry.head[1].x).toBeGreaterThan(shaft[1].x);
		expect(geometry.tailHead![1].x).toBeLessThan(shaft[0].x);
	});

	it('keeps the wedge head from ballooning on a very short arrow', () => {
		const geometry = computeArrowGeometry({ x: 0, y: 0 }, { x: 5, y: 0 }, 2, 1, 'wedge')!;
		const halfWidth = Math.max(...geometry.wedge!.map((point) => Math.abs(point.y)));
		expect(halfWidth).toBeLessThanOrEqual(arrowBodyHalf(2, 1) + 1e-9);
	});
});