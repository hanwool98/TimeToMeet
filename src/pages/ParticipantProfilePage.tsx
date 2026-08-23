import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import { getAppSession } from '../services/appAuth';
import {
  fetchMyParticipantProfile,
  updateMyParticipantProfileNickname,
  type MyParticipantProfile,
} from '../services/participantProfiles';

export default function ParticipantProfilePage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<MyParticipantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const session = getAppSession();
  const isMember = session?.role === 'member';

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError('');

    void fetchMyParticipantProfile()
      .then((nextProfile) => {
        if (!mounted) return;
        setProfile(nextProfile);
        setNickname(nextProfile?.nickname ?? '');
      })
      .catch((caughtError) => {
        if (!mounted) return;
        setError(caughtError instanceof Error ? caughtError.message : '참가 프로필을 불러오지 못했습니다.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const age = useMemo(() => {
    if (!profile?.birthDate) return '';
    const birth = new Date(profile.birthDate);
    const now = new Date();
    let nextAge = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) nextAge -= 1;
    return `${nextAge}세`;
  }, [profile?.birthDate]);

  const saveNickname = async () => {
    if (!profile || !isMember || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateMyParticipantProfileNickname(nickname);
      if (!updated) throw new Error('저장된 기본 프로필이 없습니다.');
      setProfile({ ...profile, nickname });
      window.dispatchEvent(new Event('time2meet:app-session-changed'));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '닉네임 저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!session) {
    return (
      <main className="app-page min-h-screen bg-white px-4 py-10 text-black min-[380px]:px-5">
        <ShellHeader onBack={() => navigate(-1)} />
        <EmptyCard
          buttonLabel="로그인"
          message="로그인 후 참가 프로필을 확인할 수 있습니다."
          onClick={() => navigate('/login?returnTo=/mypage/profile')}
        />
      </main>
    );
  }

  return (
    <main className="app-page min-h-screen w-full max-w-full overflow-x-hidden bg-white px-4 py-10 text-black min-[380px]:px-5">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <ShellHeader onBack={() => navigate(-1)} />

        <section className="mt-8 rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
          <h1 className="text-[28px] font-black leading-tight">참가 프로필</h1>
          <p className="mt-3 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#777]">
            {isMember
              ? '저장된 기본 참가 프로필을 확인하고, 다음 행사 신청에 재사용할 수 있습니다.'
              : '비회원은 현재 신청에 사용한 프로필만 확인할 수 있습니다.'}
          </p>
        </section>

        {loading ? (
          <EmptyCard message="참가 프로필을 불러오는 중입니다." />
        ) : error ? (
          <EmptyCard message={error} />
        ) : !profile ? (
          <EmptyCard
            buttonLabel="새 프로필 작성하기"
            message={isMember ? '저장된 기본 프로필이 없습니다' : '현재 확인할 참가 프로필이 없습니다'}
            onClick={() => navigate('/profile/new?mode=new')}
          />
        ) : (
          <div className="mt-7 space-y-6">
            <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-black text-meet-blue">
                    {profile.source === 'default_profile' ? '기본 참가 프로필' : '신청 프로필'}
                  </p>
                  <h2 className="mt-2 text-[25px] font-black">{profile.nickname}</h2>
                </div>
                <span className="rounded-full bg-meet-blueSoft px-3 py-1.5 text-[12px] font-black text-meet-blue">
                  {profile.accountType === 'member' ? '회원' : '비회원'}
                </span>
              </div>

              {isMember ? (
                <label className="mt-6 block">
                  <span className="text-[14px] font-black text-[#777]">닉네임</span>
                  <div className="mt-2 grid grid-cols-[minmax(0,1fr)_82px] gap-2">
                    <input
                      className="h-12 min-w-0 rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none"
                      onChange={(event) => setNickname(event.target.value)}
                      value={nickname}
                    />
                    <button
                      className="h-12 rounded-[18px] bg-meet-blue text-[14px] font-black text-white disabled:bg-[#c9d2db]"
                      disabled={saving || nickname.trim() === '' || nickname === profile.nickname}
                      onClick={saveNickname}
                      type="button"
                    >
                      저장
                    </button>
                  </div>
                </label>
              ) : null}

              <div className="mt-6 grid grid-cols-2 gap-3">
                <Info label="이름" value={profile.name} />
                <Info label="생년월일" value={profile.birthDate} />
                <Info label="나이" value={age} />
                <Info label="성별" value={profile.gender} />
                <Info label="거주지" value={profile.residence} />
                <Info label="전화번호" value={profile.phoneMasked} />
                <Info label="키" value={profile.height} />
                <Info label="직업" value={profile.job} />
              </div>

              <div className="mt-5 rounded-[20px] bg-meet-blueSoft p-4 text-[14px] font-extrabold leading-relaxed text-[#6f7680]">
                <p>결혼·교제 여부: {profile.relationshipStatus}</p>
                <p className="mt-2">프로필 사진: {profile.profilePhotoCount}장</p>
                <p>대표사진: {profile.representativePhotoIndex + 1}번째 사진</p>
                <p>3초 자기소개: {profile.hasVoiceIntro ? '저장됨' : '없음'}</p>
                <p>신분증 인증 자료: {profile.hasIdPhoto ? '저장됨' : '없음'}</p>
                <p>재직 증명: {profile.hasEmploymentProof ? '저장됨' : '없음'}</p>
              </div>
            </section>

            <section className="rounded-[28px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
              <h2 className="text-[21px] font-black">주요 정보 변경</h2>
              <p className="mt-3 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#777]">
                주요 정보가 변경되었다면 새 프로필을 작성해주세요.
              </p>
              <PrimaryButton className="mt-5" onClick={() => navigate('/profile/new?mode=new')}>
                새 프로필 작성하기
              </PrimaryButton>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}

function ShellHeader({ onBack }: { onBack: () => void }) {
  return (
    <header className="flex items-center justify-between">
      <button aria-label="뒤로 가기" className="grid h-11 w-11 place-items-center text-black" onClick={onBack} type="button">
        <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
          <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
          <path d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
        </svg>
      </button>
      <LogoMark className="h-14 w-14 rounded-full" />
    </header>
  );
}

function EmptyCard({ buttonLabel, message, onClick }: { buttonLabel?: string; message: string; onClick?: () => void }) {
  return (
    <section className="mt-7 rounded-[28px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
      <p className="text-fluid-safe text-[16px] font-black text-[#777]">{message}</p>
      {buttonLabel && onClick ? (
        <PrimaryButton className="mt-5" onClick={onClick}>
          {buttonLabel}
        </PrimaryButton>
      ) : null}
    </section>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[18px] bg-[#f8fbff] p-3">
      <p className="text-[12px] font-black text-[#888]">{label}</p>
      <p className="mt-1 min-w-0 break-words text-[15px] font-black">{value || '-'}</p>
    </div>
  );
}
