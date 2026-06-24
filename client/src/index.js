import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import debugLog, { DEBUG_ENABLED } from './debugLog';
import { LanguageProvider } from './i18n';

debugLog('boot', 'app loading', {
  enabled: DEBUG_ENABLED,
  href: window.location.href,
  hasSession: !!localStorage.getItem('skipBoSession'),
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>
);
