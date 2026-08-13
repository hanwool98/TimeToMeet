import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import useOperationalData from '../hooks/useOperationalData';
import { checkInTicketInSupabase, type AdminCheckInResult } from '../services/supabaseApplications';

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => {
      detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
    };
  }
}

export default function AdminCheckInPage() {
  const { eventId } = useParams();
  const { error, events, loading, reload } = useOperationalData({ admin: true, eventId });
  const event = events.find((item) => item.id === eventId);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanningRef = useRef(false);
  const [manualToken, setManualToken] = useState('');
  const [scanError, setScanError] = useState('');
  const [result, setResult] = useState<AdminCheckInResult | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    let active = true;
    const startCamera = async () => {
      if (!window.BarcodeDetector) {
        setScanError('이 브라우저에서는 카메라 QR 스캔을 지원하지 않아 토큰 입력으로 확인할 수 있습니다.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!active) return;
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scanningRef.current = true;
          void scanLoop();
        }
      } catch {
        setScanError('카메라를 열 수 없습니다. 권한을 확인하거나 토큰 입력으로 확인해주세요.');
      }
    };

    void startCamera();
    return () => {
      active = false;
      scanningRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const scanLoop = async () => {
    if (!window.BarcodeDetector || !videoRef.current || !canvasRef.current || processing) {
      if (scanningRef.current) window.requestAnimationFrame(() => void scanLoop());
      return;
    }

    const video = videoRef.current;
    if (video.readyState >= 2) {
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          const codes = await detector.detect(canvas);
          const token = normalizeQrToken(codes[0]?.rawValue ?? '');
          if (token) {
            scanningRef.current = false;
            await verifyToken(token);
          }
        } catch {
          setScanError('QR을 읽는 중 문제가 발생했습니다. 토큰 입력을 이용해주세요.');
        }
      }
    }
    if (scanningRef.current) window.requestAnimationFrame(() => void scanLoop());
  };

  const verifyToken = async (token: string) => {
    if (!eventId || processing) return;
    setProcessing(true);
    setScanError('');
    try {
      const nextResult = await checkInTicketInSupabase(eventId, token);
      setResult(nextResult);
    } catch (caughtError) {
      setResult(null);
      setScanError(caughtError instanceof Error ? caughtError.message : '입장 확인에 실패했습니다.');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={reload} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>
        <section className="rounded-[26px] border border-[#f0f3f6] bg-white p-4 shadow-calendar">
          <h1 className="text-[26px] font-black">입장 관리</h1>
          <p className="mt-2 text-[15px] font-black text-[#777]">{event?.title ?? '행사'} QR 스캔</p>

          <div className="mt-5 overflow-hidden rounded-[22px] bg-black">
            <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
            <canvas ref={canvasRef} className="hidden" />
          </div>

          <div className="mt-5 space-y-3 rounded-[20px] bg-meet-blueSoft p-4">
            <label className="block">
              <span className="text-[14px] font-black text-[#777]">QR 토큰 직접 입력</span>
              <input
                className="mt-2 h-12 w-full rounded-[14px] bg-white px-3 text-[15px] font-black outline-none"
                onChange={(event) => setManualToken(event.target.value)}
                placeholder="t2m:..."
                value={manualToken}
              />
            </label>
            <button
              className="h-12 w-full rounded-[16px] bg-meet-blue text-[15px] font-black text-white disabled:bg-[#d9d9d9]"
              disabled={processing || !manualToken.trim()}
              onClick={() => void verifyToken(normalizeQrToken(manualToken))}
              type="button"
            >
              {processing ? '확인 중' : '입장 확인'}
            </button>
          </div>

          {result ? (
            <div className={['mt-5 rounded-[18px] p-4 text-[15px] font-black leading-relaxed', result.ok ? 'bg-meet-blueSoft text-meet-blue' : 'bg-meet-pinkSoft text-meet-pink'].join(' ')}>
              <p>{result.message}</p>
              <p className="mt-1 text-black">{result.applicationNo} · {result.nickname}</p>
              {result.checkedInAt ? <p className="mt-1 text-[#666]">입장 시각 {formatDateTime(result.checkedInAt)}</p> : null}
            </div>
          ) : null}
          {scanError ? <p className="mt-5 rounded-[18px] bg-meet-pinkSoft p-4 text-[14px] font-black text-meet-pink">{scanError}</p> : null}
        </section>
        <Link className="mx-auto mt-5 block text-center text-sm font-extrabold text-meet-blue" to={eventId ? `/admin/events/${eventId}` : '/admin'}>
          돌아가기
        </Link>
      </div>
    </main>
  );
}

function normalizeQrToken(value: string) {
  return value.trim().replace(/^t2m:/i, '');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hours}:${minutes}`;
}
