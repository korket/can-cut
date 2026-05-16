import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { startRendererExportDelegate } from './media-engine/rendererExportDelegate'

const root = ReactDOM.createRoot(document.getElementById('root')!)
const isExportWorker = new URLSearchParams(window.location.search).get('exportWorker') === '1'

if (isExportWorker) {
  startRendererExportDelegate()
  root.render(null)
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
