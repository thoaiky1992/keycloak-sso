import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import keycloak from './keycloak.js';
import './style.css';

const root = createRoot(document.getElementById('root'));

async function start() {
  try {
    // Initialize once before rendering React or a client-side router.
    await keycloak.init({
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      checkLoginIframe: false,
    });
    root.render(<App />);
  } catch (error) {
    console.error('Keycloak initialization failed', error);
    root.render(<p role="alert">Không thể kết nối tới Keycloak. Hãy kiểm tra máy chủ tại http://localhost:8080.</p>);
  }
}

start();
