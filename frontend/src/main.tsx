import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UsageAdmin } from './UsageAdmin';
import './style.css';
createRoot(document.getElementById('root')!).render(window.location.pathname==='/admin'?<UsageAdmin />:<App />);
