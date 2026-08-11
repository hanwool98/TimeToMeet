import { type ReactNode, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';
import useSharedAdminData from '../hooks/useSharedAdminData';
import { getStoredEvents, saveEventOverride } from '../utils/adminApplications';
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
  if (!dateParam) return new Date(2026, 7, 16);
  const [year, month, day] = dateParam.split('-').map(Number);
  if (!year || !month || !day) return new Date(2026, 7, 16);
  return new Date(year, month - 1, day);
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
    <label className="block">
      <span className="mb-2 block text-[15px] font-black text-black">{label}</span>
      {children}
    </label>
  );
}

const inputClassName =
  'h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold text-black outline-none focus:ring-2 focus:ring-meet-blue';

export default function AdminEventCreatePage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  useSharedAdminData();
  const events = getStoredEvents();
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

  const [eventType, setEventType] = useState(eventTypes[0]);
  const [eventName, setEventName] = useState(editingEvent?.title ?? '');
  const [eventDate, setEventDate] = useState(toDateInputValue(selectedDate));
  const [startTime, setStartTime] = useState(editingEvent?.startTime ?? '15:00');
  const [endTime, setEndTime] = useState(editingEvent?.endTime ?? '18:00');
  const [deadline, setDeadline] = useState(toDateTimeInputValue(defaultDeadline));
  const [maleCapacity, setMaleCapacity] = useState(editingEvent ? String(editingEvent.targetParticipants / 2) : '10');
  const [femaleCapacity, setFemaleCapacity] = useState(editingEvent ? String(editingEvent.targetParticipants / 2) : '10');
  const [region, setRegion] = useState(editingEvent?.location ?? regions[0]);
  const [venueDetail, setVenueDetail] = useState('');
  const [venueBooked, setVenueBooked] = useState(editingEvent?.venueBooked ?? false);

  const handleCreate = () => {
    const nextEvent: EventData = {
      id: editingEvent?.id ?? createEventId(eventDate, eventName),
      title: eventName.trim() || '타임투밋 로테이션 소개팅',
      shortName: eventType.includes('로테이션') ? '로테이션' : eventType,
      date: eventDate,
      startTime,
      endTime,
      location: region.replace('시', ''),
      venueBooked,
      currentParticipants: editingEvent?.currentParticipants ?? 0,
      targetParticipants: Number(maleCapacity) + Number(femaleCapacity),
    };

    saveEventOverride(nextEvent);
    navigate(editingEvent ? `/admin/events/${nextEvent.id}` : '/admin/events');
  };

  const pageTitle = editingEvent ? '행사 수정' : '새 행사 만들기';
  const submitLabel = editingEvent ? '행사 수정' : '행사 만들기';
  const cancelPath = editingEvent ? `/admin/events/${editingEvent.id}` : '/admin/events';

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-black">
      <div className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col px-3 pb-8 pt-2">
        <header className="mb-1 flex items-center gap-1">
          <img alt="time2meet" className="h-auto w-[150px] object-contain" src="/assets/time2meet-logo.png" />
          <span className="translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <section className="rounded-[30px] border border-[#f0f3f6] bg-white px-5 py-6 shadow-calendar">
          <h1 className="text-[25px] font-black leading-tight">{pageTitle}</h1>
          <p className="mt-3 text-[18px] font-black text-meet-blue">{formatKoreanDate(eventDate)}</p>

          <form className="mt-7 space-y-5" onSubmit={(event) => event.preventDefault()}>
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
              <input className={inputClassName} onChange={(event) => setEventDate(event.target.value)} type="date" value={eventDate} />
            </Field>

            <div>
              <span className="mb-2 block text-[15px] font-black text-black">진행 시간</span>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input className={inputClassName} onChange={(event) => setStartTime(event.target.value)} type="time" value={startTime} />
                <span className="text-[18px] font-black text-[#777]">~</span>
                <input className={inputClassName} onChange={(event) => setEndTime(event.target.value)} type="time" value={endTime} />
              </div>
            </div>

            <Field label="신청 마감">
              <input className={inputClassName} onChange={(event) => setDeadline(event.target.value)} type="datetime-local" value={deadline} />
            </Field>

            <div className="rounded-[24px] bg-meet-blueSoft p-4">
              <h2 className="text-[17px] font-black">모집 인원</h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Field label="남성">
                  <select className="h-12 w-full rounded-[18px] bg-white px-4 text-[16px] font-bold outline-none focus:ring-2 focus:ring-meet-blue" onChange={(event) => setMaleCapacity(event.target.value)} value={maleCapacity}>
                    {Array.from({ length: 16 }, (_, index) => String(index + 5)).map((count) => (
                      <option key={count} value={count}>
                        {count}명
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="여성">
                  <select className="h-12 w-full rounded-[18px] bg-white px-4 text-[16px] font-bold outline-none focus:ring-2 focus:ring-meet-blue" onChange={(event) => setFemaleCapacity(event.target.value)} value={femaleCapacity}>
                    {Array.from({ length: 16 }, (_, index) => String(index + 5)).map((count) => (
                      <option key={count} value={count}>
                        {count}명
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
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
              <div className="grid grid-cols-2 gap-3">
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

            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                className="h-14 rounded-[18px] bg-[#e8e8e8] text-[16px] font-black text-black transition active:scale-[0.99]"
                onClick={() => navigate(cancelPath)}
                type="button"
              >
                취소
              </button>
              <PrimaryButton onClick={handleCreate}>{submitLabel}</PrimaryButton>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function createEventId(dateValue: string, eventName: string) {
  const slug = eventName.trim() ? eventName.trim().replace(/\s+/g, '-').toLowerCase() : 'time2meet-event';
  return `${slug}-${dateValue}`;
}
