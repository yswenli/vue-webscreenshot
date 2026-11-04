# vue-webscreenshot

A Pure Web-Based Screenshot Tool Built with Vue 3. 基于 Vue 3 的纯网页截图与标注组件。

抓屏、框选、标注、一键复制到剪贴板，全部在浏览器里完成，不上传、不落库。标注工具对齐微信截图：方框、椭圆、箭头、画笔、马赛克、文字，支持撤销与二级工具栏（粗细 + 颜色）。

## 环境要求

- 仅支持 **Chromium 系**浏览器（Chrome / Edge / 360 极速模式）。Firefox、Safari 未做适配。
- 必须是安全上下文：`https` 或 `localhost` / `127.0.0.1`。局域网 IP 的 `http` 页面浏览器会直接禁用抓屏。
- 每次点开都会弹一次系统共享授权框，由用户选择「此标签页 / 窗口 / 整个屏幕」。选整个屏幕时，抓到的画面会带桌面与浏览器边框，需要自己框掉——这是浏览器机制，不是组件缺陷。

## 安装

```bash
npm install vue-webscreenshot --save
```

样式是独立产物，**必须**显式引入，否则看到的是无样式的裸控件：

```ts
import 'vue-webscreenshot/css';
```

## 最简单例子

```vue
<template>
	<button @click="show = true">截图</button>
	<WebScreenshot v-model:show="show" @success="onSuccess" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import WebScreenshot from 'vue-webscreenshot';
import 'vue-webscreenshot/css';

const show = ref(false);

function onSuccess(payload: { mode: 'clipboard' | 'download'; blob: Blob }) {
	// mode === 'clipboard'：已写入剪贴板，直接 Ctrl+V 就能粘
	// mode === 'download'：浏览器不支持复制图片，组件已自动改为下载
	console.log(payload.mode, payload.blob);
	show.value = false;
}
</script>
```

## Props

| 名称 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `show` | `boolean` | — | 置 `true` 开始抓屏并进入编辑；组件内部结束后会 `emit('update:show', false)`，支持 `v-model:show` |
| `z-index` | `number` | `3000` | 遮罩层级，宿主有更高浮层时上调 |
| `file-name` | `string` | `网页截图` | 下载文件名前缀，最终文件名形如 `网页截图-20261104-153000.png` |

## Events

| 名称 | 参数 | 说明 |
| --- | --- | --- |
| `update:show` | `boolean` | 组件结束（完成/取消/异常）后置 `false` |
| `success` | `{ mode: 'clipboard' \| 'download'; blob: Blob }` | 点「完成」。`mode` 表示实际写入剪贴板还是降级下载 |
| `download` | `{ blob: Blob }` | 点工具栏「下载」，此时工具不关闭，可继续复制 |
| `cancel` | — | 点「取消」、按 `Esc`，或用户拒绝屏幕共享授权 |
| `error` | `{ stage: 'unsupported' \| 'capture' \| 'clipboard'; message: string }` | 环境不支持抓屏、抓屏失败、出图失败 |

## 操作

| 操作 | 说明 |
| --- | --- |
| 拖拽 | 框选截图区域；定稿后在选区内拖拽进行标注 |
| `Esc` | 有文字输入框时先关输入框，否则取消并关闭 |
| `Ctrl / Cmd + Z` | 撤销最后一条标注 |
| `Enter` | 等同「完成」；文字输入状态下提交这段文字 |
| `Shift + Enter` | 文字输入状态下换行，支持多行标注 |

工具栏：`方框｜椭圆｜箭头｜画笔｜马赛克｜文字 ｜ 撤销｜下载｜取消｜完成`。选中绘图工具后展开二级工具栏：图形/画笔给粗细三档与六色色板，马赛克只给块大小，文字只给颜色。默认红色 2px。

文字输入框会随内容自动增高，提交后按输入框内的实际排版落字（含换行），位置与输入框里看到的一致，不会跳位；点击画布其它位置、切换工具、撤销/下载/完成都会先提交正在输入的文字。箭头保留拖拽方向，八个方向都指向你松开鼠标的位置。

## 已知限制

- 不做窗口/元素自动吸附，不做放大镜、取色器、滚动长截图。
- 标注不可二次编辑（不能选中、拖动、单独删除），只有整体撤销。
- 标注统一裁在选区内，文字超过选区下边缘的部分会被裁掉。
- 框选定稿后不能拖边角调整大小，要重框请点取消重新进入。
- 抓屏内容是用户授权共享的画面，不保证等于当前页面。

## 本地开发

```bash
npm install
npm run dev     # 打开 index.html 里的演示页
npm run build   # vue-tsc 类型检查 + 产出 dist
```

## License

MIT