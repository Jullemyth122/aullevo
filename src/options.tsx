// Full-page version of the side panel (chrome.runtime.openOptionsPage / "Extension options")
// options.html#microphone asks for microphone access for voice mode (the side panel can't show that prompt)
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { VaultGate } from './components/VaultGate'
import { LanguageChangedBar } from './components/language/LanguageChangedBar'
import { initI18n } from './i18n'
import { MicrophoneSetup } from './voice/MicrophoneSetup'

if (location.hash === '#microphone') {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MicrophoneSetup />
    </StrictMode>,
  )
} else {
  initI18n().then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <VaultGate>
          <App layout="page" />
        </VaultGate>
        <LanguageChangedBar />
      </StrictMode>,
    )
  })
}
