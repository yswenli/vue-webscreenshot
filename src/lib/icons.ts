const wrap = (inner: string): string =>
	`<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** 工具栏图标，全部为内联 SVG，不依赖任何图标库 */
export const icons = {
	rect: wrap('<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'),
	ellipse: wrap('<ellipse cx="8" cy="8" rx="5.5" ry="4"/>'),
	arrow: wrap('<path d="M3 13 13 3"/><path d="M8.5 3H13v4.5"/>'),
	brush: wrap('<path d="M3 13.2 4.2 9.8l6.6-6.6a1.7 1.7 0 0 1 2.4 2.4l-6.6 6.6z"/><path d="M9.4 4.6l2.4 2.4"/>'),
	mosaic: wrap('<rect x="2.5" y="2.5" width="4.5" height="4.5"/><rect x="9" y="3" width="4.5" height="4.5"/><rect x="3" y="9" width="4.5" height="4.5"/><rect x="8.5" y="8.5" width="5" height="5"/>'),
	text: wrap('<path d="M3 3.5h10"/><path d="M8 3.5v9"/><path d="M5.5 12.5h5"/>'),
	undo: wrap('<path d="M3.2 6.6h6a3.6 3.6 0 0 1 0 7.2H6"/><path d="M5.8 3.7 2.9 6.6l2.9 2.9"/>'),
	download: wrap('<path d="M8 2.5v8"/><path d="M4.6 7.4 8 10.8l3.4-3.4"/><path d="M2.8 13.4h10.4"/>'),
	close: wrap('<path d="M4.2 4.2l7.6 7.6"/><path d="M11.8 4.2l-7.6 7.6"/>'),
	check: wrap('<path d="M3 8.6 6.4 12 13 4.6"/>')
};

export type IconName = keyof typeof icons;