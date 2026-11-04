import React from 'react';
import { createRoot } from 'react-dom/client';
import SportsballDashboard from './SportsballDashboard.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SportsballDashboard />
  </React.StrictMode>
);
