import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import AdminRoute from './components/AdminRoute';
import AdminApplicationsPage from './pages/AdminApplicationsPage';
import AdminCheckInPage from './pages/AdminCheckInPage';
import AdminEventCreatePage from './pages/AdminEventCreatePage';
import AdminEventManagementPage from './pages/AdminEventManagementPage';
import AdminEventParticipantsPage from './pages/AdminEventParticipantsPage';
import AdminPage from './pages/AdminPage';
import EventDetailPage from './pages/EventDetailPage';
import EventInfoPage from './pages/EventInfoPage';
import EventModePage from './pages/EventModePage';
import GuestPhoneAuthPage from './pages/GuestPhoneAuthPage';
import LoginPage from './pages/LoginPage';
import ApplicationCompletePage from './pages/ApplicationCompletePage';
import MyEventsPage from './pages/MyEventsPage';
import MyPage from './pages/MyPage';
import PaymentInvitationProvider from './components/PaymentInvitationProvider';
import PaymentPendingPage from './pages/PaymentPendingPage';
import ParticipantProfilePage from './pages/ParticipantProfilePage';
import ProfileFormPage from './pages/ProfileFormPage';
import ProfileReadyPage from './pages/ProfileReadyPage';
import { getSupabaseDiagnostics } from './lib/supabase';
import './styles.css';

window.time2meetDiagnostics = getSupabaseDiagnostics;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <PaymentInvitationProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/guest-phone" element={<GuestPhoneAuthPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/applications" element={<AdminApplicationsPage />} />
            <Route path="/admin/events" element={<AdminEventManagementPage />} />
            <Route path="/admin/events/new" element={<AdminEventCreatePage />} />
            <Route path="/admin/events/:eventId" element={<AdminEventParticipantsPage />} />
            <Route path="/admin/events/:eventId/edit" element={<AdminEventCreatePage />} />
            <Route path="/admin/events/:eventId/check-in" element={<AdminCheckInPage />} />
          </Route>
          <Route path="/event-info" element={<EventInfoPage />} />
          <Route path="/my-events" element={<MyEventsPage />} />
          <Route path="/my-events/payment/:invitationId" element={<PaymentPendingPage />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/mypage/profile" element={<ParticipantProfilePage />} />
          <Route path="/profile/new" element={<ProfileFormPage />} />
          <Route path="/application-complete" element={<ApplicationCompletePage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/info" element={<EventInfoPage />} />
          <Route path="/events/:eventId/mode" element={<EventModePage />} />
          <Route path="/profile-ready" element={<ProfileReadyPage />} />
        </Routes>
      </PaymentInvitationProvider>
    </BrowserRouter>
  </StrictMode>,
);
