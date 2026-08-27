// This file is the browser entry point. It creates React's root inside the
// <div id="root"> declared in index.html, then asks React to render the app.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// The `!` tells TypeScript that index.html is guaranteed to contain this element.
// StrictMode performs extra development-only checks; it does not add visible UI.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
