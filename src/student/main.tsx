import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StudentApp } from './StudentApp';
import './student.css';

const container = document.getElementById('student-root');
if (!container) throw new Error('Missing #student-root element');

createRoot(container).render(
  <StrictMode>
    <StudentApp />
  </StrictMode>,
);
