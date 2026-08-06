import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import EventDetailPage from './pages/EventDetailPage';
import EventInfoPage from './pages/EventInfoPage';
import LoginPage from './pages/LoginPage';
import ApplicationCompletePage from './pages/ApplicationCompletePage';
import ProfileFormPage from './pages/ProfileFormPage';
import ProfileReadyPage from './pages/ProfileReadyPage';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile/new" element={<ProfileFormPage />} />
        <Route path="/application-complete" element={<ApplicationCompletePage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route path="/events/:eventId/info" element={<EventInfoPage />} />
        <Route path="/profile-ready" element={<ProfileReadyPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
