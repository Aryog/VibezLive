// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', hmr: { host: 'marshall-mold-baseball-tigers.trycloudflare.com', protocol: 'wss', clientPort: 443 } }
})