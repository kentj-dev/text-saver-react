import { createRoot } from 'react-dom/client';
import '@fontsource/montserrat/latin-400.css';
import '@fontsource/montserrat/latin-500.css';
import '@fontsource/montserrat/latin-600.css';
import '@fontsource/montserrat/latin-700.css';
import App from './App';
import './index.css';

if (import.meta.env.DEV && !globalThis.chrome?.storage) {
  await import('./dev-chrome');
}

createRoot(document.getElementById('root')!).render(<App />);
