import jsQR from 'jsqr';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { ReviewProfileModal } from './AdminApplicationsPage';
import {
  checkInTicketInSupabase,
  fetchAdminEventModeSummaries,
  fetchAdminTicketPreview,
  subscribeToAdminEventModeChanges,
  type AdminCheckInResult,
  type AdminEventModeSummary,
  type AdminTicketPreview,
} from '../services/supabaseApplications';
import useOperationalData from '../hooks/useOperationalData';
import type { StoredApplication } from '../utils/adminApplications';

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

const KOREA_TIME_ZONE = 'Asia/Seoul';

type ScanStage = 'idle' | 'looking-up' | 'result';

export default function AdminCheckInPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const { applications, reload: reloadApplications } = useOperationalData({ admin: true, eventId });

  const [summaries, setSummaries] = useState<AdminEventModeSummary[]>([]);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const loadSummaries = useCallback(async () => {
    setSummaryError(null);
    try {
      setSummaries(await fetchAdminEventModeSummaries());
    } catch (caughtError) {
      setSummaryError(caughtError instanceof Error ? caughtError.message : '행사 데이터를 불러오지 못했습니다.');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const safeLoad = async () => {
      if (active) await loadSummaries();
    };
    void safeLoad();
    const unsubscribe = subscribeToAdminEventModeChanges(() => void safeLoad());
    const intervalId = window.setInterval(() => void safeLoad(), 30_000);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(intervalId);
    };
  }, [loadSummaries]);

  const event = summaries.find((item) => item.id === eventId);
  const eventApplications = applications.filter((item) => item.eventId === eventId);
  const isToday = event ? event.date === getKoreaTodayKey() : false;
  const operationsActive = Boolean(event) && (event!.isTestEvent || isToday);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const scanningRef = useRef(false);
  const detectorRef = useRef<InstanceType<NonNullable<Window['BarcodeDetector']>> | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cameraError, setCameraError] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [stage, setStage] = useState<ScanStage>('idle');
  const [preview, setPreview] = useState<AdminTicketPreview | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmResult, setConfirmResult] = useState<AdminCheckInResult | null>(null);
  const [profileModalApplication, setProfileModalApplication] = useState<StoredApplication | null>(null);
  const [statusPanelOpen, setStatusPanelOpen] = useState(false);
  const lastTokenRef = useRef('');

  const previewApplication = preview?.applicationId
    ? (eventApplications.find((item) => item.dbId === preview.applicationId) ?? null)
    : null;

  useEffect(() => {
    if (!operationsActive) return undefined;
    let active = true;

    const startCamera = async () => {
      if (window.BarcodeDetector) {
        try {
          detectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detectorRef.current = null;
        }
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        trackRef.current = track ?? null;
        const capabilities = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
        setTorchSupported(Boolean(capabilities?.torch));
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scanningRef.current = true;
          void scanLoop();
        }
      } catch {
        setCameraError('카메라를 열 수 없습니다. 권한을 확인해주세요.');
      }
    };

    void startCamera();
    return () => {
      active = false;
      scanningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      trackRef.current = null;
    };
  }, [operationsActive]);

  const scanLoop = async () => {
    if (!videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    if (video.readyState >= 2) {
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          let token = '';
          if (detectorRef.current) {
            const codes = await detectorRef.current.detect(canvas);
            token = normalizeQrToken(codes[0]?.rawValue ?? '');
          } else {
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = jsQR(imageData.data, imageData.width, imageData.height);
            token = normalizeQrToken(decoded?.data ?? '');
          }
          if (token) {
            scanningRef.current = false;
            await lookupToken(token);
          }
        } catch {
          // A single decode failure is expected on most frames; keep scanning.
        }
      }
    }
    if (scanningRef.current) window.requestAnimationFrame(() => void scanLoop());
  };

  const resumeScanning = () => {
    setStage('idle');
    setPreview(null);
    setConfirmResult(null);
    lastTokenRef.current = '';
    if (streamRef.current) {
      scanningRef.current = true;
      void scanLoop();
    }
  };

  const lookupToken = async (token: string) => {
    if (!eventId) return;
    lastTokenRef.current = token;
    setStage('looking-up');
    setConfirmResult(null);
    try {
      const result = await fetchAdminTicketPreview(eventId, token);
      setPreview(result);
    } catch (caughtError) {
      setPreview({
        alreadyCheckedIn: false,
        applicationNo: '',
        message: caughtError instanceof Error ? caughtError.message : '참가자 정보를 확인하지 못했습니다.',
        nickname: '',
        ok: false,
      });
    } finally {
      setStage('result');
    }
  };

  const toggleTorch = async () => {
    if (!trackRef.current || !torchSupported) return;
    try {
      await trackRef.current.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch: boolean }] });
      setTorchOn((value) => !value);
    } catch {
      // Best-effort only - some browsers report torch support but reject the constraint.
    }
  };

  const handleImagePick = (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(image, 0, 0);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height);
        const token = normalizeQrToken(decoded?.data ?? '');
        if (token) {
          scanningRef.current = false;
          void lookupToken(token);
        } else {
          setCameraError('이미지에서 QR을 찾지 못했습니다.');
        }
      }
      URL.revokeObjectURL(objectUrl);
    };
    image.src = objectUrl;
  };

  const confirmCheckIn = async () => {
    if (!eventId || !lastTokenRef.current || confirming) return;
    setConfirming(true);
    try {
      const result = await checkInTicketInSupabase(eventId, lastTokenRef.current);
      setConfirmResult(result);
      await Promise.all([reloadApplications(), loadSummaries()]);
    } catch (caughtError) {
      setConfirmResult({
        alreadyCheckedIn: false,
        applicationNo: preview?.applicationNo ?? '',
        message: caughtError instanceof Error ? caughtError.message : '체크인 처리에 실패했습니다.',
        nickname: preview?.nickname ?? '',
        ok: false,
      });
    } finally {
      setConfirming(false);
    }
  };

  const recentCheckIns = eventApplications
    .filter((item) => item.status === '참가 확정' && item.checkedInAt)
    .sort((a, b) => new Date(b.checkedInAt ?? 0).getTime() - new Date(a.checkedInAt ?? 0).getTime());

  if (summaryLoading) return <DataLoadingState />;
  if (summaryError) return <DataErrorState message={summaryError} onRetry={loadSummaries} />;

  if (!event) {
    return (
      <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
        <div className="mobile-container mx-auto grid min-h-screen place-items-center px-5">
          <section className="w-full rounded-[28px] border border-[#f0f3f6] bg-white px-5 py-8 text-center shadow-calendar">
            <p className="text-[18px] font-black">행사를 찾을 수 없습니다</p>
            <button className="mt-5 text-[14px] font-black text-[#ef554a]" onClick={() => navigate('/admin/event-mode')} type="button">
              행사모드로 돌아가기
            </button>
          </section>
        </div>
      </main>
    );
  }

  const confirmedTotal = event.confirmedCount;
  const checkedInTotal = event.checkinCount;
  const notCheckedInTotal = Math.max(0, confirmedTotal - checkedInTotal);

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-4 pb-[calc(32px+env(safe-area-inset-bottom))] pt-[calc(16px+env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <button
              className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center text-[#333]"
              onClick={() => navigate(`/admin/events/${event.id}/prepare`)}
              type="button"
            >
              <BackIcon />
            </button>
            <div className="min-w-0">
              <h1 className="text-[24px] font-black leading-tight">참가자 체크인</h1>
              <p className="mt-1 text-[13px] font-bold text-[#888]">QR을 스캔하여 참가자의 입장을 확인하세요</p>
            </div>
          </div>
          <button
            className="flex shrink-0 items-center gap-1.5 rounded-[12px] border border-[#e5e5e5] px-3 py-2 text-[13px] font-black text-[#333]"
            onClick={() => setStatusPanelOpen(true)}
            type="button"
          >
            <ListIcon />
            체크인 현황
          </button>
        </header>

        {!operationsActive ? (
          <section className="mt-5 rounded-[22px] border border-[#f0d9d3] bg-[#fff8f5] px-5 py-8 text-center">
            <p className="text-[16px] font-black text-[#a35850]">{formatMonthDayKorean(event.date)}부터 체크인 및 행사 운영 기능을 사용할 수 있어요.</p>
          </section>
        ) : (
          <section className="mt-5">
            <div className="relative overflow-hidden rounded-[22px] bg-black">
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />

              {stage === 'idle' ? (
                <div className="pointer-events-none absolute inset-0">
                  <p className="mx-auto mt-4 w-fit rounded-[10px] bg-black/55 px-3 py-1.5 text-[13px] font-black text-white">QR을 화면 중앙에 맞춰주세요</p>
                  <div className="absolute left-1/2 top-1/2 h-[62%] w-[70%] -translate-x-1/2 -translate-y-1/2">
                    <ScanFrame />
                  </div>
                </div>
              ) : null}

              {stage === 'looking-up' ? (
                <div className="absolute inset-0 grid place-items-center bg-black/60">
                  <p className="text-[15px] font-black text-white">참가자 정보를 확인하는 중</p>
                </div>
              ) : null}

              <button
                className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white disabled:opacity-30"
                disabled={!torchSupported}
                onClick={() => void toggleTorch()}
                type="button"
              >
                <FlashIcon on={torchOn} />
              </button>
              <button
                className="absolute bottom-3 left-3 grid h-9 w-9 place-items-center rounded-full bg-black/45 text-white"
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <GalleryIcon />
              </button>
              <input
                accept="image/*"
                className="hidden"
                onChange={(changeEvent) => {
                  handleImagePick(changeEvent.target.files);
                  changeEvent.target.value = '';
                }}
                ref={fileInputRef}
                style={{ display: 'none' }}
                type="file"
              />
            </div>
            {cameraError ? <p className="mt-3 text-center text-[13px] font-bold text-[#ef554a]">{cameraError}</p> : null}

            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] items-start gap-4 rounded-[20px] bg-[#fff1ee] px-4 py-4">
              <InfoBlock description="스캔 시 참가자 현황에 자동 기록됩니다" icon={<CheckCircleIcon />} title="자동 등록" />
              <div className="h-full w-px bg-[#ef554a]/15" />
              <InfoBlock description="프로필과 신분증을 대조하여 신원을 확인해주세요" icon={<PersonIcon />} title="신원 확인 필수" />
            </div>
          </section>
        )}

        {stage === 'result' && preview ? (
          <ScanResultCard
            application={previewApplication}
            confirmResult={confirmResult}
            confirming={confirming}
            onConfirm={() => void confirmCheckIn()}
            onRescan={resumeScanning}
            onViewProfile={() => previewApplication && setProfileModalApplication(previewApplication)}
            preview={preview}
          />
        ) : null}

        <section className="mt-7">
          <div className="flex items-center justify-between">
            <h2 className="text-[18px] font-black">최근 체크인</h2>
            <button className="text-[13px] font-black text-[#ef554a]" onClick={() => setStatusPanelOpen(true)} type="button">
              전체보기 ›
            </button>
          </div>

          {recentCheckIns.length === 0 ? (
            <div className="mt-3 rounded-[18px] border border-[#f0f0f0] bg-[#fafafa] px-4 py-6 text-center">
              <p className="text-[14px] font-bold text-[#999]">아직 체크인한 참가자가 없습니다</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {recentCheckIns.slice(0, 3).map((item) => (
                <RecentCheckInCard key={item.dbId} application={item} />
              ))}
            </div>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[18px] font-black">참가자 현황</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border border-[#f0f0f0] bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-[#555]">
                <PersonIcon />
                <span className="text-[14px] font-black">체크인 완료</span>
              </div>
              <p className="mt-2 text-[20px] font-black">
                <span className="text-[#ef554a]">{checkedInTotal}</span> / {confirmedTotal}명
              </p>
            </div>
            <div className="rounded-[18px] border border-[#f0f0f0] bg-white px-4 py-4">
              <div className="flex items-center gap-2 text-[#555]">
                <PersonIcon />
                <span className="text-[14px] font-black">미체크인</span>
              </div>
              <p className="mt-2 text-[20px] font-black">
                <span className="text-[#999]">{notCheckedInTotal}</span> / {confirmedTotal}명
              </p>
            </div>
          </div>
        </section>
      </div>

      {profileModalApplication ? (
        <ReviewProfileModal application={profileModalApplication} onClose={() => setProfileModalApplication(null)} onDecide={() => undefined} />
      ) : null}

      {statusPanelOpen ? (
        <CheckInStatusPanel applications={eventApplications} onClose={() => setStatusPanelOpen(false)} />
      ) : null}
    </main>
  );
}

function ScanResultCard({
  application,
  confirmResult,
  confirming,
  onConfirm,
  onRescan,
  onViewProfile,
  preview,
}: {
  application: StoredApplication | null;
  confirmResult: AdminCheckInResult | null;
  confirming: boolean;
  onConfirm: () => void;
  onRescan: () => void;
  onViewProfile: () => void;
  preview: AdminTicketPreview;
}) {
  if (!preview.ok) {
    return (
      <section className="mt-5 rounded-[20px] bg-meet-pinkSoft px-5 py-5 text-center">
        <p className="text-[16px] font-black text-meet-pink">{preview.message}</p>
        <button className="mt-4 h-11 rounded-[12px] bg-white px-5 text-[14px] font-black text-meet-pink" onClick={onRescan} type="button">
          다시 스캔
        </button>
      </section>
    );
  }

  const justConfirmed = confirmResult?.ok && !confirmResult.alreadyCheckedIn;
  const alreadyCheckedIn = confirmResult ? confirmResult.alreadyCheckedIn : preview.alreadyCheckedIn;
  const checkedInAt = confirmResult?.checkedInAt ?? preview.checkedInAt;
  const nickname = application?.profile?.nickname || preview.nickname || '참가자';
  const applicationNo = application?.id || preview.applicationNo;

  return (
    <section className="mt-5 rounded-[20px] border border-[#f0d9d3] bg-[#fff8f5] px-5 py-5">
      <div className="flex items-center gap-3">
        <Avatar gender={application?.gender} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[18px] font-black">{nickname}님</p>
          <p className="text-[13px] font-bold text-[#999]">{applicationNo}</p>
          {application ? (
            <p className="mt-1 text-[13px] font-bold text-[#777]">
              {application.gender === '남성' ? '남' : '여'} · {application.age}세 · {application.profile?.job ?? '-'}
            </p>
          ) : null}
        </div>
        {alreadyCheckedIn || justConfirmed ? (
          <span className="flex shrink-0 items-center gap-1 rounded-[10px] bg-[#eaf6e8] px-2.5 py-1.5 text-[12px] font-black text-[#3f9142]">
            <CheckCircleIcon /> 체크인 완료
          </span>
        ) : null}
      </div>

      {alreadyCheckedIn ? (
        <p className="mt-4 text-center text-[13px] font-bold text-[#a35850]">
          이미 체크인한 참가자입니다{checkedInAt ? ` · ${formatKstTime(checkedInAt)}` : ''}
        </p>
      ) : null}
      {confirmResult && !confirmResult.ok ? <p className="mt-4 text-center text-[13px] font-bold text-[#ef554a]">{confirmResult.message}</p> : null}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          className="h-13 rounded-[12px] border border-[#ef554a] px-4 py-3 text-[14px] font-black text-[#ef554a] disabled:opacity-50"
          disabled={!application}
          onClick={onViewProfile}
          type="button"
        >
          프로필 확인
        </button>
        {alreadyCheckedIn || justConfirmed ? (
          <button className="h-13 rounded-[12px] bg-[#8fae7f] px-4 py-3 text-[14px] font-black text-white" onClick={onRescan} type="button">
            다시 스캔
          </button>
        ) : (
          <button
            className="h-13 rounded-[12px] bg-[#ef4039] px-4 py-3 text-[14px] font-black text-white disabled:bg-[#e2c3bc]"
            disabled={confirming}
            onClick={onConfirm}
            type="button"
          >
            {confirming ? '처리 중' : '행사 입장 완료'}
          </button>
        )}
      </div>
    </section>
  );
}

function RecentCheckInCard({ application }: { application: StoredApplication }) {
  return (
    <div className="flex items-center gap-3 rounded-[16px] border border-[#f0f0f0] bg-white px-4 py-3">
      <Avatar gender={application.gender} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-black">{application.profile?.nickname || application.userId}님</p>
        <p className="text-[12px] font-bold text-[#999]">{application.id}</p>
        <p className="text-[12px] font-bold text-[#888]">
          {application.gender === '남성' ? '남' : '여'} · {application.age}세 · {application.profile?.job ?? '-'}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="flex items-center justify-end gap-1 text-[12px] font-black text-[#3f9142]">
          <CheckCircleIcon /> 체크인 완료
        </span>
        {application.checkedInAt ? <p className="mt-1 text-[12px] font-bold text-[#999]">{formatKstTime(application.checkedInAt)}</p> : null}
      </div>
    </div>
  );
}

function CheckInStatusPanel({ applications, onClose }: { applications: StoredApplication[]; onClose: () => void }) {
  const confirmed = applications
    .filter((item) => item.status === '참가 확정')
    .sort((a, b) => {
      if (Boolean(a.checkedInAt) !== Boolean(b.checkedInAt)) return a.checkedInAt ? -1 : 1;
      return new Date(b.checkedInAt ?? 0).getTime() - new Date(a.checkedInAt ?? 0).getTime();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-[430px] overflow-y-auto rounded-t-[28px] bg-white px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-5"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[#e5e5e5]" />
        <div className="mt-4 flex items-center justify-between">
          <h3 className="text-[18px] font-black">체크인 현황 전체보기</h3>
          <button className="text-[14px] font-black text-[#999]" onClick={onClose} type="button">
            닫기
          </button>
        </div>

        {confirmed.length === 0 ? (
          <p className="mt-6 text-center text-[14px] font-bold text-[#999]">참가확정된 참가자가 없습니다</p>
        ) : (
          <div className="mt-4 space-y-2">
            {confirmed.map((item) => (
              <div key={item.dbId} className="flex items-center gap-3 rounded-[14px] border border-[#f0f0f0] px-3 py-2.5">
                <Avatar gender={item.gender} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-black">{item.profile?.nickname || item.userId}님</p>
                  <p className="text-[12px] font-bold text-[#999]">{item.id}</p>
                </div>
                {item.checkedInAt ? (
                  <span className="shrink-0 text-[12px] font-black text-[#3f9142]">체크인 {formatKstTime(item.checkedInAt)}</span>
                ) : (
                  <span className="shrink-0 text-[12px] font-black text-[#bbb]">미체크인</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ gender }: { gender?: '남성' | '여성' }) {
  const color = gender === '남성' ? '#5aa7e9' : gender === '여성' ? '#ef8fa0' : '#ccc';
  return (
    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full" style={{ backgroundColor: `${color}22` }}>
      <PersonIcon color={color} />
    </span>
  );
}

function InfoBlock({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[#ef554a]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[13px] font-black text-[#1f292d]">{title}</p>
        <p className="mt-0.5 text-[11px] font-bold leading-snug text-[#a35850]">{description}</p>
      </div>
    </div>
  );
}

function normalizeQrToken(value: string) {
  return value.trim().replace(/^t2m:/i, '');
}

function getKoreaTodayKey() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: KOREA_TIME_ZONE,
    year: 'numeric',
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function formatMonthDayKorean(dateValue: string) {
  const date = new Date(`${dateValue}T00:00:00+09:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function formatKstTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', hour12: false, minute: '2-digit', second: '2-digit', timeZone: KOREA_TIME_ZONE });
}

function BackIcon() {
  return (
    <svg aria-hidden="true" className="h-6 w-6" fill="none" viewBox="0 0 24 24">
      <path d="m15 5-7 7 7 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
    </svg>
  );
}

function FlashIcon({ on }: { on: boolean }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill={on ? 'currentColor' : 'none'} viewBox="0 0 24 24">
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function GalleryIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
      <rect height="16" rx="2" stroke="currentColor" strokeWidth="1.8" width="18" x="3" y="4" />
      <circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4 17 5-5 3 3 4-4 4 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m8 12.5 2.5 2.5L16 9.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}

function PersonIcon({ color = 'currentColor' }: { color?: string }) {
  return (
    <svg aria-hidden="true" className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.6" stroke={color} strokeWidth="1.8" />
      <path d="M4.5 20c1.2-4 4-6 7.5-6s6.3 2 7.5 6" stroke={color} strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  );
}

function ScanFrame() {
  const corner = 'M0 10V2a2 2 0 0 1 2-2h8';
  return (
    <svg aria-hidden="true" className="h-full w-full text-white" fill="none" viewBox="0 0 100 100">
      <g strokeLinecap="round" strokeWidth="4">
        <path d={corner} stroke="currentColor" transform="translate(2,2)" />
        <path d={corner} stroke="currentColor" transform="translate(98,2) scale(-1,1)" />
        <path d={corner} stroke="currentColor" transform="translate(2,98) scale(1,-1)" />
        <path d={corner} stroke="currentColor" transform="translate(98,98) scale(-1,-1)" />
      </g>
      <line stroke="#ef554a" strokeLinecap="round" strokeWidth="2" x1="12" x2="88" y1="50" y2="50" />
    </svg>
  );
}
