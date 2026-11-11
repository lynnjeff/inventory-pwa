import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AppProvider } from './lib/AppContext'
import './index.css'

// Clickjacking fallback for hosts that do not apply the frame-ancestors header.
if (window.top && window.top !== window.self) {
  document.documentElement.style.display = 'none'
  try { window.top.location.href = window.self.location.href } catch { /* cross-origin: stay hidden */ }
}

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
)
