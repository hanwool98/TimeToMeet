import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import App from './App';
import AdminRoute from './components/AdminRoute';
import AdminApplicationErrorsPage from './pages/AdminApplicationErrorsPage';
import AdminApplicationsPage from './pages/AdminApplicationsPage';
import AdminCheckInPage from './pages/AdminCheckInPage';
import AdminContentPage from './pages/AdminContentPage';
import AdminConversationTopicsPage from './pages/AdminConversationTopicsPage';
import AdminEventCreatePage from './pages/AdminEventCreatePage';
import AdminEventLivePage from './pages/AdminEventLivePage';
import AdminEventPreparePage from './pages/AdminEventPreparePage';
import AdminEventModeHomePage from './pages/AdminEventModeHomePage';
import AdminEventManagementPage from './pages/AdminEventManagementPage';
import AdminEventParticipantsPage from './pages/AdminEventParticipantsPage';
import AdminFinalSelectionResultsPage from './pages/AdminFinalSelectionResultsPage';
import AdminFinalSelectionsPage from './pages/AdminFinalSelectionsPage';
import AdminPage from './pages/AdminPage';
import AdminPreroundSeatsPage from './pages/AdminPreroundSeatsPage';
import AdminTabletConnectPage from './pages/AdminTabletConnectPage';
import AdminTabletSeatPage from './pages/AdminTabletSeatPage';
import EmergencyProfileFormPage from './pages/EmergencyProfileFormPage';
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
import TicketDetailPage from './pages/TicketDetailPage';
import { getSupabaseDiagnostics } from './lib/supabase';
import { logClientError } from './services/supabaseApplications';
import './styles.css';

window.time2meetDiagnostics = getSupabaseDiagnostics;

// 신청서 제출 흐름 밖에서 발생하는(관리자 화면 포함) 예외를 잡아 못 잡은
// 채로 조용히 사라지는 대신 관리자 "오류 로그" 화면에서 볼 수 있게 하는
// 최소한의 전역 안전망. 각 화면에서 명시적으로 catch해서 자체 에러 문구를
// 보여주는 경우는 여기 안 걸리므로(이미 처리된 오류라 window까지 전파되지
// 않음), 그런 화면은 필요하면 catch 블록에서 logClientError를 직접 호출해야
// 한다.
window.addEventListener('error', (event) => {
  void logClientError('global:window-error', `${event.message} (${event.filename}:${event.lineno}:${event.colno})`);
});
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
  void logClientError('global:unhandled-rejection', reason);
});

// Registering a service worker (even one that does no caching) is required
// for Android Chrome/Samsung Internet to consider the app "installable" and
// offer 설치 instead of just a bookmark shortcut.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.error('Service worker registration failed', error);
    });
  });
}

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
            <Route path="/admin/application-errors" element={<AdminApplicationErrorsPage />} />
            <Route path="/admin/content" element={<AdminContentPage />} />
            <Route path="/admin/content/conversation-topics" element={<AdminConversationTopicsPage />} />
            <Route path="/admin/content/final-selections" element={<AdminFinalSelectionsPage />} />
            <Route path="/admin/content/final-selections/:eventId" element={<AdminFinalSelectionResultsPage />} />
            <Route path="/admin/applications" element={<AdminApplicationsPage />} />
            <Route path="/admin/events" element={<AdminEventManagementPage />} />
            <Route path="/admin/events/new" element={<AdminEventCreatePage />} />
            <Route path="/admin/event-mode" element={<AdminEventModeHomePage />} />
            <Route path="/admin/events/:eventId" element={<AdminEventParticipantsPage />} />
            <Route path="/admin/events/:eventId/edit" element={<AdminEventCreatePage />} />
            <Route path="/admin/events/:eventId/check-in" element={<AdminCheckInPage />} />
            <Route path="/admin/events/:eventId/prepare" element={<AdminEventPreparePage />} />
            <Route path="/admin/events/:eventId/prepare/seats" element={<AdminPreroundSeatsPage />} />
            <Route path="/admin/events/:eventId/live" element={<AdminEventLivePage />} />
          </Route>
          <Route path="/admin/events/:eventId/tablet-connect" element={<AdminTabletConnectPage />} />
          <Route path="/admin/events/:eventId/tablet/:tableNumber/seat" element={<AdminTabletSeatPage />} />
          <Route path="/event-info" element={<EventInfoPage />} />
          <Route path="/my-events" element={<MyEventsPage />} />
          <Route path="/my-events/payment/:invitationId" element={<PaymentPendingPage />} />
          <Route path="/my-events/ticket/:eventId" element={<TicketDetailPage />} />
          <Route path="/mypage" element={<MyPage />} />
          <Route path="/mypage/profile" element={<ParticipantProfilePage />} />
          <Route path="/profile/new" element={<ProfileFormPage />} />
          <Route path="/events/:eventId/apply/profile" element={<ProfileFormPage />} />
          <Route path="/application-complete" element={<ApplicationCompletePage />} />
          <Route path="/events/:eventId/emergency-apply" element={<EmergencyProfileFormPage />} />
          <Route path="/events/:eventId" element={<EventDetailPage />} />
          <Route path="/events/:eventId/info" element={<EventInfoPage />} />
          <Route path="/events/:eventId/mode" element={<EventModePage />} />
          <Route path="/profile-ready" element={<ProfileReadyPage />} />
        </Routes>
      </PaymentInvitationProvider>
    </BrowserRouter>
  </StrictMode>,
);
