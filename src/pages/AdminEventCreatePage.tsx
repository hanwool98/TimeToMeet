import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import { fetchAdminEventDetailsFromSupabase, upsertEventToSupabase } from '../services/supabaseApplications';
import type { EventData } from '../types/event';

const eventTypes = ['타임투밋 로테이션 소개팅'];
const regions = ['성남시', '서울시', '수원시', '용인시'];

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDateTimeInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateParam(dateParam: string | null) {
  if (!dateParam) return new Date();
  const [year, month, day] = dateParam.split('-').map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}



function defaultDeadlineForDate(dateValue: string) {
  const date = parseDateParam(dateValue);
  date.setDate(date.getDate() - 3);
  date.setHours(23, 59, 0, 0);
  return toDateTimeInputValue(date);
}

function defaultEarlyBirdDeadlineForDate(dateValue: string) {
  const date = parseDateParam(dateValue);
  date.setDate(date.getDate() - 7);
  date.setHours(23, 59, 0, 0);
  return toDateTimeInputValue(date);
}

function toRegionOption(location: string) {
  if (regions.includes(location)) return location;
  const withCitySuffix = `${location}시`;
  return regions.includes(withCitySuffix) ? withCitySuffix : regions[0];
}

function formatKoreanDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  if (!year || !month || !day) return '';
  return `${year}년 ${month}월 ${day}일`;
}

function Field({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <label className="block w-full max-w-full min-w-0">
      <span className="mb-2 block text-[15px] font-black text-black">{label}</span>
      {children}
    </label>
  );
}

const inputClassName =
  'h-12 w-full max-w-full min-w-0 appearance-none rounded-[18px] bg-meet-blueSoft px-3 text-center text-[15px] font-bold text-black outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]';

export default function AdminEventCreatePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { error, events, loading, reload } = useOperationalData();
  const editingEvent = events.find((event) => event.id === eventId);
  const selectedDate = useMemo(
    () => (editingEvent ? parseDateParam(editingEvent.date) : parseDateParam(searchParams.get('date'))),
    [editingEvent, searchParams],
  );
  const defaultDeadline = useMemo(() => {
    const deadline = new Date(selectedDate);
    deadline.setDate(deadline.getDate() - 3);
    deadline.setHours(23, 59, 0, 0);
    return deadline;
  }, [selectedDate]);
  const defaultEarlyBirdDeadline = useMemo(() => {
    const deadline = new Date(selectedDate);
    deadline.setDate(deadline.getDate() - 7);
    deadline.setHours(23, 59, 0, 0);
    return deadline;
  }, [selectedDate]);

  const [eventType, setEventType] = useState(eventTypes[0]);
  const [eventName, setEventName] = useState(editingEvent?.title ?? '');
  const [eventDate, setEventDate] = useState(toDateInputValue(selectedDate));
  const [startTime, setStartTime] = useState(editingEvent?.startTime ?? '15:00');
  const [endTime, setEndTime] = useState(editingEvent?.endTime ?? '18:00');
  const [deadline, setDeadline] = useState(toDateTimeInputValue(defaultDeadline));
  const [maleCapacity, setMaleCapacity] = useState(editingEvent ? String(editingEvent.targetParticipants / 2) : '10');
  const [femaleCapacity, setFemaleCapacity] = useState(editingEvent ? String(editingEvent.targetParticipants / 2) : '10');
  const [malePrice, setMalePrice] = useState(editingEvent ? String(editingEvent.malePrice) : '50000');
  const [femalePrice, setFemalePrice] = useState(editingEvent ? String(editingEvent.femalePrice) : '40000');
  const [earlyBirdDeadline, setEarlyBirdDeadline] = useState(() => {
    if (editingEvent?.earlyBirdDeadline) return toDateTimeInputValue(new Date(editingEvent.earlyBirdDeadline));
    if (editingEvent) return '';
    return toDateTimeInputValue(defaultEarlyBirdDeadline);
  });
  const [earlyBirdDiscountMale, setEarlyBirdDiscountMale] = useState(editingEvent ? String(editingEvent.earlyBirdDiscountMale ?? 0) : '5000');
  const [earlyBirdDiscountFemale, setEarlyBirdDiscountFemale] = useState(editingEvent ? String(editingEvent.earlyBirdDiscountFemale ?? 0) : '5000');
  const [region, setRegion] = useState(editingEvent?.location ?? regions[0]);
  const [venueDetail, setVenueDetail] = useState('');
  const [venueBooked, setVenueBooked] = useState(editingEvent?.venueBooked ?? false);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editDetailsLoading, setEditDetailsLoading] = useState(Boolean(eventId));

  useEffect(() => {
    if (!editingEvent) return;
    setEventType(editingEvent.shortName.includes('로테이션') ? eventTypes[0] : editingEvent.shortName);
    setEventName(editingEvent.title);
    setEventDate(editingEvent.date);
    setStartTime(editingEvent.startTime);
    setEndTime(editingEvent.endTime);
    setMaleCapacity(String(editingEvent.maleCapacity ?? editingEvent.targetParticipants / 2));
    setFemaleCapacity(String(editingEvent.femaleCapacity ?? editingEvent.targetParticipants / 2));
    setMalePrice(String(editingEvent.malePrice));
    setFemalePrice(String(editingEvent.femalePrice));
    setEarlyBirdDeadline(editingEvent.earlyBirdDeadline ? toDateTimeInputValue(new Date(editingEvent.earlyBirdDeadline)) : '');
    setEarlyBirdDiscountMale(String(editingEvent.earlyBirdDiscountMale ?? 0));
    setEarlyBirdDiscountFemale(String(editingEvent.earlyBirdDiscountFemale ?? 0));
    setRegion(toRegionOption(editingEvent.location));
    setVenueBooked(editingEvent.venueBooked);
    setDeadline(
      editingEvent.applicationDeadline
        ? toDateTimeInputValue(new Date(editingEvent.applicationDeadline))
        : defaultDeadlineForDate(editingEvent.date),
    );
  }, [editingEvent]);

  useEffect(() => {
    if (!eventId) {
      setEditDetailsLoading(false);
      return;
    }

    let active = true;
    setEditDetailsLoading(true);
    void fetchAdminEventDetailsFromSupabase(eventId)
      .then((details) => {
        if (!active || !details) return;
        setEventType(details.shortName.includes('로테이션') ? eventTypes[0] : details.shortName);
        setEventName(details.title);
        setEventDate(details.date);
        setStartTime(details.startTime);
        setEndTime(details.endTime);
        setMaleCapacity(String(details.maleCapacity));
        setFemaleCapacity(String(details.femaleCapacity));
        setMalePrice(String(details.malePrice));
        setFemalePrice(String(details.femalePrice));
        setEarlyBirdDeadline(details.earlyBirdDeadline ? toDateTimeInputValue(new Date(details.earlyBirdDeadline)) : '');
        setEarlyBirdDiscountMale(String(details.earlyBirdDiscountMale ?? 0));
        setEarlyBirdDiscountFemale(String(details.earlyBirdDiscountFemale ?? 0));
        setRegion(toRegionOption(details.location));
        setVenueDetail(details.venueDetail);
        setVenueBooked(details.venueBooked);
        setDeadline(
          details.applicationDeadline
            ? toDateTimeInputValue(new Date(details.applicationDeadline))
            : defaultDeadlineForDate(details.date),
        );
      })
      .catch((caughtError) => {
        if (!active) return;
        setSaveError(getEventSaveErrorMessage(caughtError));
      })
      .finally(() => {
        if (active) setEditDetailsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [eventId]);

  const handleCreate = async () => {
    if (!editingEvent && eventDate < toDateInputValue(new Date())) {
      setSaveError('행사 날짜는 오늘 이후여야 합니다.');
      return;
    }

    const nextEvent: EventData = {
      applicationDeadline: deadline ? new Date(deadline).toISOString() : undefined,
      earlyBirdDeadline: earlyBirdDeadline ? new Date(earlyBirdDeadline).toISOString() : undefined,
      earlyBirdDiscountMale: Number(earlyBirdDiscountMale) || 0,
      earlyBirdDiscountFemale: Number(earlyBirdDiscountFemale) || 0,
      id: editingEvent?.id ?? createEventId(eventDate, eventName),
      title: eventName.trim() || '타임투밋 로테이션 소개팅',
      shortName: eventType.includes('로테이션') ? '로테이션' : eventType,
      date: eventDate,
      startTime,
      endTime,
      location: region.replace(/시$/, ''),
      venueBooked,
      venueDetail: venueDetail.trim(),
      malePrice: Number(malePrice) || 0,
      maleCapacity: Number(maleCapacity),
      femalePrice: Number(femalePrice) || 0,
      femaleCapacity: Number(femaleCapacity),
      currentParticipants: editingEvent?.currentParticipants ?? 0,
      targetParticipants: Number(maleCapacity) + Number(femaleCapacity),
    };

    setSaving(true);
    setSaveError('');
    try {
      await upsertEventToSupabase(nextEvent);
      navigate(editingEvent ? `/admin/events/${nextEvent.id}` : '/admin/events');
    } catch (caughtError) {
      setSaveError(getEventSaveErrorMessage(caughtError));
    } finally {
      setSaving(false);
    }
  };

  const pageTitle = editingEvent ? '행사 수정' : '새 행사 만들기';
  const submitLabel = editingEvent ? '행사 수정' : '행사 만들기';
  const cancelPath = editingEvent ? `/admin/events/${editingEvent.id}` : '/admin/events';
  const isPastDateBlocked = !editingEvent && Boolean(eventDate) && eventDate < toDateInputValue(new Date());

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto flex min-h-screen w-full max-w-full min-w-0 flex-col px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="w-full max-w-full min-w-0 rounded-[30px] border border-[#f0f3f6] bg-white px-4 py-6 shadow-calendar min-[380px]:px-5">
          <h1 className="text-fluid-safe text-[25px] font-black leading-tight">{pageTitle}</h1>
          <p className="mt-3 text-[18px] font-black text-meet-blue">{formatKoreanDate(eventDate)}</p>

          <form className="mt-7 w-full max-w-full min-w-0 space-y-5" onSubmit={(event) => event.preventDefault()}>
            <Field label="행사 종류">
              <select className={inputClassName} onChange={(event) => setEventType(event.target.value)} value={eventType}>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="행사명">
              <input className={inputClassName} onChange={(event) => setEventName(event.target.value)} value={eventName} />
            </Field>

            <Field label="행사 날짜">
              <input
                className={inputClassName}
                min={editingEvent ? undefined : toDateInputValue(new Date())}
                onChange={(event) => setEventDate(event.target.value)}
                type="date"
                value={eventDate}
              />
            </Field>

            <div>
              <span className="mb-2 block text-[15px] font-black text-black">진행 시간</span>
              <div className="grid w-full max-w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <input className={inputClassName} onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} />
                <span className="shrink-0 text-[18px] font-black text-[#777]">~</span>
                <input className={inputClassName} onChange={(event) => setEndTime(event.target.value)} type="time" value={endTime} />
              </div>
            </div>

            <Field label="신청 마감">
              <input className={inputClassName} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" value={deadline} />
            </Field>

            <div className="w-full max-w-full min-w-0 rounded-[24px] bg-meet-blueSoft p-4">
              <h2 className="text-[17px] font-black">모집 인원</h2>
              <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2 min-[380px]:gap-3">
                <Field label="남성">
                  <select
                    className="h-12 w-full max-w-full min-w-0 appearance-none rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    onChange={(event) => {
                      setMaleCapacity(event.target.value);
                      setFemaleCapacity(event.target.value);
                    }}
                    value={maleCapacity}
                  >
                    {Array.from({ length: 16 }, (_, index) => String(index + 5)).map((count) => (
                      <option key={count} value={count}>
                        {count}명
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="여성">
                  <select
                    className="h-12 w-full max-w-full min-w-0 appearance-none rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    onChange={(event) => {
                      setFemaleCapacity(event.target.value);
                      setMaleCapacity(event.target.value);
                    }}
                    value={femaleCapacity}
                  >
                    {Array.from({ length: 16 }, (_, index) => String(index + 5)).map((count) => (
                      <option key={count} value={count}>
                        {count}명
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="w-full max-w-full min-w-0 rounded-[24px] bg-meet-blueSoft p-4">
              <h2 className="text-[17px] font-black">참가비</h2>
              <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2 min-[380px]:gap-3">
                <Field label="남성">
                  <input
                    className="h-12 w-full max-w-full min-w-0 rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    inputMode="numeric"
                    onChange={(event) => setMalePrice(event.target.value.replace(/\D/g, ''))}
                    placeholder="50000"
                    value={malePrice}
                  />
                </Field>
                <Field label="여성">
                  <input
                    className="h-12 w-full max-w-full min-w-0 rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    inputMode="numeric"
                    onChange={(event) => setFemalePrice(event.target.value.replace(/\D/g, ''))}
                    placeholder="40000"
                    value={femalePrice}
                  />
                </Field>
              </div>
            </div>

            <div className="w-full max-w-full min-w-0 rounded-[24px] bg-meet-blueSoft p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[17px] font-black">얼리버드 할인 (선택)</h2>
                <button
                  className="h-8 shrink-0 rounded-[10px] bg-white px-3 text-[12px] font-black text-[#777] disabled:opacity-40"
                  disabled={!earlyBirdDeadline}
                  onClick={() => {
                    setEarlyBirdDeadline('');
                    setEarlyBirdDiscountMale('0');
                    setEarlyBirdDiscountFemale('0');
                  }}
                  type="button"
                >
                  얼리버드 비활성화
                </button>
              </div>
              <Field label="얼리버드 마감">
                <input
                  className="mt-1 h-12 w-full max-w-full min-w-0 rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                  onChange={(event) => setEarlyBirdDeadline(event.target.value)}
                  type="datetime-local"
                  value={earlyBirdDeadline}
                />
              </Field>
              <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2 min-[380px]:gap-3">
                <Field label="할인액(남성)">
                  <input
                    className="h-12 w-full max-w-full min-w-0 rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    inputMode="numeric"
                    onChange={(event) => setEarlyBirdDiscountMale(event.target.value.replace(/\D/g, ''))}
                    placeholder="5000"
                    value={earlyBirdDiscountMale}
                  />
                </Field>
                <Field label="할인액(여성)">
                  <input
                    className="h-12 w-full max-w-full min-w-0 rounded-[18px] bg-white px-3 text-center text-[15px] font-bold outline-none focus:ring-2 focus:ring-meet-blue min-[380px]:px-4 min-[380px]:text-[16px]"
                    inputMode="numeric"
                    onChange={(event) => setEarlyBirdDiscountFemale(event.target.value.replace(/\D/g, ''))}
                    placeholder="5000"
                    value={earlyBirdDiscountFemale}
                  />
                </Field>
              </div>
              <p className="mt-3 text-[12px] font-extrabold text-[#777]">마감을 비워두면 얼리버드 할인이 적용되지 않습니다.</p>
            </div>

            <Field label="공개 지역">
              <select className={inputClassName} onChange={(event) => setRegion(event.target.value)} value={region}>
                {regions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="상세 장소">
              <input className={inputClassName} onChange={(event) => setVenueDetail(event.target.value)} value={venueDetail} />
            </Field>

            <div>
              <span className="mb-2 block text-[15px] font-black text-black">대관여부</span>
              <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
                <button
                  className={[
                    'h-12 rounded-[18px] text-[16px] font-black transition active:scale-[0.99]',
                    !venueBooked ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black',
                  ].join(' ')}
                  onClick={() => setVenueBooked(false)}
                  type="button"
                >
                  미완료
                </button>
                <button
                  className={[
                    'h-12 rounded-[18px] text-[16px] font-black transition active:scale-[0.99]',
                    venueBooked ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black',
                  ].join(' ')}
                  onClick={() => setVenueBooked(true)}
                  type="button"
                >
                  완료
                </button>
              </div>
            </div>

            <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3 pt-2">
              <button
                className="h-14 rounded-[18px] bg-[#e8e8e8] text-[16px] font-black text-black transition active:scale-[0.99]"
                onClick={() => navigate(cancelPath)}
                type="button"
              >
                취소
              </button>
              <PrimaryButton disabled={saving || editDetailsLoading || isPastDateBlocked} onClick={handleCreate}>{saving ? '저장 중' : editDetailsLoading ? '행사 정보 확인 중' : submitLabel}</PrimaryButton>
            </div>
            {isPastDateBlocked ? (
              <p className="text-fluid-safe text-center text-[13px] font-black leading-snug text-meet-pink">행사 날짜는 오늘 이후여야 합니다.</p>
            ) : saveError ? (
              <p className="text-fluid-safe text-center text-[13px] font-black leading-snug text-meet-pink">{saveError}</p>
            ) : null}
          </form>
        </section>
      </div>
    </main>
  );
}

function createEventId(dateValue: string, eventName: string) {
  // Only letters/numbers/parentheses survive as-is; everything else (spaces,
  // #, ?, /, % ...) collapses to a single hyphen. This id is embedded
  // directly into route paths (e.g. `/admin/events/${event.id}`), and
  // characters like `#`/`?`/`/` are URL delimiters — left unescaped, they
  // silently truncate the path (a `#` turns the rest of the id into a URL
  // fragment) so the event becomes unreachable by its own link.
  const slug = eventName
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}()]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const safeSlug = slug || 'time2meet-event';
  return `${safeSlug}-${dateValue}-${crypto.randomUUID().slice(0, 8)}`;
}

function getEventSaveErrorMessage(caughtError: unknown) {
  const message = caughtError instanceof Error ? caughtError.message : '';
  if (message.includes('Event date cannot be in the past')) {
    return '행사 날짜는 오늘 이후여야 합니다.';
  }
  if (message.includes('row-level security') || message.includes('permission') || message.includes('policy')) {
    return '행사를 저장하지 못했습니다. Supabase 관리자 권한 또는 RLS 정책을 확인해주세요.';
  }
  if (message) return `행사를 저장하지 못했습니다. ${message}`;
  return '행사를 저장하지 못했습니다. Supabase 연결 상태를 확인해주세요.';
}
