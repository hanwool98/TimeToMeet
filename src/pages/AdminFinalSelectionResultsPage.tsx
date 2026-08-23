import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import ParticipantPhoto from '../components/ParticipantPhoto';
import {
  fetchAdminEventParticipantMedia,
  fetchAdminFinalSelectionResults,
  type AdminFinalSelectionParticipant,
  type AdminFinalSelectionResults,
  type PublicParticipantMediaRow,
} from '../services/supabaseApplications';

type GenderTab = '남성' | '여성';

export default function AdminFinalSelectionResultsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<AdminFinalSelectionResults | null>(null);
  const [media, setMedia] = useState<Map<string, PublicParticipantMediaRow>>(new Map());
  const [tab, setTab] = useState<GenderTab>('남성');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    try {
      const [results, nextMedia] = await Promise.all([
        fetchAdminFinalSelectionResults(eventId),
        fetchAdminEventParticipantMedia(eventId),
      ]);
      setData(results);
      setMedia(nextMedia);
      setError('');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '최종선택 결과를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleParticipants = useMemo(
    () => data?.participants.filter((participant) => participant.gender === tab) ?? [],
    [data, tab],
  );

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;
  if (!data || !eventId) return <DataErrorState message="최종선택 결과를 찾을 수 없습니다." />;

  const backPath = searchParams.get('from') === 'live'
    ? `/admin/events/${encodeURIComponent(eventId)}/live`
    : '/admin/content/final-selections';
  const allSubmitted = data.summary.totalParticipants > 0 && data.summary.submittedCount >= data.summary.totalParticipants;

  return (
    <main className="admin-page min-h-screen w-full min-w-0 bg-white text-black">
      <div className="mx-auto min-h-screen w-full max-w-[520px] px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(16px+env(safe-area-inset-top))] min-[390px]:px-5">
        <header className="grid grid-cols-[36px_minmax(0,1fr)_36px] items-center gap-2">
          <button aria-label="뒤로가기" className="grid h-9 w-9 place-items-center" onClick={() => navigate(backPath)} type="button">
            <BackIcon />
          </button>
          <p className="truncate text-center text-[16px] font-black text-[#ef4039]">{data.event.title}</p>
          <span />
        </header>

        <div className="mt-7 flex flex-wrap items-center gap-2">
          <h1 className="text-[26px] font-black">최종 선택 결과</h1>
          <span className="rounded-[9px] border border-[#ffd3d3] bg-[#fff6f6] px-2.5 py-1 text-[12px] font-black text-[#ef4039]">
            {allSubmitted ? '최종 선택 단계 완료' : '최종 선택 진행 중'}
          </span>
        </div>
        <p className="mt-1 text-[13px] font-bold text-[#888]">{formatEventDate(data.event.eventDate)}</p>

        <section className="mt-5 rounded-[15px] border border-[#ffd6d6] bg-[#fff9f9] px-4 py-3 text-[13px] font-bold leading-relaxed text-[#555]">
          <strong className="text-[#ef4039]">{allSubmitted ? '모든 참가자의 최종 선택이 제출되었습니다.' : '참가자의 최종 선택 제출을 기다리고 있습니다.'}</strong>
          <br />최종 선택 결과는 상호 선택으로 매칭된 상대에게만 공개됩니다.
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          <SummaryCard label="전체 참가자" value={`${data.summary.totalParticipants}명`} />
          <SummaryCard label="최종 선택 제출" value={`${data.summary.submittedCount} / ${data.summary.totalParticipants}명`} />
          <SummaryCard label="전체 선택 건수" value={`${data.summary.selectionCount}건`} />
          <SummaryCard label="상호 선택 매칭" value={`${data.summary.mutualMatchCount}쌍`} pink />
        </section>

        <section className="mt-7">
          <h2 className="text-[18px] font-black">서로 선택한 참가자</h2>
          <p className="mt-1 text-[12px] font-bold text-[#888]">서로 선택하여 매칭이 성사된 참가자입니다.</p>
          {data.mutualMatches.length === 0 ? (
            <EmptyCard text="상호 선택 매칭이 없습니다" />
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 min-[390px]:grid-cols-2">
              {data.mutualMatches.map((match) => (
                <MutualMatchCard
                  key={`${match.left.applicationId}-${match.right.applicationId}`}
                  left={match.left}
                  media={media}
                  right={match.right}
                />
              ))}
            </div>
          )}
        </section>

        <section className="mt-8">
          <h2 className="text-[18px] font-black">전체 최종 선택 목록</h2>
          <p className="mt-1 text-[12px] font-bold text-[#888]">각 참가자가 선택한 상대를 순위 없이 표시합니다.</p>
          <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-[12px] border border-[#e7e9ed]">
            {(['남성', '여성'] as GenderTab[]).map((gender) => (
              <button
                className={`h-10 text-[13px] font-black ${tab === gender ? 'border border-[#ef5550] bg-[#fffafa] text-[#ef4039]' : 'text-[#666]'}`}
                key={gender}
                onClick={() => setTab(gender)}
                type="button"
              >
                {gender} 선택
              </button>
            ))}
          </div>
          <div className="mt-3 overflow-hidden rounded-[16px] border border-[#e7e9ed] bg-white">
            {visibleParticipants.map((participant) => (
              <ParticipantSelectionRow key={participant.applicationId} media={media} participant={participant} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function SummaryCard({ label, pink = false, value }: { label: string; pink?: boolean; value: string }) {
  return (
    <div className="min-w-0 rounded-[16px] border border-[#e5e8ec] bg-white px-4 py-4 shadow-sm">
      <p className="text-[12px] font-black text-[#555]">{label}</p>
      <p className={`mt-1 break-keep text-[23px] font-black ${pink ? 'text-[#ef4039]' : 'text-[#18324c]'}`}>{value}</p>
    </div>
  );
}

function MutualMatchCard({ left, media, right }: {
  left: AdminFinalSelectionResults['mutualMatches'][number]['left'];
  media: Map<string, PublicParticipantMediaRow>;
  right: AdminFinalSelectionResults['mutualMatches'][number]['right'];
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_24px_minmax(0,1fr)] items-center rounded-[14px] border border-[#e7e9ed] px-3 py-3">
      <MatchedPerson media={media.get(left.applicationId)} person={left} />
      <span className="text-center text-[18px] text-[#ef4039]">♥</span>
      <MatchedPerson media={media.get(right.applicationId)} person={right} />
    </div>
  );
}

function MatchedPerson({ media, person }: { media?: PublicParticipantMediaRow; person: { age: number | null; nickname: string } }) {
  return (
    <div className="min-w-0 text-center">
      <ParticipantPhoto className="mx-auto rounded-full bg-[#f3f5f7]" crop={media?.representativeCrop} fallback={<PersonIcon />} photoUrl={media?.photoUrl} sizePx={52} />
      <p className="mt-1 truncate text-[12px] font-black">{person.nickname}{person.age ? ` (${person.age})` : ''}</p>
    </div>
  );
}

function ParticipantSelectionRow({ media, participant }: { media: Map<string, PublicParticipantMediaRow>; participant: AdminFinalSelectionParticipant }) {
  const participantMedia = media.get(participant.applicationId);
  return (
    <div className="border-b border-[#edf0f3] px-3 py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <ParticipantPhoto className="rounded-full bg-[#f3f5f7]" crop={participantMedia?.representativeCrop} fallback={<PersonIcon />} photoUrl={participantMedia?.photoUrl} sizePx={42} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-[14px] font-black">{participant.nickname}{participant.age ? ` (${participant.age})` : ''}</p>
            <span className={`shrink-0 text-[11px] font-black ${participant.submittedAt ? 'text-[#3f9142]' : 'text-[#ef4039]'}`}>
              {participant.submittedAt ? '제출 완료' : '미제출'}
            </span>
          </div>
          {participant.submittedAt ? (
            <p className="mt-0.5 text-[10px] font-bold text-[#aaa]">{formatSubmittedAt(participant.submittedAt)}</p>
          ) : null}
        </div>
      </div>
      {participant.submittedAt ? (
        participant.selected.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {participant.selected.map((selected) => (
              <span className="rounded-full bg-[#fff0f3] px-2.5 py-1 text-[11px] font-black text-[#e64c70]" key={selected.applicationId}>
                {selected.nickname}{selected.age ? ` (${selected.age})` : ''}
              </span>
            ))}
          </div>
        ) : <p className="mt-2 text-[11px] font-bold text-[#999]">선택 0명</p>
      ) : null}
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return <div className="mt-3 rounded-[14px] border border-dashed border-[#dfe3e8] px-4 py-8 text-center text-[13px] font-bold text-[#999]">{text}</div>;
}

function formatSubmittedAt(value: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    day: '2-digit', hour: '2-digit', hour12: false, minute: '2-digit', month: '2-digit', timeZone: 'Asia/Seoul', year: 'numeric',
  }).format(new Date(value));
}

function formatEventDate(value: string) {
  const [year, month, day] = value.split('-');
  return `${year}.${month}.${day}`;
}

function BackIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" /></svg>;
}

function PersonIcon() {
  return <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.8" /><path d="M5.5 19c.7-4 3-6 6.5-6s5.8 2 6.5 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></svg>;
}
