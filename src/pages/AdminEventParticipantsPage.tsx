import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import ParticipantList, { getAvatarPosition } from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import type { ParticipantData } from '../types/participant';
import { getEventsWithParticipantCounts, getParticipantsForEvent } from '../utils/adminApplications';

const adminProfileSheet = '/assets/admin-profile-photos.svg';

export default function AdminEventParticipantsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [previewParticipant, setPreviewParticipant] = useState<ParticipantData | null>(null);
  const events = getEventsWithParticipantCounts();
  const participants = getParticipantsForEvent(eventId);
  const event = events.find((item) => item.id === eventId);
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-2 py-12 text-black">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-[430px] flex-col justify-center">
        <section className="relative rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-6 pt-16 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="text-center">
            <h1 className="text-[25px] font-black leading-tight tracking-normal">타임투밋 로테이션소개팅</h1>
            <p className="mt-4 rounded-[18px] bg-meet-blueSoft px-2 py-3 text-[15px] font-black leading-snug">
              {event ? `${formatShortKoreanDate(event.date)} ${event.startTime} 체험단 소개팅` : '행사 정보를 불러올 수 없습니다'}
            </p>
          </div>

          <div className="mt-5 rounded-[26px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {event ? (
              <div className="grid grid-cols-2 gap-1.5">
                <ParticipantList onProfileClick={setPreviewParticipant} participants={maleParticipants} title="남" />
                <ParticipantList onProfileClick={setPreviewParticipant} participants={femaleParticipants} title="여" />
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
            )}
          </div>

          <div className="pt-5">
            <PrimaryButton disabled={!event} onClick={() => navigate(`/admin/events/${eventId}/edit`)}>
              행사 수정
            </PrimaryButton>
          </div>
        </section>
        <Link className="mx-auto mt-5 text-sm font-extrabold text-meet-blue" to="/admin/events">
          행사관리로 돌아가기
        </Link>
      </div>
      {previewParticipant ? (
        <div aria-modal="true" className="fixed inset-0 z-30 grid place-items-center bg-black/35 px-4" role="dialog">
          <div className="max-h-[86vh] w-full max-w-[390px] overflow-y-auto rounded-[30px] bg-white p-5 shadow-calendar">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[14px] font-extrabold text-[#8a8a8a]">{previewParticipant.nickname}</p>
                <h2 className="mt-1 text-[23px] font-black leading-tight">참가자 프로필</h2>
              </div>
              <button
                aria-label="프로필 닫기"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black"
                onClick={() => setPreviewParticipant(null)}
                type="button"
              >
                ×
              </button>
            </div>

            {previewParticipant.profile ? (
              <div className="mt-5 space-y-3">
                <ProfileRow label="3. 이름" value={previewParticipant.profile.name} />
                <ProfileRow label="4. 생년월일" value={previewParticipant.profile.birthDate} />
                <ProfileRow label="5. 성별" value={previewParticipant.profile.genderLabel} />
                <ProfileRow label="6. 거주지" value={previewParticipant.profile.residence} />
                <ProfileRow label="7. 전화번호" value={previewParticipant.profile.phone} />
                <ProfileRow label="8. 결혼 및 교제 여부" value={previewParticipant.profile.relationshipStatus} />
                <ProfileImageSection
                  label="9. 본인확인용 신분증 사진 첨부"
                  participant={previewParticipant}
                  type="id"
                  value={previewParticipant.profile.idPhotoStatus}
                />
                <ProfileRow label="10. 닉네임" value={previewParticipant.profile.nickname} />
                <ProfilePhotoGallery participant={previewParticipant} value={previewParticipant.profile.profilePhotos} />
                <ProfileVoicePreview />
                <ProfileRow label="13. 키" value={previewParticipant.profile.height} />
                <ProfileRow label="14. 직업" value={previewParticipant.profile.job} />
                <ProfileImageSection
                  label="15. 재직 증명"
                  participant={previewParticipant}
                  type="employment"
                  value={previewParticipant.profile.employmentProof}
                />
                <ProfileRow label="16. 접속 경로" value={previewParticipant.profile.accessRoute} />
                <ProfileRow label="17. 촬영 동의 (모자이크)" value={previewParticipant.profile.shootingConsent} />
                <ProfileRow label="18. 인터뷰 여부" value={previewParticipant.profile.interviewConsent} />
                <ProfileRow label="19. 환불규정" value={previewParticipant.profile.refundAgreement} />
                <ProfileRow label="20. 타임투밋 문의사항" value={previewParticipant.profile.inquiry} />
                <ProfileRow label="21. 심사 후 개별 연락 안내" value={previewParticipant.profile.reviewNotice} />
              </div>
            ) : (
              <p className="mt-5 rounded-[20px] bg-meet-blueSoft p-4 text-[15px] font-black text-[#555]">
                등록된 프로필 정보가 없습니다.
              </p>
            )}

            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                className="h-12 rounded-[18px] bg-meet-pink text-[14px] font-black text-white transition active:scale-[0.99]"
                onClick={() => {
                  if (window.confirm('참여 취소 처리하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                    window.alert('참여 취소 처리 준비중!');
                  }
                }}
                type="button"
              >
                참여 취소
              </button>
              <button
                className="h-12 rounded-[18px] bg-[#d9d9d9] text-[14px] font-black text-black transition active:scale-[0.99]"
                onClick={() => {
                  if (window.confirm('참여 대기로 전환하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                    window.alert('참여 대기 전환 준비중!');
                  }
                }}
                type="button"
              >
                참여 대기 전환
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function formatShortKoreanDate(dateValue: string) {
  const [year, month, day] = dateValue.split('-').map(Number);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  const date = new Date(year, month - 1, day);
  return `${String(year).slice(2)}년 ${month}월 ${day}일 (${dayNames[date.getDay()]})`;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <section className="rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 break-keep text-[16px] font-black leading-snug text-black">{value}</p>
    </section>
  );
}

function ProfileImageSection({
  label,
  participant,
  type,
  value,
}: {
  label: string;
  participant: ParticipantData;
  type: 'id' | 'employment';
  value: string;
}) {
  return (
    <section className="rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 break-keep text-[16px] font-black leading-snug text-black">{value}</p>
      <div className="mt-3 overflow-hidden rounded-[18px] bg-white shadow-sm">
        <div
          className="h-[160px] bg-cover bg-center"
          style={{
            backgroundImage: `url(${adminProfileSheet})`,
            backgroundPosition: getAvatarPosition(participant.avatarIndex + (type === 'id' ? 1 : 2)),
            backgroundSize: '440% 330%',
          }}
        />
      </div>
    </section>
  );
}

function ProfilePhotoGallery({ participant, value }: { participant: ParticipantData; value: string }) {
  const labels = ['대표사진', '사진 2', '사진 3'];

  return (
    <section className="rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">11. 프로필 사진</p>
      <p className="mt-1 break-keep text-[16px] font-black leading-snug text-black">{value}</p>
      <div className="mt-3 space-y-3">
        {labels.map((label, index) => (
          <div className="overflow-hidden rounded-[20px] bg-white shadow-sm" key={label}>
            <div
              className="aspect-[4/5] bg-cover bg-center saturate-[0.95]"
              style={{
                backgroundImage: `url(${adminProfileSheet})`,
                backgroundPosition: getAvatarPosition(participant.avatarIndex + index),
                backgroundSize: '440% 330%',
              }}
            />
            <p className="px-4 py-3 text-[13px] font-black text-black">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProfileVoicePreview() {
  return (
    <section className="rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">12. 너의 목소리가 보여</p>
      <button
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[18px] bg-white text-[15px] font-black text-meet-pink shadow-sm"
        onClick={() => window.alert('샘플 음성입니다.')}
        type="button"
      >
        <span className="h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-meet-pink" />
        5초 자기소개 재생
      </button>
    </section>
  );
}
