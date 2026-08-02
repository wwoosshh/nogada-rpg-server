import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Capacitor 는 file:// 로 로드하므로 상대 경로가 필요하다 (Task 6)
  base: './',
  build: { outDir: 'dist' },
  server: { host: true, port: 5173 },
})
