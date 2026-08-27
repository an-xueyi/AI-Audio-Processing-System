import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite runs the development server and creates the optimized production build.
// The React plugin transforms JSX and enables React's development refresh support.
export default defineConfig({
  plugins: [react()],
})
