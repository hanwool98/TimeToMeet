import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import LogoMark from '../components/LogoMark';
import { applyEmergencyGuestSession } from '../services/appAuth';
import {
  fetchEmergencyParticipantTokenEvent,
  submitEmergencyApplication,
  type EmergencyParticipantTokenEvent,
} from '../services/supabaseApplications';
import { getAudioFileName, getSupportedAudioMimeType, voiceRecordingMaxSeconds } from './ProfileFormPage';

// 행사 시작 전에만 열리는 긴급 대체 참가자용 간소화 신청 폼 - 운영자가
// 발급한 1회성 토큰(?token=)이 곧 이 페이지의 인증 수단이다. 일반
// ProfileFormPage의 신분증/재직증명/24시간 결제 제한 없이 닉네임/성별/
// 생년월일/직업/대표사진/(선택)음성소개만 받아 곧바로 심사 대기 신청서를
// 만들고, 별도 전화번호+PIN 로그인 없이 서버가 발급한 세션으로 바로
// 로그인된다. 대표사진 크롭 편집기는 시간이 급한 도보 등록 상황에 맞춰
// 생략하고 기본값(중앙, 확대 없음)을 사용한다.
export default function EmergencyProfileFormPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [loadingEvent, setLoadingEvent] = useState(true);
  const [event, setEvent] = useState<EmergencyParticipantTokenEvent | null>(null);

  const [nickname, setNickname] = useState('');
  const [gender, setGender] = useState<'남성' | '여성' | ''>('');
  const [birthDate, setBirthDate] = useState('');
  const [job, setJob] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [consent, setConsent] = useState(false);

  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'saved'>('idle');
  const [countdown, setCountdown] = useState(voiceRecordingMaxSeconds);
  const [micError, setMicError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const startingRecordingRef = useRef(false);

  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!eventId || !token) {
      setLoadingEvent(false);
      return;
    }
    let active = true;
    fetchEmergencyParticipantTokenEvent(eventId, token)
      .then((result) => {
        if (active) setEvent(result);
      })
      .catch(() => {
        if (active) setEvent(null);
      })
      .finally(() => {
        if (active) setLoadingEvent(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, token]);

  useEffect(() => {
    if (!photo) {
      setPhotoUrl('');
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
    };
  }, []);

  const startRecording = async () => {
    // getUserMedia() 권한 프롬프트를 기다리는 동안 재진입하면 setInterval이
    // 중복 생성돼 카운트다운이 실제보다 빠르게 줄어드는 문제가 있어
    // 동기적으로 즉시 세팅되는 ref로 막는다(ProfileFormPage.tsx와 동일).
    if (recordingState === 'recording' || startingRecordingRef.current) return;
    startingRecordingRef.current = true;
    setMicError('');
    try {
      if (typeof MediaRecorder === 'undefined') {
        setMicError('현재 브라우저에서는 녹음을 지원하지 않습니다.');
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
      if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
      if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      setCountdown(voiceRecordingMaxSeconds);
      setRecordingState('recording');

      recorder.ondataavailable = (recordEvent) => {
        if (recordEvent.data.size > 0) chunksRef.current.push(recordEvent.data);
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
    } catch {
      setMicError('마이크 권한이 거부되었거나 사용할 수 없습니다.');
      setRecordingState('idle');
    } finally {
      startingRecordingRef.current = false;
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const isComplete = Boolean(nickname.trim() && gender && birthDate && job.trim() && photo && consent);

  const handleSubmit = async () => {
    if (submitting) return;
    setTouched(true);
    setSubmitError('');
    if (!eventId || !token) {
      setSubmitError('유효하지 않은 긴급 참가 링크입니다.');
      return;
    }
    if (!isComplete || !photo) return;

    setSubmitting(true);
    try {
      const result = await submitEmergencyApplication({
        birthDate,
        eventId,
        gender,
        job: job.trim(),
        nickname: nickname.trim(),
        representativeCrop: { offsetX: 0, offsetY: 0, scale: 1 },
        representativePhoto: photo,
        token,
        voiceIntro: audioBlob ?? undefined,
        voiceIntroFileName: audioBlob ? getAudioFileName(audioBlob.type) : undefined,
      });
      applyEmergencyGuestSession(result);
      setSubmitted(true);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '긴급 참가 신청에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingEvent) {
    return (
      <main className="grid min-h-screen w-full place-items-center bg-white px-4 text-center text-black">
        <p className="text-[15px] font-bold text-[#999]">확인하는 중입니다</p>
      </main>
    );
  }

  if (!token || !event) {
    return (
      <main className="grid min-h-screen w-full place-items-center bg-white px-4 text-center text-black">
        <section className="w-full max-w-[390px] rounded-[30px] border border-[#f0f3f6] bg-white p-6 shadow-calendar">
          <p className="text-[18px] font-black">링크가 만료되었거나 유효하지 않습니다</p>
          <p className="mt-3 text-[14px] font-bold text-[#888]">운영자에게 새 링크를 요청해주세요.</p>
        </section>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="grid min-h-screen w-full place-items-center bg-white px-4 text-center text-black">
        <section className="w-full max-w-[390px] rounded-[30px] border border-[#f0f3f6] bg-white p-6 shadow-calendar">
          <p className="text-[18px] font-black">제출이 완료되었습니다</p>
          <p className="mt-3 text-[14px] font-bold text-[#888]">운영자가 확인하는 대로 바로 행사에 참여하실 수 있어요. 잠시만 기다려주세요.</p>
          <button
            className="mt-6 h-12 w-full rounded-[14px] bg-meet-blue text-[15px] font-black text-white"
            onClick={() => navigate(`/events/${eventId}/mode`)}
            type="button"
          >
            행사 화면으로 이동
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full max-w-full min-w-0 bg-white px-2 py-10 text-black">
      <div className="mobile-container mx-auto flex w-full max-w-full min-w-0 flex-col gap-4">
        <section className="relative w-full max-w-full min-w-0 rounded-[30px] border border-[#f0f3f6] bg-white px-2.5 pb-6 pt-14 shadow-calendar">
          <div className="absolute left-1/2 top-0 grid h-[70px] w-[70px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[16px] font-black text-black shadow-sm">
            <LogoMark className="h-full w-full rounded-full object-cover" />
          </div>
          <div className="text-center">
            <p className="text-[13px] font-black text-meet-blue">긴급 대체 참가 신청</p>
            <h1 className="mt-1 text-[20px] font-black leading-tight">{event.title}</h1>
            <p className="mt-1 text-[13px] font-bold text-[#888]">
              {event.startTime} · {event.location}
            </p>
          </div>
        </section>

        <section className="w-full max-w-full min-w-0 rounded-[30px] border border-[#f0f3f6] bg-white p-4 shadow-calendar min-[380px]:p-5">
          <FormField label="닉네임">
            <input
              className="h-12 w-full rounded-[14px] bg-meet-blueSoft px-4 text-[15px] font-bold outline-none"
              onChange={(inputEvent) => setNickname(inputEvent.target.value)}
              placeholder="행사에서 사용할 닉네임"
              value={nickname}
            />
            {touched && !nickname.trim() ? <ErrorText>닉네임을 입력해주세요.</ErrorText> : null}
          </FormField>

          <FormField label="성별">
            <div className="grid grid-cols-2 gap-2">
              {(['남성', '여성'] as const).map((option) => (
                <button
                  className={`h-12 rounded-[14px] text-[15px] font-black transition ${
                    gender === option ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black'
                  }`}
                  key={option}
                  onClick={() => setGender(option)}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            {touched && !gender ? <ErrorText>성별을 선택해주세요.</ErrorText> : null}
          </FormField>

          <FormField label="생년월일">
            <input
              className="h-12 w-full rounded-[14px] bg-meet-blueSoft px-4 text-[15px] font-bold outline-none"
              max={new Date().toISOString().slice(0, 10)}
              onChange={(inputEvent) => setBirthDate(inputEvent.target.value)}
              type="date"
              value={birthDate}
            />
            {touched && !birthDate ? <ErrorText>생년월일을 선택해주세요.</ErrorText> : null}
          </FormField>

          <FormField label="직업">
            <input
              className="h-12 w-full rounded-[14px] bg-meet-blueSoft px-4 text-[15px] font-bold outline-none"
              onChange={(inputEvent) => setJob(inputEvent.target.value)}
              placeholder="예: 회사원"
              value={job}
            />
            {touched && !job.trim() ? <ErrorText>직업을 입력해주세요.</ErrorText> : null}
          </FormField>

          <FormField label="대표 사진">
            <label className="relative grid aspect-square w-full max-w-[220px] cursor-pointer place-items-center overflow-hidden rounded-[22px] bg-meet-blueSoft text-meet-blue">
              {photoUrl ? (
                <img alt="대표 사진 미리보기" className="h-full w-full object-cover" src={photoUrl} />
              ) : (
                <span className="text-center">
                  <span className="block text-[42px] font-black leading-none">+</span>
                  <span className="mt-2 block text-[13px] font-black">사진 선택</span>
                </span>
              )}
              <input
                accept="image/*"
                className="sr-only"
                onChange={(inputEvent) => setPhoto(inputEvent.target.files?.[0] ?? null)}
                type="file"
              />
            </label>
            {touched && !photo ? <ErrorText>대표 사진을 선택해주세요.</ErrorText> : null}
          </FormField>

          <FormField label="음성 소개 (선택, 최대 3초)">
            <div className="rounded-[16px] bg-meet-blueSoft p-3">
              {recordingState === 'saved' && audioUrl ? (
                <div className="flex items-center gap-3">
                  <audio className="min-w-0 flex-1" controls src={audioUrl} />
                  <button
                    className="shrink-0 rounded-[10px] bg-white px-3 py-2 text-[12px] font-black text-meet-blue shadow-sm"
                    onClick={startRecording}
                    type="button"
                  >
                    다시 녹음
                  </button>
                </div>
              ) : (
                <button
                  className={`h-11 w-full rounded-[12px] text-[13px] font-black transition ${
                    recordingState === 'recording' ? 'bg-meet-pink text-white' : 'bg-white text-meet-blue shadow-sm'
                  }`}
                  onClick={recordingState === 'recording' ? stopRecording : startRecording}
                  type="button"
                >
                  {recordingState === 'recording' ? `녹음 중지 (${countdown}초)` : '녹음 시작'}
                </button>
              )}
              {micError ? <ErrorText>{micError}</ErrorText> : null}
            </div>
          </FormField>

          <label className="mt-4 flex items-start gap-2.5">
            <input checked={consent} className="mt-0.5 h-5 w-5" onChange={(inputEvent) => setConsent(inputEvent.target.checked)} type="checkbox" />
            <span className="text-[13px] font-bold leading-snug text-[#555]">
              개인정보 수집·이용 및 촬영(모자이크 처리)에 동의합니다.
            </span>
          </label>
          {touched && !consent ? <ErrorText>필수 동의가 필요합니다.</ErrorText> : null}

          {submitError ? <p className="mt-4 rounded-[14px] bg-meet-pinkSoft px-4 py-3 text-[13px] font-bold text-meet-pink">{submitError}</p> : null}

          <button
            className="mt-5 h-14 w-full rounded-[16px] bg-meet-blue text-[16px] font-black text-white disabled:opacity-50"
            disabled={submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? '제출하는 중' : '제출하기'}
          </button>
        </section>
      </div>
    </main>
  );
}

function FormField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[13px] font-black text-[#666]">{label}</p>
      {children}
    </div>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[12px] font-extrabold text-meet-pink">{children}</p>;
}
