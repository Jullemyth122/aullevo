import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { VaultGate } from './components/VaultGate'
import { LanguageChangedBar } from './components/language/LanguageChangedBar'
import { initI18n } from './i18n'

// Language loads first so the panel never flashes English
initI18n().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <VaultGate>
        <App />
      </VaultGate>
      <LanguageChangedBar />
    </StrictMode>,
  )
})
