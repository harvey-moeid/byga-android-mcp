import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: 'apps/dashboard', plugins: [react()], build: { outDir: '../../dist/dashboard', emptyOutDir: true } });
