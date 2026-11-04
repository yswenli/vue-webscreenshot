<template>
	<div class="demo">
		<header class="demo__bar">
			<h1>vue-webscreenshot</h1>
			<button class="demo__btn" @click="show = true">截图</button>
		</header>
		<main class="demo__body">
			<section class="demo__card">
				<h2>点右上角「截图」</h2>
				<p>会弹出系统共享授权框，选「此标签页」或「整个屏幕」后进入框选与标注。</p>
				<p>框选完成后工具栏出现在选区下方，标注工具在左，撤销/下载/取消/完成在右。</p>
			</section>
			<section class="demo__card demo__card--grid">
				<div v-for="i in 6" :key="i" class="demo__tile">
					<span>卡片 {{ i }}</span>
					<small>用于确认截图内容的清晰度</small>
				</div>
			</section>
			<table class="demo__table">
				<thead>
					<tr>
						<th>序号</th>
						<th>名称</th>
						<th>状态</th>
					</tr>
				</thead>
				<tbody>
					<tr v-for="i in 8" :key="i">
						<td>{{ i }}</td>
						<td>示例数据 {{ i }}</td>
						<td>{{ i % 2 ? '启用' : '停用' }}</td>
					</tr>
				</tbody>
			</table>
		</main>
		<WebScreenshot v-model:show="show" @success="onSuccess" @error="onError" @cancel="onCancel" />
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import WebScreenshot from './lib/App.vue';

const show = ref(false);

function onSuccess(payload: { mode: 'clipboard' | 'download'; blob: Blob }): void {
	console.log('[demo] success', payload.mode, payload.blob.size);
}

function onError(payload: { stage: string; message: string }): void {
	console.warn('[demo] error', payload.stage, payload.message);
}

function onCancel(): void {
	console.log('[demo] cancel');
}
</script>

<style>
body {
	margin: 0;
	background: #f5f6f8;
	font-family: system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
	color: #1f2329;
}

.demo__bar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 16px 24px;
	background: #fff;
	box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
}

.demo__bar h1 {
	margin: 0;
	font-size: 18px;
}

.demo__btn {
	padding: 8px 20px;
	border: none;
	border-radius: 6px;
	background: #1677ff;
	color: #fff;
	font-size: 14px;
	cursor: pointer;
}

.demo__body {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 24px;
}

.demo__card {
	padding: 20px;
	border-radius: 8px;
	background: #fff;
}

.demo__card h2 {
	margin: 0 0 8px;
	font-size: 15px;
}

.demo__card p {
	margin: 6px 0;
	font-size: 13px;
	color: #5c6470;
}

.demo__card--grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
	gap: 12px;
}

.demo__tile {
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 14px;
	border: 1px solid #e5e6eb;
	border-radius: 6px;
	font-size: 13px;
}

.demo__tile small {
	color: #8a919f;
}

.demo__table {
	width: 100%;
	border-collapse: collapse;
	border-radius: 8px;
	overflow: hidden;
	background: #fff;
	font-size: 13px;
}

.demo__table th,
.demo__table td {
	padding: 10px 14px;
	border-bottom: 1px solid #eef0f3;
	text-align: left;
}

.demo__table th {
	background: #fafbfc;
	font-weight: 500;
	color: #5c6470;
}
</style>