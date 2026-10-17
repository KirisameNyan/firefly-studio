import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root container is missing in index.html')

// Renderer-side errors must reach main.log: the harness reads that file, not devtools.
window.addEventListener('error', (event) => {
  console.error('[a4] window error: ' + event.message + ' @' + String(event.filename) + ':' + String(event.lineno))
})
window.addEventListener('unhandledrejection', (event) => {
  console.error('[a4] unhandled rejection: ' + String(event.reason))
})

// No StrictMode: it double-invokes effects in dev, which would duplicate the IPC round trips we
// use as deterministic evidence.
createRoot(container).render(<App />)
