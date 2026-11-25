import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bridge } from './lib/bridge';
import './theme.css';
import './styles/workspace.css';
import './styles/queue.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {bridge ? <App /> : <main className="content">Open the desktop app with <code>npm run dev</code>.</main>}
  </React.StrictMode>
);
