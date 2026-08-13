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
  const ageBand = getAgeBand(ticket.age);

  return (
    <article className="relative grid w-full max-w-full min-w-0 grid-cols-[minmax(0,3fr)_minmax(86px,1fr)] overflow-hidden rounded-[22px] border border-[#f2dfe2] bg-white shadow-calendar">
      <div className="min-w-0 px-4 py-4 min-[390px]:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.12em] text-[#888]">Boarding Pass</p>
          <span className="h-px min-w-0 flex-1 border-t border-dashed border-meet-pink" />
          <span aria-hidden="true" className="shrink-0 text-[16px] text-meet-pink">✈</span>
        </div>
        <div className="mt-4 flex min-w-0 flex-wrap items-start gap-2">
          <h2 className="min-w-0 flex-1 text-fluid-safe text-[24px] font-black leading-tight text-black">{ticket.eventTitle}</h2>
          <span className="shrink-0 rounded-full bg-meet-blueSoft px-2.5 py-1 text-[11px] font-black text-meet-blue">
            {getDDay(ticket.eventDate)}
          </span>
        </div>

        <dl className="mt-5 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3 border-b border-meet-pink/25 pb-4">
          <TicketInfo label="Date" value={formatTicketDate(ticket.eventDate)} />
          <TicketInfo label="Time" value={`${ticket.startTime}-${ticket.endTime}`} />
          <TicketInfo label="Area" value={ticket.location} />
        </dl>

        <dl className="mt-4 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-3">
          <TicketInfo label="Nickname" value={ticket.nickname} />
          <TicketInfo label="Job" value={ticket.job} />
          <TicketInfo label="Age" value={ageBand} />
        </dl>

        <div className="mt-4 flex min-w-0 items-end gap-3">
          <TicketInfo label="Ticket No." value={ticket.applicationNo} />
          <p className="shrink-0 text-[10px] font-black text-meet-pink">{ticket.applicationNo.replace('TTM_', 'TTM ')}</p>
          <div className="h-5 min-w-[72px] flex-1 bg-[repeating-linear-gradient(90deg,#111_0_2px,transparent_2px_4px,#111_4px_7px,transparent_7px_10px)]" />
        </div>
      </div>

      <div className="relative grid min-w-0 place-items-center border-l border-dashed border-meet-pink/45 bg-gradient-to-b from-white to-meet-pinkSoft/45 px-2 py-4 text-center">
        <span className="absolute -left-3 top-[-12px] h-6 w-6 rounded-full bg-white" />
        <span className="absolute -left-3 bottom-[-12px] h-6 w-6 rounded-full bg-white" />
        {isConfirmed && ticket.qrToken ? (
          <button className="w-full min-w-0" onClick={onQrOpen} type="button">
            <TicketQr token={ticket.qrToken} />
            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.08em] text-meet-pink">Entry QR</p>
          </button>
        ) : (
          <div className="w-full min-w-0">
            <p className="text-[14px] font-black text-meet-pink">{ticket.status}</p>
            {ticket.paymentDeadline ? (
              <p className="mt-4 text-[11px] font-black text-[#888]">
                결제 기한
                <br />
                <span className="text-[16px] text-[#666]">{formatShortDeadline(ticket.paymentDeadline)}</span>
              </p>
            ) : null}
            <p className="mt-4 text-fluid-safe text-[17px] font-black text-[#666]">{formatWon(ticket.paymentAmount)}</p>
            <button
              className="mt-4 h-10 w-full max-w-full rounded-[10px] bg-meet-pink px-2 text-[13px] font-black text-white disabled:bg-[#d8d8d8]"
              disabled={!onPay || ticket.status !== '결제 대기'}
              onClick={onPay}
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

function TicketInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-black uppercase tracking-[0.08em] text-[#888]">{label}</dt>
      <dd className="mt-1 truncate text-[13px] font-black text-[#333] min-[390px]:text-[14px]">{value}</dd>
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

export function QrModal({ onClose, ticket }: { onClose: () => void; ticket: MyEventTicket }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    if (!ticket.qrToken) return;
    void QRCode.toDataURL(`t2m:${ticket.qrToken}`, {
      color: { dark: '#000000', light: '#ffffff' },
      margin: 4,
      width: 320,
    }).then(setDataUrl);
  }, [ticket.qrToken]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-5" onClick={onClose} role="dialog">
      <section className="w-full max-w-[340px] rounded-[28px] bg-white p-5 text-center shadow-calendar" onClick={(event) => event.stopPropagation()}>
        <button aria-label="QR 닫기" className="ml-auto grid h-9 w-9 place-items-center rounded-full bg-[#f2f2f2] text-[20px] font-black" onClick={onClose} type="button">
          ×
        </button>
        <h2 className="mt-1 text-[22px] font-black">입장 QR</h2>
        <p className="mt-2 text-[14px] font-extrabold text-[#777]">{ticket.applicationNo} · {ticket.nickname}</p>
        {dataUrl ? <img alt="확대된 참가자 전용 QR" className="mx-auto mt-5 w-full max-w-[280px] bg-white" src={dataUrl} /> : null}
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

function getAgeBand(age: number) {
  const decade = Math.floor(age / 10) * 10;
  const half = age % 10 < 5 ? '초반' : '후반';
  return `${decade}대 ${half}`;
}

function toTwelveHour(timeValue: string) {
  const [rawHour, minute] = timeValue.split(':').map(Number);
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}
