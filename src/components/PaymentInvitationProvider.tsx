import { createContext, type MutableRefObject, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  dismissPaymentInvitation,
  fetchMyPaymentInvitations,
  markPaymentInvitationRead,
  type PaymentInvitation,
  subscribeToPaymentInvitationChanges,
} from '../services/supabaseApplications';
import { getAppSession } from '../services/appAuth';

interface PaymentInvitationContextValue {
  invitations: PaymentInvitation[];
  unreadCount: number;
  markRead: (invitationId: string) => Promise<void>;
  reload: () => Promise<void>;
}

const PaymentInvitationContext = createContext<PaymentInvitationContextValue | null>(null);

export function usePaymentInvitations() {
  const context = useContext(PaymentInvitationContext);
  if (!context) {
    return {
      invitations: [],
      markRead: async () => undefined,
      reload: async () => undefined,
      unreadCount: 0,
    };
  }
  return context;
}

export default function PaymentInvitationProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [invitations, setInvitations] = useState<PaymentInvitation[]>([]);
  const [activeInvitation, setActiveInvitation] = useState<PaymentInvitation | null>(null);
  const [sessionKey, setSessionKey] = useState(() => getSessionKey());
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const loadingRef = useRef(false);

  const reload = useCallback(async () => {
    const nextSessionKey = getSessionKey();
    setSessionKey(nextSessionKey);
    if (!nextSessionKey || loadingRef.current) {
      if (!nextSessionKey) setInvitations([]);
      return;
    }

    loadingRef.current = true;
    try {
      const nextInvitations = await fetchMyPaymentInvitations();
      setInvitations(nextInvitations);
      setActiveInvitation((current) => {
        if (current && nextInvitations.some((item) => item.id === current.id && !item.readAt)) return current;
        return nextInvitations.find((item) => !item.readAt && !item.dismissedAt) ?? null;
      });
    } catch (error) {
      console.error('Payment invitation reload failed', error);
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void reload();
    const unsubscribe = subscribeToPaymentInvitationChanges(() => {
      void reload();
    });
    const intervalId = window.setInterval(() => {
      void reload();
    }, 8_000);
    const handleFocus = () => void reload();
    const handleSessionChange = () => void reload();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void reload();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    window.addEventListener('time2meet:app-session-changed', handleSessionChange);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsubscribe();
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      window.removeEventListener('time2meet:app-session-changed', handleSessionChange);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [reload, sessionKey]);

  useEffect(() => {
    if (!activeInvitation) return;

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => dialogRef.current?.focus(), 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        void dismiss(activeInvitation);
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((element) => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [activeInvitation]);

  const markRead = useCallback(async (invitationId: string) => {
    await markPaymentInvitationRead(invitationId);
    setInvitations((current) => current.map((item) => (item.id === invitationId ? { ...item, readAt: new Date().toISOString() } : item)));
    setActiveInvitation((current) => (current?.id === invitationId ? null : current));
    await reload();
  }, [reload]);

  const dismiss = useCallback(async (invitation: PaymentInvitation) => {
    setActiveInvitation(null);
    setInvitations((current) => current.map((item) => (item.id === invitation.id ? { ...item, dismissedAt: new Date().toISOString() } : item)));
    try {
      await dismissPaymentInvitation(invitation.id);
      await reload();
    } catch (error) {
      console.error('Payment invitation dismiss failed', error);
    }
  }, [reload]);

  const confirm = useCallback(async (invitation: PaymentInvitation) => {
    await markRead(invitation.id);
    navigate('/my-events');
  }, [markRead, navigate]);

  const value = useMemo(
    () => ({
      invitations,
      markRead,
      reload,
      unreadCount: invitations.filter((item) => !item.readAt).length,
    }),
    [invitations, markRead, reload],
  );

  return (
    <PaymentInvitationContext.Provider value={value}>
      {children}
      {activeInvitation ? (
        <InvitationModal
          invitation={activeInvitation}
          onConfirm={() => void confirm(activeInvitation)}
          onDismiss={() => void dismiss(activeInvitation)}
          refTarget={dialogRef}
        />
      ) : null}
    </PaymentInvitationContext.Provider>
  );
}

function InvitationModal({
  invitation,
  onConfirm,
  onDismiss,
  refTarget,
}: {
  invitation: PaymentInvitation;
  onConfirm: () => void;
  onDismiss: () => void;
  refTarget: MutableRefObject<HTMLElement | null>;
}) {
  return (
    <div
      aria-labelledby="payment-invitation-title"
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 px-4 py-6 payment-invitation-fade"
      onClick={onDismiss}
      role="dialog"
    >
      <section
        className="relative w-full max-w-[330px] rounded-[30px] bg-white px-5 pb-5 pt-6 text-center shadow-[0_18px_60px_rgba(0,0,0,0.22)] outline-none payment-invitation-card min-[390px]:max-w-[360px] min-[390px]:px-6"
        onClick={(event) => event.stopPropagation()}
        ref={refTarget}
        tabIndex={-1}
      >
        <button
          aria-label="초대장 닫기"
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center text-[34px] font-light leading-none text-[#888]"
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>

        <EnvelopeIcon />

        <p className="mx-auto mt-4 w-fit rounded-full bg-meet-pinkSoft px-4 py-1.5 text-[14px] font-black text-meet-pink">
          초대장이 도착했어요
        </p>
        <h2 id="payment-invitation-title" className="mt-4 text-fluid-safe text-[23px] font-black leading-tight text-black">
          Time to Meet에 초대되었어요
        </h2>
        <p className="mt-4 text-[14px] font-extrabold leading-relaxed text-[#555]">
          참가자로 선정되었습니다.<br />
          아래 결제 기한까지 결제를 완료하면<br />
          참가가 확정됩니다.
        </p>

        <div className="mt-5 rounded-[20px] bg-meet-blueSoft px-4 py-4 text-black">
          <h3 className="text-fluid-safe text-[18px] font-black leading-snug">{invitation.eventTitle}</h3>
          <p className="mt-2.5 text-[14px] font-extrabold text-[#333]">{formatKoreanDateTime(invitation.eventDate, invitation.startTime)}</p>
          <div className="my-3.5 h-px bg-white/85" />
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 text-left">
            <p className="text-[14px] font-black text-[#333]">결제 기한</p>
            <p className="text-right text-fluid-safe text-[15px] font-black text-black">{formatDeadline(invitation.paymentDeadline)}</p>
          </div>
        </div>

        <button
          className="mt-4 h-[52px] w-full rounded-[18px] bg-meet-blue text-[17px] font-black text-white shadow-sm transition active:scale-[0.99]"
          onClick={onConfirm}
          type="button"
        >
          초대장 확인하기
        </button>
        <button
          className="mt-4 h-10 w-full text-[16px] font-black text-[#777]"
          onClick={onDismiss}
          type="button"
        >
          나중에 확인
        </button>
      </section>
    </div>
  );
}

function EnvelopeIcon() {
  return (
    <svg
      aria-hidden="true"
      className="mx-auto block h-[96px] w-[104px]"
      fill="none"
      viewBox="0 0 104 96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M18 40 46.8 21.7a9.8 9.8 0 0 1 10.4 0L86 40"
        fill="#EAF6FF"
        stroke="#A8D3FA"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M31 18.5c0-3 2.4-5.5 5.5-5.5h31c3 0 5.5 2.4 5.5 5.5v45.7H31V18.5Z"
        fill="#FFF7FA"
        stroke="#F6A8C4"
        strokeWidth="2"
      />
      <path
        d="M52 33.2c-3.8-3.9-9.9-1.4-9.9 3.5 0 5 6.6 8.4 9.9 11.2 3.3-2.8 9.9-6.2 9.9-11.2 0-4.9-6.1-7.4-9.9-3.5Z"
        fill="#F36C9D"
      />
      <path
        d="M15 38.5c0-3.6 2.9-6.5 6.5-6.5h61c3.6 0 6.5 2.9 6.5 6.5v40c0 3.6-2.9 6.5-6.5 6.5h-61c-3.6 0-6.5-2.9-6.5-6.5v-40Z"
        fill="#DFF0FF"
        stroke="#A8D3FA"
        strokeWidth="2"
      />
      <path
        d="M16.5 39.5 47.2 61.2a8.4 8.4 0 0 0 9.6 0l30.7-21.7"
        fill="#EAF6FF"
        stroke="#8EC7F4"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      <path d="M17 82 42.8 59.2" stroke="#B6DAF8" strokeLinecap="round" strokeWidth="2" />
      <path d="M87 82 61.2 59.2" stroke="#B6DAF8" strokeLinecap="round" strokeWidth="2" />
      <path d="M22 85h60" stroke="#C8E5FC" strokeLinecap="round" strokeWidth="2" />
    </svg>
  );
}

function getSessionKey() {
  const session = getAppSession();
  return session?.token ? `${session.role}:${session.userId ?? ''}:${session.expiresAt}` : '';
}

function formatKoreanDateTime(dateValue: string, timeValue: string) {
  const date = new Date(`${dateValue}T${timeValue}`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]}) ${formatKoreanTime(date)}`;
}

function formatDeadline(value: string) {
  const date = new Date(value);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]}) ${formatKoreanTime(date)}`;
}

function formatKoreanTime(date: Date) {
  const period = date.getHours() < 12 ? '오전' : '오후';
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${period} ${hour}:${minute}`;
}
