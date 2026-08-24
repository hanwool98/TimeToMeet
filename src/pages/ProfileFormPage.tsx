import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import BirthDateSelect from '../components/BirthDateSelect';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import LogoMark from '../components/LogoMark';
import PrimaryButton from '../components/PrimaryButton';
import { RefundPolicyBox } from '../data/refundPolicy';
import useOperationalData from '../hooks/useOperationalData';
import { getAppSession } from '../services/appAuth';
import {
  ApplicationSubmitError,
  fetchApplicationDraft,
  fetchOwnApplicationForEvent,
  getCachedTestEventPreviewToken,
  logApplicationError,
  saveApplicationDraft,
  submitApplicationToSupabase,
} from '../services/supabaseApplications';
import { formatKoreanPhone, normalizeKoreanPhone } from '../services/guestPinAuth';
import { compressImageIfNeeded, maxTotalUploadBytes } from '../utils/imageCompression';
import { representativeCropTransform } from '../utils/representativeCrop';

const requiredConsentText = [
  {
    id: 'privacy',
    title: '개인정보 수집 및 이용 동의 (필수)',
    body: [
      '타임투밋은 회원 확인, 참가 신청 및 행사 운영, 참가자 간 매칭 서비스 제공을 위해 개인정보를 수집·이용합니다.',
      '수집·이용 목적: 본인 및 연령 확인, 참가자 프로필 작성 및 관리, 행사 신청, 참가자 선정 및 안내, 행사 운영 및 참가자 간 매칭, 부정 이용 방지, 신고 및 분쟁 처리, 고객 문의 및 공지사항 전달',
      '수집하는 개인정보: 이름, 성별, 생년월일, 휴대전화번호, 거주지역, 직업, 프로필 사진, 자기소개 및 프로필 작성 내용',
      '서비스 이용 과정에서 생성되는 정보: 행사 신청·참여 이력, 호감 선택 및 매칭 결과, 신고·문의 내역',
      '결제 시 수집되는 정보: 결제 내역, 환불에 필요한 정보. 카드번호 등 결제수단 정보는 결제대행사가 직접 처리하며 타임투밋이 저장하지 않습니다.',
      '회원 탈퇴 또는 개인정보 수집·이용 목적 달성 시까지 보관한 후 지체 없이 파기합니다. 다만 관계 법령 또는 신고 및 분쟁 처리를 위해 필요한 기록은 정해진 기간 동안 보관할 수 있습니다.',
      '동의를 거부할 권리가 있으나, 거부 시 프로필 작성, 행사 신청 및 참가가 제한될 수 있습니다.',
    ],
  },
  {
    id: 'thirdParty',
    title: '개인정보 제3자 제공 동의 (필수)',
    body: [
      '타임투밋은 행사 진행과 참가자 간 매칭을 위해 개인정보를 다른 참가자에게 제공합니다.',
      '프로필 정보 제공: 모자이크된 대표사진, 닉네임, 연령대, 직업, 3초 자기소개 음성',
      '제공받는 자: 신청자가 참가하는 동일 타임투밋 행사에 최종 선정된 참가자 혹은 참여를 희망하는 자',
      '제공 목적: 행사 참가자 확인, 대화 및 매칭을 위한 프로필 열람',
      '제공 항목: 프로필 사진, 닉네임 또는 이름, 연령대, 직업, 거주지역, 자기소개 및 신청자가 프로필에 직접 입력한 공개 정보',
      '생년월일 전체, 휴대전화번호, 본인 확인 자료 및 결제정보는 공개되지 않습니다.',
      '매칭 결과 및 연락처는 서로 호감을 선택하여 최종 매칭된 상대방에게 제공될 수 있으며, 제공 목적 달성 시까지 이용됩니다.',
      '동의를 거부할 권리가 있으나, 거부 시 행사 신청 및 참가가 제한될 수 있습니다.',
    ],
  },
];

const routeOptions = ['지인', '인스타그램', '검색', '유튜브', '네이버 블로그', '기타'];

function getAgeOnEventDate(birthDate: string, eventDateValue?: string) {
  if (!birthDate) return null;
  if (!eventDateValue) return null;
  const [year, month, day] = eventDateValue.split('-').map(Number);
  if (!year || !month || !day) return null;
  const eventDate = new Date(year, month - 1, day);
  const birth = new Date(birthDate);
  let age = eventDate.getFullYear() - birth.getFullYear();
  const monthDiff = eventDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && eventDate.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

// Matches the circular crop target's CSS size (h-[96vw] max-h-[430px] w-[96vw] max-w-[430px]).
function getRepresentativeCropBoxSize() {
  if (typeof window === 'undefined') return 320;
  return Math.min(window.innerWidth * 0.96, 430);
}

// A box rendered at `scale` only has (scale - 1) / 2 box-widths of pan slack per side.
function clampRepresentativeOffset(offset: number, scale: number) {
  const maxOffsetFraction = Math.max(0, (scale - 1) / 2);
  return Math.max(-maxOffsetFraction, Math.min(maxOffsetFraction, offset));
}

function useObjectUrl(file?: Blob | null) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setUrl('');
      return undefined;
    }
    const nextUrl = URL.createObjectURL(file);
    setUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  return url;
}

function useObjectUrls(files: File[]) {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const nextUrls = files.map((file) => URL.createObjectURL(file));
    setUrls(nextUrls);
    return () => nextUrls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  return urls;
}

export function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export function getAudioFileName(mimeType: string) {
  if (mimeType.includes('mp4')) return 'voice-intro.m4a';
  if (mimeType.includes('ogg')) return 'voice-intro.ogg';
  if (mimeType.includes('webm')) return 'voice-intro.webm';
  return 'voice-intro.audio';
}

export const voiceRecordingMaxSeconds = 3;

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-8 w-8" fill="none" viewBox="0 0 48 48">
      <path d="M18 12L7 23L18 34" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
      <path d="M9 23H31C37 23 41 27 41 33C41 39 37 43 31 43H19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6" />
    </svg>
  );
}

function Section({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="w-full max-w-full min-w-0 rounded-[30px] border border-[#f0f3f6] bg-white p-4 shadow-calendar min-[380px]:p-5">
      <h2 className="mb-5 text-fluid-safe text-[22px] font-black leading-tight">{title}</h2>
      {children}
    </section>
  );
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-2 text-[12px] font-extrabold text-meet-pink">{children}</p>;
}

function UploadBox({
  label,
  multiple = false,
  onFiles,
  onRemove,
  previewUrl,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  onRemove?: () => void;
  previewUrl?: string;
}) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [showPicker, setShowPicker] = useState(false);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    onFiles(Array.from(files ?? []));
    event.target.value = '';
  };

  return (
    <div>
      <div className="relative">
        <button
          aria-label={previewUrl ? `${label} 변경` : label}
          className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-[22px] bg-meet-blueSoft text-meet-blue"
          onClick={() => setShowPicker(true)}
          type="button"
        >
          {previewUrl ? (
            <>
              <img alt={`${label} 미리보기`} className="h-full w-full object-cover" src={previewUrl} />
              <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-black text-white">
                사진 변경
              </span>
            </>
          ) : (
            <span className="text-center">
              <span className="block text-[42px] font-black leading-none">+</span>
              <span className="mt-2 block text-[13px] font-black">사진 추가</span>
            </span>
          )}
        </button>
        {previewUrl && onRemove ? (
          <button
            aria-label={`${label} 삭제`}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-black/65 text-[18px] font-black leading-none text-white"
            onClick={onRemove}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>
      <input
        accept="image/*"
        aria-hidden="true"
        capture="environment"
        onChange={handleChange}
        ref={cameraInputRef}
        style={{ display: 'none' }}
        tabIndex={-1}
        type="file"
      />
      <input
        accept="image/*"
        aria-hidden="true"
        multiple={multiple}
        onChange={handleChange}
        ref={galleryInputRef}
        style={{ display: 'none' }}
        tabIndex={-1}
        type="file"
      />
      {showPicker ? (
        <PhotoSourceSheet
          onCancel={() => setShowPicker(false)}
          onSelectCamera={() => {
            setShowPicker(false);
            cameraInputRef.current?.click();
          }}
          onSelectGallery={() => {
            setShowPicker(false);
            galleryInputRef.current?.click();
          }}
        />
      ) : null}
    </div>
  );
}

function PhotoSourceSheet({
  onCancel,
  onSelectCamera,
  onSelectGallery,
}: {
  onCancel: () => void;
  onSelectCamera: () => void;
  onSelectGallery: () => void;
}) {
  return (
    <div aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/50 px-6" onClick={onCancel} role="dialog">
      <div
        className="w-full max-w-[320px] overflow-hidden rounded-[24px] bg-white shadow-calendar"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="h-16 w-full border-b border-[#f0f3f6] text-[16px] font-black text-black active:bg-[#f7f9fb]"
          onClick={onSelectCamera}
          type="button"
        >
          촬영으로 찍기
        </button>
        <button
          className="h-16 w-full text-[16px] font-black text-black active:bg-[#f7f9fb]"
          onClick={onSelectGallery}
          type="button"
        >
          앨범에서 선택
        </button>
        <button
          className="h-14 w-full border-t-[8px] border-[#f0f3f6] text-[15px] font-black text-[#999] active:bg-[#f7f9fb]"
          onClick={onCancel}
          type="button"
        >
          취소
        </button>
      </div>
    </div>
  );
}

export default function ProfileFormPage() {
  const navigate = useNavigate();
  const { eventId: routeEventId } = useParams();
  const [searchParams] = useSearchParams();
  const eventId = routeEventId ?? searchParams.get('eventId') ?? '';
  const previewToken = getCachedTestEventPreviewToken(eventId || undefined);
  const { error: eventError, events, loading: eventLoading, reload: reloadEvents } = useOperationalData({ eventId: eventId || undefined, previewToken });
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const draftLoadedRef = useRef(false);

  const [guideConfirmed, setGuideConfirmed] = useState(false);
  const [consentRead, setConsentRead] = useState({ privacy: false, thirdParty: false });
  const [consents, setConsents] = useState({ privacy: false, thirdParty: false });
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState(() => {
    const session = getAppSession();
    return session?.role === 'guest' && session.phoneNormalized ? formatKoreanPhone(session.phoneNormalized) : '';
  });
  const [singleConfirmed, setSingleConfirmed] = useState(false);
  const [idPhoto, setIdPhoto] = useState<File | null>(null);
  const [nickname, setNickname] = useState('');
  const [profilePhotos, setProfilePhotos] = useState<File[]>([]);
  const [representativeIndex, setRepresentativeIndex] = useState(0);
  const [representativeScale, setRepresentativeScale] = useState(1);
  const [representativeMinScale, setRepresentativeMinScale] = useState(1);
  const [representativeOffsetX, setRepresentativeOffsetX] = useState(0);
  const [representativeOffsetY, setRepresentativeOffsetY] = useState(0);
  const [showRepresentativeEditor, setShowRepresentativeEditor] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [pinchStart, setPinchStart] = useState<{ distance: number; scale: number } | null>(null);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const beforeEditRepresentativeRef = useRef({ offsetX: 0, offsetY: 0, scale: 1 });
  const representativePreviewRef = useRef<HTMLDivElement | null>(null);
  const [representativePreviewWidth, setRepresentativePreviewWidth] = useState(0);
  const [audioUrl, setAudioUrl] = useState('');
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'saved'>('idle');
  const [countdown, setCountdown] = useState(voiceRecordingMaxSeconds);
  const [micError, setMicError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [height, setHeight] = useState('');
  const [job, setJob] = useState('');
  const [employmentProof, setEmploymentProof] = useState<File | null>(null);
  const [accessRoute, setAccessRoute] = useState('');
  const [accessRouteEtc, setAccessRouteEtc] = useState('');
  const [filmingConsent, setFilmingConsent] = useState(false);
  const [interview, setInterview] = useState('');
  const [refundConsent, setRefundConsent] = useState(false);
  const [inquiry, setInquiry] = useState('');
  const [finalNoticeConfirmed, setFinalNoticeConfirmed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveAsDefaultProfile, setSaveAsDefaultProfile] = useState(false);
  const isMemberSession = getAppSession()?.role === 'member';
  const isGuestSession = getAppSession()?.role === 'guest';
  const selectedEvent = events.find((event) => event.id === eventId);
  // 참가 신청 마감 기능은 더 이상 신청을 막지 않는다(요청에 따라 제거) -
  // applicationDeadline 필드/관리자 UI 자체는 그대로 남아있지만 더 이상
  // 참조하지 않는다.
  const isApplicationClosed = false;

  const age = useMemo(() => getAgeOnEventDate(birthDate, selectedEvent?.date), [birthDate, selectedEvent?.date]);
  const ageError = birthDate && (age === null || age < 24 || age > 33) ? '행사일 기준 만 24~33세만 신청할 수 있습니다.' : '';
  const idPreview = useObjectUrl(idPhoto);
  const employmentPreview = useObjectUrl(employmentProof);
  const photoPreviews = useObjectUrls(profilePhotos);
  const allConsentsRead = consentRead.privacy && consentRead.thirdParty;

  useEffect(() => {
    if (!eventId) {
      draftLoadedRef.current = true;
      return;
    }
    const loadDraft = async () => {
      try {
        const draft = await fetchApplicationDraft(eventId);
        if (!draft) {
          draftLoadedRef.current = true;
          return;
        }

        setGuideConfirmed(Boolean(draft.guideConfirmed));
        setConsentRead((draft.consentRead as typeof consentRead) ?? { privacy: false, thirdParty: false });
        setConsents((draft.consents as typeof consents) ?? { privacy: false, thirdParty: false });
        setName(String(draft.name ?? ''));
        setBirthDate(String(draft.birthDate ?? ''));
        setGender(String(draft.gender ?? ''));
        setLocation(String(draft.location ?? ''));
        // Guests must submit with the exact phone number they logged in
        // with (verified server-side) - never let a previously-saved draft
        // (possibly a typo from an earlier attempt) override that.
        if (!isGuestSession) setPhone(String(draft.phone ?? ''));
        setSingleConfirmed(Boolean(draft.singleConfirmed));
        setNickname(String(draft.nickname ?? ''));
        setHeight(String(draft.height ?? ''));
        setJob(String(draft.job ?? ''));
        setAccessRoute(String(draft.accessRoute ?? ''));
        setAccessRouteEtc(String(draft.accessRouteEtc ?? ''));
        setFilmingConsent(Boolean(draft.filmingConsent));
        setInterview(String(draft.interview ?? ''));
        setRefundConsent(Boolean(draft.refundConsent));
        setInquiry(String(draft.inquiry ?? ''));
        setFinalNoticeConfirmed(Boolean(draft.finalNoticeConfirmed));
      } catch {
        // Draft loading is best-effort; the form remains usable without it.
      } finally {
        draftLoadedRef.current = true;
      }
    };

    void loadDraft();
  }, [eventId]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  // Only clear recording timers when the page itself unmounts — not on every
  // audioUrl change. Re-recording sets audioUrl before starting new timers,
  // and an audioUrl-scoped cleanup here would immediately kill the timers
  // that startRecording() just created for the new take.
  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const element = representativePreviewRef.current;
    if (!element) return;
    setRepresentativePreviewWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      setRepresentativePreviewWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [photoPreviews[representativeIndex]]);

  useEffect(() => {
    if (!draftLoadedRef.current || !eventId) return;

    const timeoutId = window.setTimeout(() => {
      void saveApplicationDraft(eventId, {
        accessRoute,
        accessRouteEtc,
        birthDate,
        consentRead,
        consents,
        filmingConsent,
        finalNoticeConfirmed,
        gender,
        guideConfirmed,
        height,
        inquiry,
        interview,
        job,
        location,
        name,
        nickname,
        phone,
        refundConsent,
        singleConfirmed,
      }).catch(() => undefined);
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [
    accessRoute,
    accessRouteEtc,
    birthDate,
    consentRead,
    consents,
    filmingConsent,
    finalNoticeConfirmed,
    gender,
    guideConfirmed,
    height,
    inquiry,
    interview,
    job,
    location,
    name,
    nickname,
    phone,
    refundConsent,
    singleConfirmed,
    eventId,
  ]);

  const isRequiredComplete = Boolean(
    guideConfirmed &&
      consents.privacy &&
      consents.thirdParty &&
      name.trim() &&
      birthDate &&
      !ageError &&
      gender &&
      location.trim() &&
      phone.trim() &&
      singleConfirmed &&
      idPhoto &&
      nickname.trim() &&
      profilePhotos.length > 0 &&
      profilePhotos.length <= 3 &&
      height.trim() &&
      job.trim() &&
      employmentProof &&
      accessRoute &&
      (accessRoute !== '기타' || accessRouteEtc.trim()) &&
      filmingConsent &&
      interview &&
      refundConsent &&
      finalNoticeConfirmed,
  );

  const startRecording = async () => {
    setMicError('');
    try {
      if (typeof MediaRecorder === 'undefined') {
        setMicError('현재 브라우저에서는 녹음을 지원하지 않습니다. Safari 또는 Chrome 최신 버전에서 다시 시도해주세요.');
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedAudioMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setAudioBlob(null);
      setAudioUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return '';
      });
      setCountdown(voiceRecordingMaxSeconds);
      setRecordingState('recording');

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blobType = recorder.mimeType || mimeType || chunksRef.current[0]?.type || 'audio/mp4';
        const blob = new Blob(chunksRef.current, { type: blobType });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecordingState('saved');
        if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
        if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      };

      recorder.start(250);
      countdownTimerRef.current = window.setInterval(() => {
        setCountdown((current) => Math.max(0, current - 1));
      }, 1000);
      stopTimerRef.current = window.setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, voiceRecordingMaxSeconds * 1000);
    } catch (error) {
      console.error('Voice recording failed', error);
      setMicError('마이크 권한이 거부되었거나 사용할 수 없습니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
      setRecordingState('idle');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const submit = async () => {
    if (submitting) return;
    setTouched(true);
    setSubmitError('');
    if (!eventId) {
      setSubmitError('신청할 행사를 찾을 수 없습니다. 행사 선택 화면에서 다시 시작해주세요.');
      return;
    }
    if (!selectedEvent) {
      setSubmitError('선택한 행사 정보를 확인할 수 없습니다. 행사 선택 화면에서 다시 시작해주세요.');
      return;
    }
    if (isApplicationClosed) {
      setSubmitError('이 행사의 신청 접수가 마감되었습니다.');
      return;
    }
    if (!isRequiredComplete || !idPhoto || !employmentProof) return;

    const fileCount = 2 + profilePhotos.length + (audioBlob ? 1 : 0); // idPhoto + employmentProof + profile photos + optional voice
    const reportError = (stage: Parameters<typeof logApplicationError>[0]['stage'], message: string, totalBytes?: number) => {
      void logApplicationError({ eventId, fileCount, message, stage, totalBytes });
    };

    setSubmitting(true);
    try {
      const normalizedContactPhone = normalizeKoreanPhone(phone);
      if (!normalizedContactPhone) {
        window.alert('전화번호 형식을 확인해주세요.');
        return;
      }
      const existingApplication = await fetchOwnApplicationForEvent(eventId);
      if (existingApplication) {
        window.alert('이미 이 행사에 신청한 내역이 있습니다.');
        navigate('/application-complete');
        return;
      }
      if (isMemberSession && saveAsDefaultProfile) {
        const confirmed = window.confirm('이 프로필을 회원 기본 참가 프로필로 저장할까요? 기존 기본 프로필이 있으면 새 프로필로 교체됩니다.');
        if (!confirmed) {
          setSubmitting(false);
          return;
        }
      }

      let compressedIdPhoto: File;
      let compressedEmploymentProof: File;
      let compressedProfilePhotos: File[];
      try {
        [compressedIdPhoto, compressedEmploymentProof, compressedProfilePhotos] = await Promise.all([
          compressImageIfNeeded(idPhoto),
          compressImageIfNeeded(employmentProof),
          Promise.all(profilePhotos.map(compressImageIfNeeded)),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : '이미지 압축에 실패했습니다.';
        reportError('image_compression', message);
        throw new Error(message);
      }

      // Each file can individually pass the per-file check yet still add up:
      // five compressed screenshots at a few MB each can combine into a
      // request the Edge Function/gateway rejects. Catch that here, before
      // spending a network round-trip on a submission that would fail
      // anyway.
      const totalUploadBytes =
        compressedIdPhoto.size +
        compressedEmploymentProof.size +
        compressedProfilePhotos.reduce((sum, file) => sum + file.size, 0) +
        (audioBlob?.size ?? 0);
      if (totalUploadBytes > maxTotalUploadBytes) {
        const message = `첨부한 사진·음성 용량이 너무 큽니다(${(totalUploadBytes / 1024 / 1024).toFixed(1)}MB). 사진을 더 작은 것으로 바꾸거나 장수를 줄여주세요.`;
        reportError('file_validation', message, totalUploadBytes);
        throw new Error(message);
      }

      try {
        await submitApplicationToSupabase({
          accessRoute: accessRoute === '기타' ? accessRouteEtc : accessRoute,
          birthDate,
          consents,
          previewToken,
          employmentProof: compressedEmploymentProof,
          eventId,
          filmingConsent,
          gender,
          height,
          idPhoto: compressedIdPhoto,
          inquiry,
          interviewConsent: interview,
          job,
          name,
          nickname,
          phone: normalizedContactPhone,
          profilePhotos: compressedProfilePhotos,
          refundAgreement: refundConsent,
          relationshipStatus: '미혼이며 교제하는 인원 없음',
          representativeCrop: {
            offsetX: representativeOffsetX,
            offsetY: representativeOffsetY,
            scale: representativeScale,
          },
          representativeIndex,
          residence: location,
          returning: false,
          saveAsDefaultProfile: isMemberSession && saveAsDefaultProfile,
          voiceIntro: audioBlob ?? undefined,
          voiceIntroFileName: audioBlob ? getAudioFileName(audioBlob.type) : undefined,
        });
      } catch (error) {
        // The request/response can fail (network drop, gateway timeout,
        // Safari killing a stalled tab) even after the server has already
        // saved the application. Re-check before telling the applicant it
        // failed, so a real duplicate submit attempt is never necessary.
        const stage = error instanceof ApplicationSubmitError ? error.stage : 'unknown';
        const rawMessage = error instanceof Error ? error.message : '신청서 저장에 실패했습니다.';
        reportError(stage, rawMessage, totalUploadBytes);

        let confirmedExisting: Awaited<ReturnType<typeof fetchOwnApplicationForEvent>> = null;
        try {
          confirmedExisting = await fetchOwnApplicationForEvent(eventId);
        } catch {
          confirmedExisting = null; // Couldn't verify either way - don't claim success.
        }

        if (confirmedExisting) {
          window.alert('신청이 정상적으로 접수되었습니다.');
          navigate('/application-complete');
          return;
        }

        const notCompletedMessage = '신청이 완료되지 않았습니다. 다시 시도해주세요.';
        setSubmitError(notCompletedMessage);
        window.alert(notCompletedMessage);
        return;
      }

      navigate('/application-complete');
    } catch (error) {
      console.error('Application submit failed', error);
      const message = error instanceof Error ? error.message : '신청서 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
      setSubmitError(message);
      window.alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetRepresentativeAdjustment = () => {
    setRepresentativeScale(representativeMinScale);
    setRepresentativeOffsetX(0);
    setRepresentativeOffsetY(0);
  };

  const addProfilePhotos = (files: File[]) => {
    if (files.length === 0) return;
    const wasEmpty = profilePhotos.length === 0;
    setProfilePhotos((current) => {
      const nextPhotos = [...current, ...files].slice(0, 3);
      if (nextPhotos.length <= representativeIndex) setRepresentativeIndex(0);
      return nextPhotos;
    });
    if (wasEmpty) {
      setRepresentativeIndex(0);
      resetRepresentativeAdjustment();
    }
  };

  const removeProfilePhoto = (index: number) => {
    setProfilePhotos((current) => {
      const nextPhotos = current.filter((_, photoIndex) => photoIndex !== index);
      const nextLastIndex = Math.max(0, nextPhotos.length - 1);
      setRepresentativeIndex((currentRepresentative) => {
        if (nextPhotos.length === 0) return 0;
        if (currentRepresentative === index) return 0;
        if (currentRepresentative > index) return currentRepresentative - 1;
        return Math.min(currentRepresentative, nextLastIndex);
      });
      if (representativeIndex === index || nextPhotos.length === 0) resetRepresentativeAdjustment();
      return nextPhotos;
    });
  };

  const getPointerDistance = () => {
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length < 2) return 0;
    return Math.hypot(pointers[0].x - pointers[1].x, pointers[0].y - pointers[1].y);
  };

  const handleRepresentativePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointersRef.current.size === 2) {
      setPinchStart({ distance: getPointerDistance(), scale: representativeScale });
      setDragStart(null);
      return;
    }
    setDragStart({ x: event.clientX, y: event.clientY, offsetX: representativeOffsetX, offsetY: representativeOffsetY });
  };

  const handleRepresentativePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!activePointersRef.current.has(event.pointerId)) return;
    activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointersRef.current.size >= 2 && pinchStart) {
      const distance = getPointerDistance();
      if (pinchStart.distance > 0) {
        const maxScale = Math.max(2.6, representativeMinScale + 1.5);
        const nextScale = Math.min(
          maxScale,
          Math.max(representativeMinScale, Number((pinchStart.scale * (distance / pinchStart.distance)).toFixed(2))),
        );
        setRepresentativeScale(nextScale);
        setRepresentativeOffsetX((current) => clampRepresentativeOffset(current, nextScale));
        setRepresentativeOffsetY((current) => clampRepresentativeOffset(current, nextScale));
      }
      return;
    }
    if (!dragStart) return;
    const boxSize = getRepresentativeCropBoxSize();
    setRepresentativeOffsetX(clampRepresentativeOffset(dragStart.offsetX + (event.clientX - dragStart.x) / boxSize, representativeScale));
    setRepresentativeOffsetY(clampRepresentativeOffset(dragStart.offsetY + (event.clientY - dragStart.y) / boxSize, representativeScale));
  };

  const handleRepresentativePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(event.pointerId);
    setDragStart(null);
    setPinchStart(null);
  };

  const handleRepresentativeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const maxScale = Math.max(2.6, representativeMinScale + 1.5);
    setRepresentativeScale((current) => {
      const nextScale = Math.min(maxScale, Math.max(representativeMinScale, Number((current + (event.deltaY > 0 ? -0.08 : 0.08)).toFixed(2))));
      setRepresentativeOffsetX((currentOffsetX) => clampRepresentativeOffset(currentOffsetX, nextScale));
      setRepresentativeOffsetY((currentOffsetY) => clampRepresentativeOffset(currentOffsetY, nextScale));
      return nextScale;
    });
  };

  if (eventLoading) return <DataLoadingState />;
  if (eventError) return <DataErrorState message={eventError} onRetry={reloadEvents} />;
  if (!eventId || !selectedEvent) {
    return (
      <main className="app-page min-h-screen overflow-x-hidden bg-white px-4 py-12 text-black">
        <div className="mobile-container mx-auto">
          <section className="rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
            <h1 className="text-[24px] font-black leading-tight">신청할 행사를 찾을 수 없습니다</h1>
            <p className="mt-4 text-[14px] font-extrabold leading-relaxed text-[#777]">
              행사 선택 화면에서 신청할 날짜를 다시 선택해주세요. 임의의 행사로 신청되지는 않습니다.
            </p>
            <Link className="mt-6 block h-14 rounded-[18px] bg-meet-blue px-5 py-4 text-[16px] font-extrabold text-white" to="/">
              행사 선택하러 가기
            </Link>
          </section>
        </div>
      </main>
    );
  }

  if (isApplicationClosed) {
    return (
      <main className="app-page min-h-screen overflow-x-hidden bg-white px-4 py-12 text-black">
        <div className="mobile-container mx-auto">
          <section className="rounded-[30px] border border-[#f0f3f6] bg-white p-6 text-center shadow-calendar">
            <h1 className="text-[24px] font-black leading-tight">신청이 마감되었습니다</h1>
            <p className="mt-4 text-[14px] font-extrabold leading-relaxed text-[#777]">이 행사는 신청 접수가 종료되었습니다. 다른 행사 일정을 확인해주세요.</p>
            <Link className="mt-6 block h-14 rounded-[18px] bg-meet-blue px-5 py-4 text-[16px] font-extrabold text-white" to="/">
              다른 행사 확인하기
            </Link>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="app-page min-h-screen w-full max-w-full min-w-0 overflow-x-hidden bg-white px-3 py-12 text-black min-[380px]:px-4">
      <div className="mobile-container mx-auto w-full max-w-full min-w-0">
        <header className="relative mb-8 rounded-[30px] border border-[#f0f3f6] bg-white px-4 pb-7 pt-16 text-center shadow-calendar min-[380px]:px-5">
          <button aria-label="뒤로 가기" className="absolute left-5 top-5 grid h-10 w-10 place-items-center text-black" onClick={() => navigate(-1)} type="button">
            <BackIcon />
          </button>
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <h1 className="text-fluid-safe text-[23px] font-black leading-tight">타임투밋 행사 참여 위한 프로필 작성</h1>
        </header>

        <form className="w-full max-w-full min-w-0 space-y-8" onSubmit={(event) => event.preventDefault()}>
          <Section title="1. 참가 전 꼭 확인해주세요">
            <div className="rounded-[22px] border-4 border-meet-blue bg-[#f8fbff] p-3 text-[13px] font-extrabold leading-relaxed text-[#777] min-[380px]:p-4">
              <ol className="text-fluid-safe list-decimal space-y-2 pl-4">
                <li>타임투밋은 여러 참가자와 정해진 시간 동안 1:1로 대화하며 새로운 인연을 만나는 로테이션 소개팅입니다.</li>
                <li className="text-red-500">프로필 작성은 참가 확정을 의미하지 않습니다. 신청 현황과 성비 등을 고려해 참가자가 선정되며, 선정 결과는 개별적으로 안내드립니다.</li>
                <li className="text-red-500">최소 참가인원 (남 6 : 여 6)이 모집되지 않았을 시, 행사가 부득이하게 취소될 수 있으며, 이 경우에는 전액환불을 보장해드립니다.</li>
                <li>원활한 매칭을 위해 프로필에는 사실에 기반한 정보를 입력해주세요. 허위 정보나 타인의 사진을 사용한 경우 참가가 취소될 수 있습니다.</li>
                <li className="text-red-500">참가가 확정된 이후에는 안내된 기한 내에 참가비를 결제해야 예약이 완료됩니다. 취소 및 환불 기준은 결제 전 반드시 확인해주세요.</li>
                <li>행사에서는 모든 참가자와 정해진 순서에 따라 대화합니다. 상대방을 불편하게 하는 언행, 과도한 신체 접촉, 연락처 요구 등은 제한됩니다.</li>
                <li>프로필은 행사 종료 최종 매칭된 상대에게만 전달됩니다, 이 때 전화번호는 전달되지 않습니다.</li>
                <li>행사 당일에는 안내된 시간까지 도착해주세요. 지각하거나 사전 연락 없이 불참할 경우 행사 참여가 제한되며, 향후 신청이 어려울 수 있습니다.</li>
                <li>다른 참가자의 프로필과 행사 중 알게 된 개인정보를 촬영·저장하거나 외부에 공유할 수 없습니다.</li>
              </ol>
              <p className="mt-6">위 내용을 모두 확인하신 후 프로필을 작성해주세요.</p>
              <label className="mt-6 flex items-start gap-2 text-fluid-safe text-black">
                <input checked={guideConfirmed} onChange={(event) => setGuideConfirmed(event.target.checked)} type="checkbox" />
                참가 안내 및 운영 규정을 확인했습니다.
              </label>
            </div>
            <ErrorText>{touched && !guideConfirmed ? '참가 안내 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="2. 필수 동의">
            <p className="mb-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#777]">동의를 거부할 수 있으나, 거부 시 행사 신청 및 참가가 제한됩니다.</p>
            <div className="rounded-[22px] bg-meet-blueSoft p-4">
              {requiredConsentText.map((consent) => (
                <details
                  className="border-b border-white/80 py-3 last:border-b-0"
                  key={consent.id}
                  onToggle={(event) => {
                    if (event.currentTarget.open) {
                      setConsentRead((current) => ({ ...current, [consent.id]: true }));
                    }
                  }}
                >
                  <summary className="cursor-pointer text-fluid-safe text-[14px] font-black">
                    <span className="inline-flex items-center gap-2">
                      {consent.title}
                      {consentRead[consent.id as keyof typeof consentRead] ? (
                        <span aria-label="읽음" className="h-3 w-3 rounded-full bg-green-500" />
                      ) : null}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 text-fluid-safe text-[12px] font-extrabold leading-relaxed text-[#666]">
                    {consent.body.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </details>
              ))}
              <label className={`mt-4 flex items-center gap-2 text-[14px] font-black ${allConsentsRead ? 'text-black' : 'text-[#999]'}`}>
                <input
                  checked={consents.privacy && consents.thirdParty}
                  disabled={!allConsentsRead}
                  onChange={(event) => setConsents({ privacy: event.target.checked, thirdParty: event.target.checked })}
                  type="checkbox"
                />
                전체 동의하기
              </label>
              {!allConsentsRead ? <p className="mt-2 text-[12px] font-extrabold text-[#888]">필수 동의 내용을 모두 열람하면 전체 동의가 가능합니다.</p> : null}
            </div>
            <ErrorText>{touched && (!consents.privacy || !consents.thirdParty) ? '필수 동의가 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="3. 이름">
            <input className="h-12 w-full border-b-2 border-[#aaa] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue" onChange={(event) => setName(event.target.value)} placeholder="이름" value={name} />
            <ErrorText>{touched && !name.trim() ? '이름을 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="4. 생년월일">
            <BirthDateSelect
              className="flex h-12 w-full items-center justify-center gap-1.5 rounded-[18px] bg-meet-blueSoft px-2"
              onChange={setBirthDate}
              selectClassName="min-w-0 appearance-none bg-transparent text-center text-[15px] font-bold text-black outline-none"
              value={birthDate}
            />
            {age !== null && !ageError ? <p className="mt-3 text-[13px] font-extrabold text-[#777]">행사일 기준 만 {age}세입니다.</p> : null}
            <ErrorText>{ageError || (touched && !birthDate ? '생년월일을 선택해주세요.' : '')}</ErrorText>
          </Section>

          <Section title="5. 성별">
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
              {['남성', '여성'].map((option) => (
                <button className={`h-12 rounded-[18px] text-[16px] font-black ${gender === option ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black'}`} key={option} onClick={() => setGender(option)} type="button">
                  {option}
                </button>
              ))}
            </div>
            <ErrorText>{touched && !gender ? '성별을 선택해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="6. 거주지">
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setLocation(event.target.value)} placeholder="ex) 성남시 수정구" value={location} />
            <ErrorText>{touched && !location.trim() ? '거주지를 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="7. 전화번호">
            <input
              className={`h-12 w-full rounded-[18px] px-4 text-[16px] font-bold outline-none ${isGuestSession ? 'bg-[#eef1f4] text-[#777]' : 'bg-meet-blueSoft'}`}
              inputMode="tel"
              onChange={(event) => setPhone(event.target.value)}
              placeholder="010-0000-0000"
              readOnly={isGuestSession}
              value={phone}
            />
            {isGuestSession ? (
              <p className="mt-2 text-fluid-safe text-[12px] font-extrabold leading-relaxed text-[#8a8a8a]">
                비회원 로그인에 사용한 번호로 자동 입력되며 수정할 수 없습니다.
              </p>
            ) : null}
            <ErrorText>{touched && !phone.trim() ? '전화번호를 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="8. 결혼 및 교제 여부">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold leading-relaxed text-[#777]">허위 응답 시 이후 행사 참여 제한 및 법적 조치가 이루어질 수 있습니다.</p>
            <label className="flex items-start gap-2 text-fluid-safe text-[14px] font-black">
              <input checked={singleConfirmed} onChange={(event) => setSingleConfirmed(event.target.checked)} type="checkbox" />
              미혼이며 교제하는 인원이 없습니다.
            </label>
            <ErrorText>{touched && !singleConfirmed ? '확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="9. 본인확인용 신분증 사진 첨부">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold leading-relaxed text-[#777]">민감한 정보는 가려도 되며 이름과 생년월일만 확인되면 됩니다.</p>
            <UploadBox
              label="본인확인용 신분증 사진 첨부"
              onFiles={(files) => setIdPhoto(files[0] ?? null)}
              onRemove={() => setIdPhoto(null)}
              previewUrl={idPreview}
            />
            <ErrorText>{touched && !idPhoto ? '신분증 사진을 첨부해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="10. 닉네임">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold text-[#777]">소개팅에서 계속 사용할 닉네임이니 신중하고 개성있는 닉네임을 사용해주세요.</p>
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setNickname(event.target.value)} placeholder="닉네임" value={nickname} />
            <ErrorText>{touched && !nickname.trim() ? '닉네임을 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="11. 프로필 사진">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold leading-relaxed text-[#777]">최대 3장까지 첨부할 수 있으며, 전신 사진을 최소 1장 포함해주세요. 대표사진으로 지정한 사진은 모자이크 처리된 상태로 참가자 리스트에 공개됩니다.</p>
            {photoPreviews[representativeIndex] ? (
              <div className="relative aspect-square w-full overflow-hidden rounded-[22px] bg-meet-blueSoft" ref={representativePreviewRef}>
                <img
                  alt="대표사진 미리보기"
                  className="absolute left-1/2 top-1/2 h-full max-w-none select-none"
                  src={photoPreviews[representativeIndex]}
                  style={representativeCropTransform(
                    { offsetX: representativeOffsetX, offsetY: representativeOffsetY, scale: representativeScale },
                    representativePreviewWidth,
                  )}
                />
                <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]" />
                <span className="absolute bottom-3 left-3 rounded-full bg-meet-blue px-3 py-1.5 text-[12px] font-black text-white">대표사진</span>
              </div>
            ) : (
              <UploadBox label="프로필 사진 첨부" onFiles={addProfilePhotos} />
            )}
            <div className="mt-4 grid grid-cols-[repeat(3,minmax(0,1fr))] gap-1.5 min-[380px]:gap-2">
              {photoPreviews.map((preview, index) => (
                <div className={`relative rounded-[16px] border-4 ${representativeIndex === index ? 'border-meet-blue' : 'border-transparent'}`} key={preview}>
                  <button
                    className="block w-full"
                    onClick={() => {
                      setRepresentativeIndex(index);
                      setShowRepresentativeEditor(true);
                    }}
                    type="button"
                  >
                    <img alt={`본인 사진 ${index + 1}`} className="aspect-square w-full rounded-[12px] object-cover" src={preview} />
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap py-1 text-[10px] font-black min-[380px]:text-[11px]">
                      {representativeIndex === index ? '대표사진' : '대표사진으로 설정'}
                    </span>
                  </button>
                  <button
                    aria-label={`본인 사진 ${index + 1} 삭제`}
                    className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-black/65 text-[14px] font-black leading-none text-white"
                    onClick={() => removeProfilePhoto(index)}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
              {profilePhotos.length < 3 ? (
                <UploadBox label="프로필 사진 추가" onFiles={addProfilePhotos} />
              ) : null}
            </div>
            <ErrorText>{touched && profilePhotos.length === 0 ? '프로필 사진을 첨부해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="12. 목소리로 첫인상을 남겨보세요 (선택)">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold text-[#777]">3초면 충분해요. 짧은 인사 한마디를 남겨보세요.</p>
            {recordingState === 'recording' ? (
              <PrimaryButton onClick={stopRecording}>녹음 중 {countdown}초</PrimaryButton>
            ) : (
              <PrimaryButton onClick={startRecording}>{audioUrl ? '다시 녹음' : '녹음하기'}</PrimaryButton>
            )}
            {audioUrl ? <audio className="mt-4 w-full" controls src={audioUrl} /> : null}
            <ErrorText>{micError}</ErrorText>
          </Section>

          <Section title="13. 키">
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" inputMode="numeric" onChange={(event) => setHeight(event.target.value)} placeholder="ex) 172cm" value={height} />
            <ErrorText>{touched && !height.trim() ? '키를 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="14. 직업">
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setJob(event.target.value)} placeholder="ex) 초등학교 교사, 자영업, 의사, 프리랜서" value={job} />
            <ErrorText>{touched && !job.trim() ? '직업을 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="15. 재직 증명">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold text-[#777]">사원증, 명함 등 본인의 재직사실을 증명할 수 있는 사진을 첨부해주세요.</p>
            <UploadBox
              label="재직 증명 사진 첨부"
              onFiles={(files) => setEmploymentProof(files[0] ?? null)}
              onRemove={() => setEmploymentProof(null)}
              previewUrl={employmentPreview}
            />
            <ErrorText>{touched && !employmentProof ? '재직 증명 사진을 첨부해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="16. 접속 경로">
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-2">
              {routeOptions.map((option) => (
                <button className={`h-11 rounded-[16px] text-[13px] font-black ${accessRoute === option ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black'}`} key={option} onClick={() => setAccessRoute(option)} type="button">
                  {option}
                </button>
              ))}
            </div>
            {accessRoute === '기타' ? <input className="mt-4 h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setAccessRouteEtc(event.target.value)} placeholder="접속 경로를 입력해주세요" value={accessRouteEtc} /> : null}
            <ErrorText>{touched && (!accessRoute || (accessRoute === '기타' && !accessRouteEtc.trim())) ? '접속 경로를 선택해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="17. 촬영 동의 (모자이크)">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold text-[#777]">소개팅 현장을 인스타 홍보 및 후기 작성 목적으로 촬영하며 모자이크를 보장합니다.</p>
            <label className="flex items-start gap-2 text-fluid-safe text-[14px] font-black">
              <input checked={filmingConsent} onChange={(event) => setFilmingConsent(event.target.checked)} type="checkbox" />
              촬영에 동의합니다.
            </label>
            <ErrorText>{touched && !filmingConsent ? '촬영 동의가 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="18. 인터뷰 여부">
            <p className="mb-4 text-fluid-safe text-[13px] font-extrabold text-[#777]">더 나은 소개팅, 고객 경험 개선을 위해서 행사 종료 후에 짧은 인터뷰를 진행합니다. 원하시면 모자이크 또는 얼굴 아래로 촬영을 할 예정입니다.</p>
            <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
              {['참여', '미참여'].map((option) => (
                <button className={`h-12 rounded-[18px] text-[16px] font-black ${interview === option ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black'}`} key={option} onClick={() => setInterview(option)} type="button">
                  {option}
                </button>
              ))}
            </div>
            <ErrorText>{touched && !interview ? '인터뷰 여부를 선택해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="19. 환불규정">
            <RefundPolicyBox />
            <label className="mt-4 flex items-start gap-2 text-fluid-safe text-[14px] font-black">
              <input checked={refundConsent} onChange={(event) => setRefundConsent(event.target.checked)} type="checkbox" />
              환불규정을 확인했습니다.
            </label>
            <ErrorText>{touched && !refundConsent ? '환불규정 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="20. 타임투밋 문의사항">
            <textarea className="min-h-32 w-full rounded-[18px] bg-meet-blueSoft p-4 text-[15px] font-bold outline-none" onChange={(event) => setInquiry(event.target.value)} placeholder="운영진 측에서 알아야 할 정보가 있다면 알려주세요!" value={inquiry} />
          </Section>

          <Section title="21. 심사 후 개별 연락 안내">
            <p className="text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#666]">
              프로필에 누락된 내용이 있을 시 참여가 제한될 수 있으며, 신청 현황과 성비 등을 종합적으로 고려해 일부 신청자는 대기 명단으로 안내될 수 있습니다.
            </p>
            <p className="mt-4 text-fluid-safe text-[14px] font-extrabold leading-relaxed text-[#666]">
              심사결과는 12시간 이내에 메시지, 앱을 통해 확인하실 수 있으며, 참가자로 선정된 후 안내 시점으로부터 24시간 이내에 결제를 완료해야 참가가 최종 확정됩니다.
            </p>
            <label className="mt-4 flex items-start gap-2 text-fluid-safe text-[14px] font-black">
              <input checked={finalNoticeConfirmed} onChange={(event) => setFinalNoticeConfirmed(event.target.checked)} type="checkbox" />
              안내 내용을 확인했습니다.
            </label>
            <ErrorText>{touched && !finalNoticeConfirmed ? '심사 안내 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <div className="sticky bottom-4 z-10">
            {isMemberSession ? (
              <label className="mb-3 flex items-start gap-2 rounded-[20px] border border-[#e7f2fc] bg-white/95 p-4 text-fluid-safe text-[13px] font-extrabold leading-relaxed text-[#666] shadow-sm">
                <input
                  checked={saveAsDefaultProfile}
                  className="mt-1"
                  onChange={(event) => setSaveAsDefaultProfile(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  이 프로필을 기본 프로필로 저장
                  <span className="mt-1 block text-[12px] text-[#888]">
                    다음 행사 신청 때 재사용할 수 있으며, 이미 제출한 신청서는 변경되지 않습니다.
                  </span>
                </span>
              </label>
            ) : null}
            <PrimaryButton disabled={!isRequiredComplete || submitting} onClick={submit}>
              {submitting ? '제출 중' : '프로필 제출'}
            </PrimaryButton>
            <ErrorText>{submitError}</ErrorText>
            {!isRequiredComplete ? <p className="mt-2 text-center text-[12px] font-extrabold text-[#888]">필수 항목을 모두 입력하면 제출할 수 있습니다.</p> : null}
          </div>
        </form>
      </div>
      {showRepresentativeEditor && photoPreviews[representativeIndex] ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-[#080d13] text-white">
          <div className="flex h-[86px] shrink-0 items-center justify-between px-5">
            <button
              aria-label="대표사진 조정 취소"
              className="grid h-12 w-12 place-items-center rounded-full border border-white/15 bg-white/10 text-[34px] font-light leading-none"
              onClick={() => {
                setRepresentativeOffsetX(beforeEditRepresentativeRef.current.offsetX);
                setRepresentativeOffsetY(beforeEditRepresentativeRef.current.offsetY);
                setRepresentativeScale(beforeEditRepresentativeRef.current.scale);
                setShowRepresentativeEditor(false);
              }}
              type="button"
            >
              ×
            </button>
            <h2 className="text-[20px] font-black">대표사진 조정</h2>
            <button
              aria-label="대표사진 조정 완료"
              className="grid h-12 w-12 place-items-center rounded-full bg-[#4f63ff] text-[28px] font-black leading-none"
              onClick={() => setShowRepresentativeEditor(false)}
              type="button"
            >
              ✓
            </button>
          </div>
          <div className="flex shrink-0 justify-center pb-3">
            <button
              className="rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-[13px] font-extrabold text-white/85"
              onClick={resetRepresentativeAdjustment}
              type="button"
            >
              초기화
            </button>
          </div>
          <div
            className="relative min-h-0 flex-1 touch-none overflow-hidden bg-black"
            onPointerCancel={handleRepresentativePointerUp}
            onPointerDown={handleRepresentativePointerDown}
            onPointerMove={handleRepresentativePointerMove}
            onPointerUp={handleRepresentativePointerUp}
            onWheel={handleRepresentativeWheel}
          >
            <div className="absolute left-1/2 top-1/2 h-[96vw] max-h-[430px] w-[96vw] max-w-[430px] -translate-x-1/2 -translate-y-1/2">
              <img
                alt="대표사진 조정"
                className="absolute left-1/2 top-1/2 h-full max-w-none select-none"
                draggable={false}
                onLoad={(event) => {
                  const { naturalHeight, naturalWidth } = event.currentTarget;
                  if (!naturalWidth || !naturalHeight) return;
                  const aspect = naturalWidth / naturalHeight;
                  const minScale = Number((aspect >= 1 ? 1 : 1 / aspect).toFixed(2));
                  setRepresentativeMinScale(minScale);
                  setRepresentativeScale((current) => {
                    const nextScale = Math.max(current, minScale);
                    setRepresentativeOffsetX((offsetX) => clampRepresentativeOffset(offsetX, nextScale));
                    setRepresentativeOffsetY((offsetY) => clampRepresentativeOffset(offsetY, nextScale));
                    beforeEditRepresentativeRef.current = {
                      offsetX: clampRepresentativeOffset(representativeOffsetX, nextScale),
                      offsetY: clampRepresentativeOffset(representativeOffsetY, nextScale),
                      scale: nextScale,
                    };
                    return nextScale;
                  });
                }}
                src={photoPreviews[representativeIndex]}
                style={{
                  ...representativeCropTransform(
                    { offsetX: representativeOffsetX, offsetY: representativeOffsetY, scale: representativeScale },
                    getRepresentativeCropBoxSize(),
                  ),
                  touchAction: 'none',
                }}
              />
            </div>
            <div className="pointer-events-none absolute inset-0 bg-black/45" />
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[96vw] max-h-[430px] w-[96vw] max-w-[430px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/85 shadow-[0_0_0_999px_rgba(0,0,0,0.38)]" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
