import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { persistPlugin } from './persist-plugin.ts'

export default defineConfig({
  plugins: [react(), persistPlugin()],
  server: {
    host: true,
    port: 5173,
  },
})
