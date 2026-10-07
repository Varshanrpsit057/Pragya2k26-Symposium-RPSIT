import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AdminApp } from './AdminApp';
import './admin.css';

const container = document.getElementById('admin-root');
if (!container) throw new Error('Missing #admin-root element');

createRoot(container).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
