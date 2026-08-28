import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataErrorState, DataLoadingState } from '../components/DataState';
import { fetchAdminApplicationErrorLogs, type ApplicationErrorLogRow } from '../services/supabaseApplications';

const stageLabels: Record<string, string> = {
  application_insert: '신청서 저장',
  file_encoding: '파일 인코딩',
  file_validation: '파일 검증',
  image_compression: '이미지 압축',
  response: '서버 응답',
  storage_upload: '파일 업로드',
  submit_request: '요청 전송',
  unknown: '알 수 없음',
};

export default function AdminApplicationErrorsPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<ApplicationErrorLogRow[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setLogs(await fetchAdminApplicationErrorLogs(100));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : '오류 로그를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <DataLoadingState />;
  if (error) return <DataErrorState message={error} onRetry={load} />;

  return (
    <main className="admin-page min-h-screen w-full max-w-full min-w-0 bg-white text-black">
      <div className="mobile-container mx-auto min-h-screen w-full max-w-full min-w-0 px-3 pb-8 pt-2">
        <header className="mb-1 flex max-w-full min-w-0 items-center gap-1 overflow-hidden">
          <img alt="time2meet" className="h-auto w-[150px] max-w-[60%] shrink-0 object-contain" src="/assets/time2meet-logo.png" />
          <span className="min-w-0 translate-y-[3px] text-[11px] font-black leading-none text-black">for administrators</span>
        </header>

        <div className="mt-5 flex items-center justify-between">
          <h1 className="text-[22px] font-black">최근 오류</h1>
          <button className="text-[13px] font-black text-meet-blue" onClick={() => navigate('/admin')} type="button">
            ← 관리자 홈
          </button>
        </div>
        <p className="mt-1 text-[13px] font-extrabold text-[#8a8a8a]">최근 {logs?.length ?? 0}건 (최신순)</p>

        <div className="mt-4 space-y-3">
          {logs && logs.length === 0 ? (
            <p className="rounded-[18px] bg-meet-blueSoft p-4 text-center text-[14px] font-black text-[#555]">
              최근 오류가 없습니다.
            </p>
          ) : null}
          {(logs ?? []).map((log) => (
            <article className="rounded-[18px] border border-[#f0f3f6] bg-white p-4 shadow-sm" key={log.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[13px] font-black text-[#8a8a8a]">{formatDateTime(log.createdAt)}</p>
                <span className="rounded-[8px] bg-meet-pinkSoft px-2 py-0.5 text-[11px] font-black text-meet-pink">
                  {log.context || stageLabels[log.stage] || log.stage}
                </span>
              </div>
              <p className="mt-2 text-[15px] font-black text-black">
                {log.eventTitle ?? log.eventId ?? '행사 정보 없음'}
                {log.applicationNo ? <span className="ml-2 text-[12px] font-extrabold text-[#8a8a8a]">#{log.applicationNo}</span> : null}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[14px] font-extrabold leading-relaxed text-[#333]">{log.message || '(메시지 없음)'}</p>
              <p className="mt-2 text-fluid-safe text-[12px] font-extrabold leading-relaxed text-[#9aa0a7]">
                {log.userAgent || '기기 정보 없음'}
              </p>
              <p className="mt-1 text-[12px] font-extrabold text-[#9aa0a7]">
                파일 {log.fileCount ?? '-'}개 · 총 {formatBytes(log.totalBytes)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}

function formatDateTime(value: string) {
  const date = new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}.${day} ${hours}:${minutes}`;
}

function formatBytes(value: number | null) {
  if (value === null || value === undefined) return '-';
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}
