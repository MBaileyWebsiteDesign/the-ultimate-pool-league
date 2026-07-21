import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles.css';

// GitHub Pages is a static file host with no server-side rewrite rule to
// send an arbitrary deep link (e.g. /leagues/abc123) back to index.html, so
// a normal BrowserRouter 404s on refresh or on a direct/shared link once
// it's deployed there. The demo build (npm run build:demo - see
// vite.config.js/package.json) uses HashRouter instead, which keeps all
// routing state after a "#" and therefore never needs the server to know
// about any path but "/" - the real network build (npm start, serving
// client/dist itself) keeps normal clean URLs via BrowserRouter, since the
// Express server already has that catch-all route (see server/src/index.js).
const Router = import.meta.env.VITE_DEMO_MODE === 'true' ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
