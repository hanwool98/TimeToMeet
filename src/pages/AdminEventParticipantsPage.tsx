import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import LogoMark from '../components/LogoMark';
import ParticipantList from '../components/ParticipantList';
import PrimaryButton from '../components/PrimaryButton';
import useOperationalData from '../hooks/useOperationalData';
import {
  createTestEventPreviewLink,
  createTestParticipants,
  deleteEventFromSupabase,
  fetchAdminApplicationFiles,
  fetchAdminEventParticipantMedia,
  resetTestEventData,
  updateApplicationReviewInSupabase,
} from '../services/supabaseApplications';
import type { AdminApplicationFiles, SignedApplicationFile } from '../services/supabaseApplications';
import type { ParticipantData, ParticipantProfile } from '../types/participant';
import type { StoredApplication } from '../utils/adminApplications';

interface ParticipantMediaRow {
  audioUrl: string | null;
  photoUrl: string | null;
  representativeCrop: { scale: number; offsetX: number; offsetY: number } | null;
}

export default function AdminEventParticipantsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [previewParticipant, setPreviewParticipant] = useState<ParticipantData | null>(null);
  const [previewFiles, setPreviewFiles] = useState<AdminApplicationFiles | null>(null);
  const [previewFilesLoading, setPreviewFilesLoading] = useState(false);
  const [previewFilesError, setPreviewFilesError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [testActionBusy, setTestActionBusy] = useState(false);
  const [participantMedia, setParticipantMedia] = useState<Map<string, ParticipantMediaRow>>(new Map());
  const { applications, error, events, loading, reload } = useOperationalData({ admin: true, eventId });
  const event = events.find((item) => item.id === eventId);

  useEffect(() => {
    if (!eventId) return;
    let active = true;
    fetchAdminEventParticipantMedia(eventId)
      .then((media) => {
        if (active) setParticipantMedia(media);
      })
      .catch(() => {
        if (active) setParticipantMedia(new Map());
      });
    return () => {
      active = false;
    };
  }, [eventId]);

  const participants = applications
    .filter((application) => event && application.status === '참가 확정' && application.eventId === eventId)
    .map((application, index) => applicationToParticipant(application, index, participantMedia));
  const maleParticipants = participants.filter((participant) => participant.gender === 'male');
  const femaleParticipants = participants.filter((participant) => participant.gender === 'female');
  const maleCapacity = Math.max(1, event?.maleCapacity ?? Math.ceil((event?.targetParticipants ?? 0) / 2));
  const femaleCapacity = Math.max(1, event?.femaleCapacity ?? Math.floor((event?.targetParticipants ?? 0) / 2));
  const previewApplication = previewParticipant
    ? applications.find((application) => (application.dbId ?? application.id) === previewParticipant.id) ?? null
    : null;

  const loadPreviewFiles = useCallback(async () => {
    if (!previewApplication) return;
    setPreviewFilesLoading(true);
    setPreviewFilesError('');
    try {
      setPreviewFiles(await fetchAdminApplicationFiles(previewApplication));
    } catch (caughtError) {
      setPreviewFiles(null);
      setPreviewFilesError(caughtError instanceof Error ? caughtError.message : '제출 자료를 불러오지 못했습니다.');
    } finally {
      setPreviewFilesLoading(false);
    }
  }, [previewApplication]);

  useEffect(() => {
    setPreviewFiles(null);
    setPreviewFilesError('');
    if (previewApplication) void loadPreviewFiles();
  }, [loadPreviewFiles, previewApplication]);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  const handleDeleteEvent = async () => {
    if (!event || !eventId) return;
    if (!window.confirm('행사를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    setDeleting(true);
    try {
      await deleteEventFromSupabase(eventId);
      navigate('/admin/events');
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '관리자 인증 또는 Supabase 상태를 확인해주세요.';
      window.alert(`행사를 삭제하지 못했습니다. ${message}`);
    } finally {
      setDeleting(false);
    }
  };

  const updatePreviewApplicationStatus = async (status: '자동 취소' | '참여 보류', reason: string) => {
    if (!previewApplication) return;
    await updateApplicationReviewInSupabase(previewApplication, status, {
      reason,
      reviewedAt: new Date().toISOString(),
    });
    await reload();
    setPreviewParticipant(null);
  };

  const handleCreatePreviewLink = async () => {
    if (!eventId || testActionBusy) return;
    setTestActionBusy(true);
    try {
      const { token, expiresAt } = await createTestEventPreviewLink(eventId);
      const url = `${window.location.origin}/events/${eventId}?previewToken=${token}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        // Clipboard access can fail (permissions, non-secure context) - the
        // link is still shown in the alert below either way.
      }
      window.alert(
        `테스트 참가 링크가 복사되었습니다 (${new Date(expiresAt).toLocaleString('ko-KR')}까지 유효):\n\n${url}`,
      );
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '테스트 링크 생성에 실패했습니다.');
    } finally {
      setTestActionBusy(false);
    }
  };

  const handleCreateTestParticipants = async () => {
    if (!eventId || !event || testActionBusy) return;
    const input = window.prompt(
      '생성할 남/여 인원 수를 "남,여" 형식으로 입력해주세요. (예: 5,5)',
      `${maleCapacity},${femaleCapacity}`,
    );
    if (!input) return;
    const [maleText, femaleText] = input.split(',').map((value) => value.trim());
    const maleCount = Number(maleText);
    const femaleCount = Number(femaleText);
    if (!Number.isInteger(maleCount) || !Number.isInteger(femaleCount) || maleCount < 0 || femaleCount < 0) {
      window.alert('숫자 형식이 올바르지 않습니다.');
      return;
    }
    setTestActionBusy(true);
    try {
      const created = await createTestParticipants(eventId, maleCount, femaleCount);
      await reload();
      window.alert(`테스트 참가자 ${created}명을 생성했습니다.`);
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '테스트 참가자 생성에 실패했습니다.');
    } finally {
      setTestActionBusy(false);
    }
  };

  const handleResetTestData = async () => {
    if (!eventId || testActionBusy) return;
    if (!window.confirm('이 테스트 행사의 신청/참가확정/결제/체크인/태블릿 연결 데이터를 모두 초기화할까요? 행사 자체는 삭제되지 않습니다. 되돌릴 수 없습니다.')) {
      return;
    }
    setTestActionBusy(true);
    try {
      await resetTestEventData(eventId);
      await reload();
      window.alert('테스트 데이터를 초기화했습니다.');
    } catch (caughtError) {
      window.alert(caughtError instanceof Error ? caughtError.message : '테스트 데이터 초기화에 실패했습니다.');
    } finally {
      setTestActionBusy(false);
    }
  };

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white px-2 py-12 text-black">
      <div className="mobile-container mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-full min-w-0 flex-col justify-center">
        <section className="relative w-full max-w-full min-w-0 rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-6 pt-16 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="text-center">
            <h1 className="text-fluid-safe text-[25px] font-black leading-tight tracking-normal">타임투밋 로테이션소개팅</h1>
            <p className="mt-4 rounded-[18px] bg-meet-blueSoft px-2 py-3 text-[15px] font-black leading-snug">
              {event ? `${formatShortKoreanDate(event.date)} ${event.startTime} 체험단 소개팅` : '행사 정보를 불러올 수 없습니다'}
            </p>
          </div>

          <div className="mt-5 w-full max-w-full min-w-0 rounded-[26px] bg-meet-blueSoft p-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]">
            {event ? (
              <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-1.5">
                <ParticipantList capacity={maleCapacity} onProfileClick={setPreviewParticipant} participants={maleParticipants} title="남" />
                <ParticipantList capacity={femaleCapacity} onProfileClick={setPreviewParticipant} participants={femaleParticipants} title="여" />
              </div>
            ) : (
              <div className="px-6 py-16 text-center text-[18px] font-black">행사를 찾을 수 없습니다</div>
            )}
          </div>

          <div className="grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3 pt-5">
            <PrimaryButton disabled={!event} onClick={() => navigate(`/admin/events/${eventId}/edit`)}>
              행사 수정
            </PrimaryButton>
            <button
              className="h-14 rounded-[18px] bg-meet-pink px-5 text-[16px] font-extrabold text-white shadow-sm transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!event || deleting}
              onClick={handleDeleteEvent}
              type="button"
            >
              {deleting ? '삭제 중' : '행사 삭제'}
            </button>
          </div>

          {event?.isTestEvent ? (
            <div className="mt-5 w-full max-w-full min-w-0 rounded-[22px] border border-meet-blue/25 bg-meet-blueSoft/40 p-4">
              <p className="text-[14px] font-black text-meet-blue">🧪 TEST · 남 {maleCapacity} / 여 {femaleCapacity} · {event.malePrice === 0 && event.femalePrice === 0 ? '0원' : '유료'}</p>
              <p className="mt-1 text-[12px] font-extrabold text-[#8a93a3]">일반 사용자에게는 노출되지 않는 관리자 테스트 전용 행사입니다.</p>
              <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
                <button
                  className="h-12 rounded-[14px] bg-meet-blue text-[13px] font-black text-white transition active:scale-[0.99] disabled:opacity-50"
                  disabled={testActionBusy}
                  onClick={() => void handleCreatePreviewLink()}
                  type="button"
                >
                  참가자 화면으로 테스트
                </button>
                <button
                  className="h-12 rounded-[14px] bg-white text-[13px] font-black text-meet-blue shadow-sm transition active:scale-[0.99]"
                  onClick={() => navigate('/admin/applications')}
                  type="button"
                >
                  신청 관리
                </button>
                <button
                  className="h-12 rounded-[14px] bg-white text-[13px] font-black text-meet-blue shadow-sm transition active:scale-[0.99] disabled:opacity-50"
                  disabled={testActionBusy}
                  onClick={() => void handleCreateTestParticipants()}
                  type="button"
                >
                  테스트 참가자 생성
                </button>
                <button
                  className="h-12 rounded-[14px] bg-white text-[13px] font-black text-meet-blue shadow-sm transition active:scale-[0.99]"
                  onClick={() => navigate(`/admin/events/${eventId}/check-in`)}
                  type="button"
                >
                  행사모드 입장
                </button>
                <button
                  className="col-span-2 h-12 rounded-[14px] bg-meet-pinkSoft text-[13px] font-black text-meet-pink transition active:scale-[0.99] disabled:opacity-50"
                  disabled={testActionBusy}
                  onClick={() => void handleResetTestData()}
                  type="button"
                >
                  테스트 데이터 초기화
                </button>
              </div>
            </div>
          ) : null}
        </section>
        <Link className="mx-auto mt-5 text-sm font-extrabold text-meet-blue" to="/admin/events">
          행사관리로 돌아가기
        </Link>
      </div>
      {previewParticipant ? (
        <div aria-modal="true" className="fixed inset-0 z-30 grid place-items-center bg-black/35 px-4" role="dialog">
          <div className="max-h-[86dvh] w-full max-w-[390px] min-w-0 overflow-y-auto rounded-[30px] bg-white p-4 shadow-calendar min-[380px]:p-5">
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
                  file={previewFiles?.idPhoto}
                  filesError={previewFilesError}
                  filesLoading={previewFilesLoading}
                  label="9. 본인확인용 신분증 사진 첨부"
                  onRetry={loadPreviewFiles}
                  value={previewParticipant.profile.idPhotoStatus}
                />
                <ProfileRow label="10. 닉네임" value={previewParticipant.profile.nickname} />
                <ProfilePhotoGallery
                  files={previewFiles}
                  filesError={previewFilesError}
                  filesLoading={previewFilesLoading}
                  onRetry={loadPreviewFiles}
                  value={previewParticipant.profile.profilePhotos}
                />
                <ProfileVoicePreview
                  file={previewFiles?.voiceIntro}
                  filesError={previewFilesError}
                  filesLoading={previewFilesLoading}
                  onRetry={loadPreviewFiles}
                />
                <ProfileRow label="13. 키" value={previewParticipant.profile.height} />
                <ProfileRow label="14. 직업" value={previewParticipant.profile.job} />
                <ProfileImageSection
                  file={previewFiles?.employmentProof}
                  filesError={previewFilesError}
                  filesLoading={previewFilesLoading}
                  label="15. 재직 증명"
                  onRetry={loadPreviewFiles}
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

            <div className="mt-4 grid w-full max-w-full min-w-0 grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
              <button
                className="h-12 rounded-[18px] bg-meet-pink text-[14px] font-black text-white transition active:scale-[0.99]"
                onClick={() => {
                  if (window.confirm('참여 취소 처리하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                    void updatePreviewApplicationStatus('자동 취소', '관리자 참여 취소 처리').catch((caughtError) => {
                      window.alert(caughtError instanceof Error ? caughtError.message : '참여 취소 처리에 실패했습니다.');
                    });
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
                    void updatePreviewApplicationStatus('참여 보류', '관리자 참여 대기 전환').catch((caughtError) => {
                      window.alert(caughtError instanceof Error ? caughtError.message : '참여 대기 전환에 실패했습니다.');
                    });
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


function applicationToParticipant(
  application: StoredApplication,
  index: number,
  media: Map<string, ParticipantMediaRow>,
): ParticipantData {
  const profile = application.profile ?? createEmptyProfile(application);
  const id = application.dbId ?? application.id;
  const participantMedia = media.get(id);

  return {
    audioIntroUrl: participantMedia?.audioUrl ?? undefined,
    avatarIndex: index,
    gender: application.gender === '여성' ? 'female' : 'male',
    id,
    nickname: profile.nickname,
    photoUrl: participantMedia?.photoUrl ?? undefined,
    profile,
    representativeCrop: participantMedia?.representativeCrop ?? undefined,
    tags: [`${application.age}세`, profile.job],
  };
}

function createEmptyProfile(application: StoredApplication): ParticipantProfile {
  return {
    accessRoute: '',
    birthDate: '',
    employmentProof: '',
    genderLabel: application.gender,
    height: '',
    idPhotoStatus: '',
    inquiry: '',
    interviewConsent: '',
    job: '',
    name: '',
    nickname: application.userId,
    phone: '',
    profilePhotos: '',
    refundAgreement: '',
    relationshipStatus: '',
    residence: '',
    reviewNotice: '',
    shootingConsent: '',
    voiceIntro: '',
  };
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 text-fluid-safe text-[16px] font-black leading-snug text-black">{value}</p>
    </section>
  );
}

function ProfileImageSection({
  file,
  filesError,
  filesLoading,
  label,
  onRetry,
  value,
}: {
  file?: SignedApplicationFile;
  filesError: string;
  filesLoading: boolean;
  label: string;
  onRetry: () => void;
  value: string;
}) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">{label}</p>
      <p className="mt-1 text-fluid-safe text-[16px] font-black leading-snug text-black">{value}</p>
      <FilePreview file={file} filesError={filesError} filesLoading={filesLoading} kind="image" onRetry={onRetry} />
    </section>
  );
}

function ProfilePhotoGallery({
  files,
  filesError,
  filesLoading,
  onRetry,
  value,
}: {
  files: AdminApplicationFiles | null;
  filesError: string;
  filesLoading: boolean;
  onRetry: () => void;
  value: string;
}) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">11. 프로필 사진</p>
      <p className="mt-1 text-fluid-safe text-[16px] font-black leading-snug text-black">{value}</p>
      {filesLoading || filesError || !files ? (
        <FilePreview filesError={filesError} filesLoading={filesLoading} kind="image" onRetry={onRetry} />
      ) : files.profilePhotos.length > 0 ? (
        <div className="mt-3 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2">
          {files.profilePhotos.map((file, index) => (
            <a className="relative block overflow-hidden rounded-[16px] bg-white shadow-sm" href={file.signedUrl} key={file.path} rel="noreferrer" target="_blank">
              {file.signedUrl ? <img alt={`프로필 사진 ${index + 1}`} className="aspect-square w-full object-cover" src={file.signedUrl} /> : <MissingFile text={file.errorMessage ?? '파일을 불러오지 못했습니다.'} />}
              {index === files.representativeIndex ? <span className="absolute left-2 top-2 rounded-full bg-meet-blue px-2 py-1 text-[10px] font-black text-white">대표사진</span> : null}
            </a>
          ))}
        </div>
      ) : (
        <MissingFile text="제출된 사진이 없습니다." />
      )}
    </section>
  );
}

function ProfileVoicePreview({
  file,
  filesError,
  filesLoading,
  onRetry,
}: {
  file?: SignedApplicationFile;
  filesError: string;
  filesLoading: boolean;
  onRetry: () => void;
}) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[20px] bg-meet-blueSoft px-4 py-3">
      <p className="text-[13px] font-black text-[#8a8a8a]">12. 너의 목소리가 보여</p>
      <FilePreview file={file} filesError={filesError} filesLoading={filesLoading} kind="audio" onRetry={onRetry} />
    </section>
  );
}

function FilePreview({
  file,
  filesError,
  filesLoading,
  kind,
  onRetry,
}: {
  file?: SignedApplicationFile;
  filesError: string;
  filesLoading: boolean;
  kind: 'audio' | 'image';
  onRetry: () => void;
}) {
  if (filesLoading) return <MissingFile text="제출 자료를 불러오는 중입니다." />;
  if (filesError) {
    return (
      <div className="mt-3 rounded-[18px] bg-white p-4 text-center text-[13px] font-black text-meet-pink shadow-sm">
        <p>{filesError}</p>
        <button className="mt-3 text-meet-blue underline" onClick={onRetry} type="button">
          다시 불러오기
        </button>
      </div>
    );
  }
  if (!file) return <MissingFile text={kind === 'audio' ? '제출된 음성이 없습니다.' : '제출된 사진이 없습니다.'} />;
  if (!file.signedUrl) return <MissingFile text={file.errorMessage ?? '파일을 불러오지 못했습니다.'} />;
  if (kind === 'audio') return <audio className="mt-3 w-full" controls src={file.signedUrl} />;
  return (
    <a className="mt-3 block overflow-hidden rounded-[18px] bg-white shadow-sm" href={file.signedUrl} rel="noreferrer" target="_blank">
      <img alt={file.fileName} className="max-h-[280px] w-full object-contain" src={file.signedUrl} />
    </a>
  );
}

function MissingFile({ text }: { text: string }) {
  return (
    <div className="mt-3 grid min-h-[120px] place-items-center rounded-[18px] border border-dashed border-[#d7e2ee] bg-white p-4 text-center text-[13px] font-black text-[#8a8a8a]">
      {text}
    </div>
  );
}
