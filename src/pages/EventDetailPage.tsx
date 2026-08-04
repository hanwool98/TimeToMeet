import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ParticipantList, { avatarSheet, getAvatarPosition } from '../components/ParticipantList';
import { events } from '../data/events';
import { participants } from '../data/participants';
import PrimaryButton from '../components/PrimaryButton';
import type { ParticipantData } from '../types/participant';

export default function EventDetailPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [previewParticipant, setPreviewParticipant] = useState<ParticipantData | null>(null);
  const event = events.find((item) => item.id === eventId);
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-2 py-12 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[430px] flex-col justify-center">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-6 pt-16 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            로고
          </div>
          <div className="text-center">
            <h1 className="text-[25px] font-black leading-tight tracking-normal">
              타임투밋 로테이션소개팅
            </h1>
            <p className="mt-4 rounded-[18px] bg-meet-blueSoft px-2 py-3 text-[15px] font-black leading-snug">
              26년 8월 16일 (일) 15:00 체험단 소개팅
            </p>
          </div>

          <div className="mt-5 rounded-[26px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {event ? (
              <div className="grid grid-cols-2 gap-1.5">
                <ParticipantList
                  onAvatarClick={setPreviewParticipant}
                  participants={maleParticipants}
                  title="남"
                />
                <ParticipantList
                  onAvatarClick={setPreviewParticipant}
                  participants={femaleParticipants}
                  title="여"
                />
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
            )}
          </div>

          <div className="pt-5">
            <PrimaryButton onClick={() => navigate('/profile-ready')}>
              프로필 작성완료하고 소개팅 참여하기
            </PrimaryButton>
          </div>
        </section>
        <Link className="mx-auto mt-5 text-sm font-extrabold text-meet-blue" to="/">
          캘린더로 돌아가기
        </Link>
      </div>
      {previewParticipant ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-30 grid place-items-center bg-black/35 px-8"
          role="dialog"
        >
          <div className="w-full max-w-[320px] rounded-[30px] bg-white p-5 shadow-calendar">
            <div
              aria-label={`${previewParticipant.nickname} 확대 대표 사진`}
              className="aspect-square w-full rounded-[24px] bg-cover bg-center bg-no-repeat blur-[1.8px]"
              role="img"
              style={{
                backgroundImage: `url(${avatarSheet})`,
                backgroundPosition: getAvatarPosition(previewParticipant.avatarIndex),
                backgroundSize: '440% 330%',
              }}
            />
            <p className="mt-4 text-center text-[18px] font-black">{previewParticipant.nickname}</p>
            <button
              className="mt-4 h-12 w-full rounded-[18px] bg-meet-blue text-[15px] font-extrabold text-white"
              onClick={() => setPreviewParticipant(null)}
              type="button"
            >
              닫기
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
