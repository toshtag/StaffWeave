import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { LocaleProvider } from './i18n/LocaleProvider.tsx';
import { SessionProvider } from './session/SessionProvider.tsx';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <SessionProvider>
        <App />
      </SessionProvider>
    </LocaleProvider>
  </StrictMode>,
);
