import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp';
import './admin.css';
import './fest/fest.css';

const container = document.getElementById('admin-root');
if (!container) throw new Error('Missing #admin-root element');

createRoot(container).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);

// The dashboard opens even with no signal (public/landing/sw.js keeps a copy of it on the phone).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/landing/sw.js', { scope: '/landing/' }).catch(() => undefined);
}
