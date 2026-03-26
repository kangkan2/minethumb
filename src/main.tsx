import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Prevent "Cannot set property fetch of #<Window> which has only a getter" error
if (typeof window !== 'undefined') {
  try {
    const originalFetch = window.fetch;
    Object.defineProperty(window, 'fetch', {
      get: () => originalFetch,
      set: () => { console.warn('Something tried to overwrite window.fetch - ignored.'); },
      configurable: true
    });
  } catch (e) {
    console.warn('Could not define fetch property:', e);
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
