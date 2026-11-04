import { resolve } from 'path';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import dts from 'vite-plugin-dts';

export default defineConfig({
	plugins: [
		vue(),
		dts({
			include: ['src/lib'],
			insertTypesEntry: true,
			tsconfigPath: resolve(__dirname, 'tsconfig.json')
		})
	],
	resolve: { dedupe: ['vue'] },
	build: {
		lib: {
			name: 'VueWebScreenshot',
			entry: resolve(__dirname, 'src/lib/main.ts'),
			fileName: (format) => `vue-webscreenshot.${format}.js`
		},
		cssCodeSplit: false,
		rollupOptions: {
			external: ['vue'],
			output: {
				globals: { vue: 'Vue' },
				assetFileNames: (asset) => (/\.css$/i.test(asset.name || '') ? 'vue-webscreenshot.css' : 'assets/[name][extname]')
			}
		}
	}
});