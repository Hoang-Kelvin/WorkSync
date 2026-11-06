import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/figtree';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import { App } from './App';
import { QuickSearch } from './quick';
import './styles/base.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

// The quick-search box is the same page in a small window of its own.
const quick = location.hash === '#quick';
if (quick) document.documentElement.classList.add('quick');

createRoot(container).render(
  <StrictMode>{quick ? <QuickSearch /> : <App />}</StrictMode>,
);
