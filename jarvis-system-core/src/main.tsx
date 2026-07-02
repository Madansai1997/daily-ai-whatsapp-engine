import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installFetchInterceptor } from './lib/auth';

// Install the auth fetch wrapper before anything renders so every request
// carries the in-memory token and 401s trip the re-lock.
installFetchInterceptor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
