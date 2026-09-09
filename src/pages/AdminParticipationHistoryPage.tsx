import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ParticipantPhoto from '../components/ParticipantPhoto';
import {
  fetchAdminHistoricalRepresentativePhoto,
  fetchAdminParticipationHistory,
  type AdminParticipationHistoryResult,
} from '../services/supabaseApplications';

const emptyResult: AdminParticipationHistoryResult = { found: false, history: [], summary: null };

export default function AdminParticipationHistoryPage() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AdminParticipationHistoryResult>(emptyResult);
  const [photoUrls, setPhotoUrls] = useState<Map<string, string>>(new Map());

  const normalizedPhone = normalizePhone(phone);
  const phoneIsValid = /^01\d{8,9}$/.test(normalizedPhone);

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!phoneIsValid || loading) return;
    setLoading(true);
    setError('');
    setSearched(true);
    setPhotoUrls(new Map());
    try {
      setResult(await fetchAdminParticipationHistory(normalizedPhone));
    } catch (caughtError) {
      console.error('Admin participation history lookup failed', caughtError);
      setResult(emptyResult);
      setError('참여이력을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!result.found) return;
    let active = true;
    Promise.all(result.history.map(async (item) => {
      if (!item.representativePhotoPath) return null;
      try {
        const photo = await fetchAdminHistoricalRepresentativePhoto(item.applicationId);
        return photo?.signedUrl ? ([item.applicationId, photo.signedUrl] as const) : null;
      } catch {
        return null;
      }
    })).then((entries) => {
      if (!active) return;
      setPhotoUrls(new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null)));
    });
    return () => {
      active = false;
    };
  }, [result]);

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-12 pt-4 min-[390px]:px-5">
        <header className="flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[25px] font-black">참여이력 조회</h1>
            <p className="mt-1 text-[13px] font-bold text-[#888]">휴대폰 번호로 신청 및 실제 참여 기록을 확인합니다.</p>
          </div>
          <button className="shrink-0 text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin')} type="button">
            ← 관리자 홈
          </button>
        </div>

        <form className="mt-5 rounded-[20px] border border-[#e8edf2] bg-white p-4 shadow-calendar" onSubmit={search}>
          <label className="block text-[14px] font-black" htmlFor="history-phone">휴대폰 번호</label>
          <div className="mt-2 grid min-w-0 grid-cols-[minmax(0,1fr)_82px] gap-2">
            <input
              autoComplete="tel"
              className="h-12 min-w-0 rounded-[14px] border border-[#dce4ec] bg-[#f8fafc] px-4 text-[16px] font-extrabold outline-none focus:border-meet-blue"
              id="history-phone"
              inputMode="tel"
              onChange={(event) => setPhone(formatPhoneInput(event.target.value))}
              placeholder="010-1234-5678"
              value={phone}
            />
            <button
              className="h-12 min-w-0 rounded-[14px] bg-meet-blue text-[15px] font-black text-white disabled:bg-[#d8e2ed]"
              disabled={!phoneIsValid || loading}
              type="submit"
            >
              {loading ? '조회 중' : '조회'}
            </button>
          </div>
          {phone.length > 0 && !phoneIsValid ? <p className="mt-2 text-[12px] font-bold text-meet-pink">올바른 휴대폰 번호를 입력해주세요.</p> : null}
        </form>

        {error ? (
          <section className="mt-5 rounded-[18px] bg-[#fff0f5] p-5 text-center">
            <p className="text-[14px] font-black text-meet-pink">{error}</p>
            <button className="mt-3 text-[13px] font-black underline" onClick={() => void search()} type="button">다시 시도</button>
          </section>
        ) : null}

        {!loading && !error && searched && !result.found ? (
          <section className="mt-5 rounded-[20px] border border-[#edf1f5] bg-[#f8fafc] px-5 py-12 text-center">
            <p className="text-[16px] font-black text-[#8b929a]">해당 번호의 참여이력이 없습니다.</p>
          </section>
        ) : null}

        {result.summary ? (
          <>
            <section className="mt-5 rounded-[20px] border border-[#e5edf5] bg-meet-blueSoft p-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-[20px] font-black">{result.summary.name}</p>
                  <p className="mt-1 break-words text-[14px] font-bold text-[#737b84]">{result.summary.nickname} · {formatPhone(result.summary.phone)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-white px-3 py-1 text-[12px] font-black text-meet-blue">조회 결과</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <SummaryCount label="총 신청" value={result.summary.totalApplications} />
                <SummaryCount label="실제 참여" value={result.summary.actualParticipations} />
              </div>
            </section>

            <section className="mt-7">
              <h2 className="text-[20px] font-black">행사별 이력</h2>
              <div className="mt-3 space-y-3">
                {result.history.map((item) => (
                  <button
                    className="block w-full min-w-0 rounded-[18px] border border-[#e7ebef] bg-white p-4 text-left shadow-sm transition active:scale-[0.99]"
                    key={item.applicationId}
                    onClick={() => navigate(`/admin/applications?applicationId=${item.applicationId}`)}
                    type="button"
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <ParticipantPhoto
                        className="shrink-0 rounded-full bg-[#eef1f4] text-[#a2a8ae]"
                        crop={item.representativeCrop ?? undefined}
                        fallback={<PersonIcon />}
                        photoUrl={photoUrls.get(item.applicationId)}
                        sizePx={58}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <h3 className="min-w-0 break-words text-[16px] font-black leading-snug">{item.eventTitle}</h3>
                          <StatusBadge status={item.historyStatus} />
                        </div>
                        <p className="mt-1 text-[13px] font-bold text-[#777]">{formatEventDate(item.eventDate)} · {item.startTime.slice(0, 5)}</p>
                        <p className="mt-2 break-words text-[14px] font-extrabold">{item.nickname} · {item.age === null ? '나이 미입력' : `${item.age}세`} · {item.job}</p>
                        <p className="mt-1 text-[11px] font-bold text-[#a0a5ab]">{item.applicationNo}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[#edf0f3] pt-3">
                      <InfoChip label={`신청 ${formatDateTime(item.submittedAt)}`} />
                      {item.paymentStatus ? <InfoChip label={item.paymentStatus} /> : null}
                      {item.checkedInAt ? <InfoChip label={`체크인 ${formatDateTime(item.checkedInAt)}`} /> : null}
                      {item.attendanceStatus === 'no_show' ? <InfoChip label="노쇼" tone="pink" /> : null}
                      {item.finalSelectionSubmitted ? <InfoChip label="최종선택 제출" /> : null}
                      {item.reviewSubmitted ? <InfoChip label="후기 작성" /> : null}
                      {item.matched ? <InfoChip label="매칭" tone="pink" /> : null}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[14px] bg-white px-4 py-3">
      <p className="text-[12px] font-bold text-[#8a929b]">{label}</p>
      <p className="mt-0.5 text-[22px] font-black">{value}<span className="ml-0.5 text-[13px]">회</span></p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isNegative = ['노쇼', '중도 이탈', '신청 취소', '자동 취소', '환불 완료', '참가 거부'].includes(status);
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black ${isNegative ? 'bg-[#fff0f5] text-meet-pink' : 'bg-meet-blueSoft text-meet-blue'}`}>{status}</span>;
}

function InfoChip({ label, tone = 'gray' }: { label: string; tone?: 'gray' | 'pink' }) {
  return <span className={`rounded-full px-2 py-1 text-[10px] font-extrabold ${tone === 'pink' ? 'bg-[#fff0f5] text-meet-pink' : 'bg-[#f2f5f7] text-[#68717a]'}`}>{label}</span>;
}

function PersonIcon() {
  return (
    <svg aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c1-5 3.5-7 7-7s6 2 7 7" />
    </svg>
  );
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '').slice(0, 11);
}

function formatPhoneInput(value: string) {
  const digits = normalizePhone(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, digits.length - 4)}-${digits.slice(-4)}`;
}

function formatPhone(value: string) {
  return formatPhoneInput(value);
}

function formatEventDate(value: string) {
  const date = new Date(`${value}T00:00:00+09:00`);
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeZone: 'Asia/Seoul' }).format(date);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}
