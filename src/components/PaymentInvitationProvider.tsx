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
        className="relative w-full max-w-[330px] rounded-[24px] bg-white px-5 pb-5 pt-6 text-center shadow-[0_18px_60px_rgba(0,0,0,0.22)] outline-none payment-invitation-card min-[390px]:max-w-[360px] min-[390px]:px-6"
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

// 겹 순서(뒷면 → 뒤로 접힌 뚜껑 → 안에 든 편지 → 앞주머니가 편지 아랫부분을
// 덮음)를 그대로 유지해야 "봉투 속에 편지가 꽂혀있다"는 그림이 성립하므로,
// 이 순서를 바꾸지 않는다.
function EnvelopeIcon() {
  return (
    <svg aria-hidden="true" className="mx-auto block h-[110px] w-[132px]" fill="none" viewBox="0 0 120 100" xmlns="http://www.w3.org/2000/svg">
      {/* 1. 봉투 뒷면 */}
      <rect x="12" y="42" width="96" height="50" rx="4" fill="#dbe9fb" />

      {/* 2. 뒤로 접힌 뚜껑(위를 향한 삼각형) */}
      <path d="M12 44 L60 9 L108 44 Z" fill="#f8fbff" stroke="#9cc4ee" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 44 L60 9 L108 44" stroke="#c8ddf5" strokeWidth="1" strokeLinejoin="round" />

      {/* 3. 안에 들어있는 편지 */}
      <rect x="23" y="27" width="74" height="47" rx="3" fill="#ffffff" stroke="#dbe6f4" strokeWidth="1.6" />
      <path
        d="M33.4 38.6c-1.5-1.6-4-.6-4 1.5 0 1.8 2.4 3.4 4 4.5 1.6-1.1 4-2.7 4-4.5 0-2.1-2.5-3.1-4-1.5z"
        fill="#f2568a"
        opacity=".8"
      />
      <path
        d="M87 37.6l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z"
        fill="#3d7fd6"
        opacity=".8"
      />
      <rect x="34" y="52" width="52" height="3.4" rx="1.7" fill="#e8eef6" />
      <rect x="40" y="59" width="40" height="3.4" rx="1.7" fill="#eef3f9" />

      {/* 4. 봉투 앞주머니 - 편지 아랫부분을 덮음 */}
      <path
        d="M12 44 L60 73 L108 44 L108 88 A4 4 0 0 1 104 92 L16 92 A4 4 0 0 1 12 88 Z"
        fill="#eaf3fd"
        stroke="#6ea8e8"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12 89 L58 73 M108 89 L62 73" stroke="#c3daf3" strokeWidth="1.3" strokeLinecap="round" />

      {/* 5. 앞주머니 위 작은 별 장식 */}
      <g fill="#a9bedd" opacity=".55">
        <path d="M28 62l1.1 2.3 2.5.4-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.4z" />
        <path d="M92 62l1.1 2.3 2.5.4-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.4z" />
        <path d="M46 82l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z" />
        <path d="M74 82l.9 1.9 2.1.3-1.5 1.5.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.5 2.1-.3z" />
        <path d="M60 86l.8 1.6 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z" />
      </g>
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
