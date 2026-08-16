import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import type { MyEventTicket } from '../services/supabaseApplications';

interface EventTicketProps {
  onPay?: () => void;
  onQrOpen?: () => void;
  ticket: MyEventTicket;
}

export default function EventTicket({ onPay, onQrOpen, ticket }: EventTicketProps) {
  const isConfirmed = ticket.status === '참가 확정';
  const shortCode = getTicketShortCode(ticket.applicationNo);

  return (
    <article className="relative left-1/2 grid aspect-[9/5] w-[calc(100vw_-_36px)] max-w-[400px] min-w-0 -translate-x-1/2 grid-cols-[minmax(0,74%)_minmax(0,26%)] overflow-visible rounded-[12px] border border-[#f2dfe2] bg-white shadow-calendar before:absolute before:left-[74%] before:top-[-10px] before:z-10 before:h-5 before:w-5 before:-translate-x-1/2 before:rounded-full before:border before:border-[#f2dfe2] before:bg-white after:absolute after:bottom-[-10px] after:left-[74%] after:z-10 after:h-5 after:w-5 after:-translate-x-1/2 after:rounded-full after:border after:border-[#f2dfe2] after:bg-white">
      <div className="flex min-w-0 flex-col justify-between px-3 py-2.5 min-[375px]:px-3.5 min-[390px]:px-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="shrink-0 text-[8px] font-black uppercase tracking-[0.12em] text-[#8b8b8b] min-[390px]:text-[9px]">Boarding Pass</p>
          <span className="h-px min-w-0 flex-1 border-t border-dashed border-meet-pink" />
          <span aria-hidden="true" className="shrink-0 text-[12px] leading-none text-meet-pink min-[390px]:text-[14px]">✈</span>
        </div>
        <h2 className="mt-1.5 min-w-0 whitespace-nowrap text-fluid-safe font-black leading-tight text-black [font-size:clamp(16px,4.7vw,22px)]">
          {ticket.eventTitle}
        </h2>

        <dl className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,0.8fr)] gap-1.5 border-b border-meet-pink/25 pb-1.5 min-[390px]:gap-2.5">
          <TicketInfo label="Date" value={formatTicketDate(ticket.eventDate)} />
          <TicketInfo label="Time" value={ticket.startTime} />
          <TicketInfo label="Area" value={ticket.location} />
        </dl>

        <dl className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,0.9fr)_minmax(0,1.25fr)_minmax(0,0.8fr)] gap-1.5 min-[390px]:gap-2.5">
          <TicketInfo label="Nickname" value={ticket.nickname} />
          <TicketInfo label="Job" value={ticket.job} />
          <TicketInfo label="Age" value={`${ticket.age}세`} />
        </dl>

        <div className="mt-1.5 grid min-w-0 grid-cols-[minmax(0,1.15fr)_auto_minmax(42px,0.95fr)] items-end gap-1.5 min-[390px]:gap-2.5">
          <TicketInfo label="Ticket No." value={ticket.applicationNo} compact />
          <p className="shrink-0 whitespace-nowrap text-[7px] font-black text-meet-pink min-[390px]:text-[8px]">{shortCode}</p>
          <div className="h-4 min-w-0 bg-[repeating-linear-gradient(90deg,#111_0_1.5px,transparent_1.5px_3px,#111_3px_5px,transparent_5px_7px)]" />
        </div>
      </div>

      <div className="relative grid min-w-0 place-items-center border-l border-dashed border-meet-pink/45 bg-gradient-to-b from-white to-meet-pinkSoft/35 px-1.5 py-2.5 text-center min-[390px]:px-2">
        {isConfirmed && ticket.qrToken ? (
          <button className="w-full min-w-0" onClick={onQrOpen} type="button">
            <TicketQr token={ticket.qrToken} />
            <p className="mt-1.5 text-[9px] font-black uppercase tracking-[0.08em] text-meet-pink min-[390px]:text-[10px]">Entry QR</p>
          </button>
        ) : (
          <div className="flex h-full w-full min-w-0 flex-col items-center justify-center">
            <p className="text-[12px] font-black text-meet-pink min-[390px]:text-[14px]">{ticket.status}</p>
            {ticket.paymentDeadline ? (
              <p className="mt-2 text-[9px] font-black leading-tight text-[#777] min-[390px]:mt-3 min-[390px]:text-[10px]">
                결제 기한
                <br />
                <span className="mt-1 block whitespace-nowrap text-[13px] text-[#666] min-[390px]:text-[15px]">{formatShortDeadline(ticket.paymentDeadline)}</span>
                <span className="mt-0.5 block whitespace-nowrap text-[9px] text-[#777] min-[390px]:text-[10px]">{formatShortDeadlineTime(ticket.paymentDeadline)}</span>
              </p>
            ) : null}
            <p className="mt-2 whitespace-nowrap text-fluid-safe text-[14px] font-black text-[#666] min-[390px]:mt-3 min-[390px]:text-[16px]">{formatWon(ticket.paymentAmount)}</p>
            <button
              className="mt-2 h-7 w-full max-w-[64px] rounded-[7px] bg-[#db7894] px-1.5 text-[11px] font-black text-white disabled:bg-[#d8d8d8] min-[390px]:mt-3 min-[390px]:h-8 min-[390px]:max-w-[70px] min-[390px]:text-[12px]"
              disabled={!onPay || ticket.status !== '결제 대기'}
              onClick={(event) => {
                event.stopPropagation();
                onPay?.();
              }}
              type="button"
            >
              결제하기
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function TicketInfo({ compact = false, label, value }: { compact?: boolean; label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[7px] font-black uppercase tracking-[0.08em] text-[#888] min-[390px]:text-[8px]">{label}</dt>
      <dd className={`mt-0.5 whitespace-nowrap text-fluid-safe font-black leading-tight text-[#333] ${compact ? 'text-[9px] min-[390px]:text-[11px]' : 'text-[10px] min-[390px]:text-[12px]'}`}>
        {value}
      </dd>
    </div>
  );
}

function TicketQr({ token }: { token: string }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(`t2m:${token}`, {
      color: { dark: '#000000', light: '#ffffff' },
      margin: 2,
      width: 120,
    }).then((url) => {
      if (active) setDataUrl(url);
    });
    return () => {
      active = false;
    };
  }, [token]);

  return dataUrl ? <img alt="참가자 전용 QR" className="mx-auto h-auto w-full max-w-[98px] bg-white" src={dataUrl} /> : <div className="mx-auto h-[92px] w-[92px] bg-white" />;
}

export function TicketQrDisplay({ ticket }: { ticket: MyEventTicket }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!ticket.qrToken) return;
    void QRCode.toDataURL(`t2m:${ticket.qrToken}`, {
      color: { dark: '#000000', light: '#ffffff' },
      margin: 4,
      width: 320,
    }).then(setDataUrl);
  }, [ticket.qrToken]);

  return (
    <div className="text-center">
      <h2 className="mt-1 text-[22px] font-black">입장 QR</h2>
      <p className="mt-2 text-[14px] font-extrabold text-[#777]">{ticket.applicationNo} · {ticket.nickname}</p>
      {dataUrl ? <img alt="확대된 참가자 전용 QR" className="mx-auto mt-5 w-full max-w-[280px] bg-white" src={dataUrl} /> : null}
    </div>
  );
}

export function QrModal({ onClose, ticket }: { onClose: () => void; ticket: MyEventTicket }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onClose} role="dialog">
      <section className="w-full max-w-[340px] rounded-[28px] bg-white p-5 shadow-calendar" onClick={(event) => event.stopPropagation()}>
        <button aria-label="QR 닫기" className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-[#f2f2f2] text-[20px] font-black" onClick={onClose} type="button">
          ×
        </button>
        <TicketQrDisplay ticket={ticket} />
      </section>
    </div>
  );
}

export function getDDay(dateValue: string) {
  const now = new Date();
  const kstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  const [year, month, day] = dateValue.split('-').map(Number);
  const today = new Date(kstNow.getFullYear(), kstNow.getMonth(), kstNow.getDate()).getTime();
  const eventDay = new Date(year, month - 1, day).getTime();
  const diff = Math.ceil((eventDay - today) / 86_400_000);
  if (diff < 0) return '종료';
  if (diff === 0) return 'D-DAY';
  return `D-${diff}`;
}

export function formatWon(value: number) {
  return `${value.toLocaleString('ko-KR')}원`;
}

export function formatTicketDate(value: string) {
  const [, month, day] = value.split('-');
  const date = new Date(`${value}T00:00:00`);
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${month}.${day} ${dayNames[date.getDay()]}`;
}

export function formatKoreanDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]})`;
}

export function formatKoreanDateTime(dateValue: string, timeValue: string) {
  return `${formatKoreanDate(dateValue)} 오후 ${toTwelveHour(timeValue)}`;
}

export function formatDeadline(value: string) {
  const date = new Date(value);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const period = date.getHours() < 12 ? '오전' : '오후';
  const hour = date.getHours() % 12 || 12;
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}. ${String(date.getMonth() + 1).padStart(2, '0')}. ${String(date.getDate()).padStart(2, '0')} (${dayNames[date.getDay()]}) ${period} ${hour}:${minute}`;
}

function formatShortDeadline(value: string) {
  const date = new Date(value);
  const dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${dayNames[date.getDay()]}`;
}

function formatShortDeadlineTime(value: string) {
  const date = new Date(value);
  const rawHour = date.getHours();
  const hour = rawHour === 0 ? 12 : rawHour;
  return `${String(hour).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}까지`;
}

function getTicketShortCode(applicationNo: string) {
  const normalized = applicationNo.replace(/-/g, '_');
  const parts = normalized.split('_');
  if (parts.length >= 2) return `${parts[0]} ${parts[1]}`;
  return applicationNo;
}

function toTwelveHour(timeValue: string) {
  const [rawHour, minute] = timeValue.split(':').map(Number);
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}
