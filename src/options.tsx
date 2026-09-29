// Full-page version of the side panel (chrome.runtime.openOptionsPage / "Extension options")
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { VaultGate } from './components/VaultGate'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <VaultGate>
      <App layout="page" />
    </VaultGate>
  </StrictMode>,
)
