import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PresenterConsole } from './components/PresenterConsole';
import { isConsolePage } from './lib/presenterLink';
import './styles.css';
import '@xyflow/react/dist/style.css';

// The presenter's console (F-019) is this app asked to be the console: it follows a presentation and
// edits nothing, so none of the editor is mounted — not its shortcuts, not its workspace.
const consolePage = isConsolePage(window.location.search);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {consolePage ? <PresenterConsole /> : <App />}
  </React.StrictMode>
);
