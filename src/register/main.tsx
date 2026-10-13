import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RegisterApp } from './RegisterApp';
import './register.css';

const container = document.getElementById('register-root');
if (!container) throw new Error('Missing #register-root element');
createRoot(container).render(
  <StrictMode>
    <RegisterApp />
  </StrictMode>,
);
