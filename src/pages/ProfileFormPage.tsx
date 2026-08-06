import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PrimaryButton from '../components/PrimaryButton';

const eventDate = new Date(2026, 7, 16);
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
      '프로필 정보 제공: 모자이크된 대표사진, 닉네임, 연령대, 직업, 5초 자기소개 음성',
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

function getAgeOnEventDate(birthDate: string) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  let age = eventDate.getFullYear() - birth.getFullYear();
  const monthDiff = eventDate.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && eventDate.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
}

function filePreview(file?: File) {
  return file ? URL.createObjectURL(file) : '';
}

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
    <section className="rounded-[30px] border border-[#f0f3f6] bg-white p-5 shadow-calendar">
      <h2 className="mb-5 break-keep text-[22px] font-black leading-tight">{title}</h2>
      {children}
    </section>
  );
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-2 text-[12px] font-extrabold text-meet-pink">{children}</p>;
}

export default function ProfileFormPage() {
  const navigate = useNavigate();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const countdownTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const [guideConfirmed, setGuideConfirmed] = useState(false);
  const [consents, setConsents] = useState({ privacy: false, thirdParty: false });
  const [name, setName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState('');
  const [location, setLocation] = useState('');
  const [phone, setPhone] = useState('');
  const [singleConfirmed, setSingleConfirmed] = useState(false);
  const [idPhoto, setIdPhoto] = useState<File | null>(null);
  const [nickname, setNickname] = useState('');
  const [profilePhotos, setProfilePhotos] = useState<File[]>([]);
  const [representativeIndex, setRepresentativeIndex] = useState(0);
  const [hasFullBodyPhoto, setHasFullBodyPhoto] = useState(false);
  const [audioUrl, setAudioUrl] = useState('');
  const [recordingState, setRecordingState] = useState<'idle' | 'recording' | 'saved'>('idle');
  const [countdown, setCountdown] = useState(5);
  const [micError, setMicError] = useState('');
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

  const age = useMemo(() => getAgeOnEventDate(birthDate), [birthDate]);
  const ageError = birthDate && (age === null || age < 23 || age > 35) ? '행사일 기준 만 23~35세만 신청할 수 있습니다.' : '';
  const idPreview = useMemo(() => filePreview(idPhoto ?? undefined), [idPhoto]);
  const employmentPreview = useMemo(() => filePreview(employmentProof ?? undefined), [employmentProof]);
  const photoPreviews = useMemo(() => profilePhotos.map((file) => URL.createObjectURL(file)), [profilePhotos]);

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
      hasFullBodyPhoto &&
      audioUrl &&
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];
      setCountdown(5);
      setRecordingState('recording');

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioUrl(URL.createObjectURL(blob));
        setRecordingState('saved');
        if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
        if (stopTimerRef.current) window.clearTimeout(stopTimerRef.current);
      };

      recorder.start();
      countdownTimerRef.current = window.setInterval(() => {
        setCountdown((current) => Math.max(0, current - 1));
      }, 1000);
      stopTimerRef.current = window.setTimeout(() => recorder.stop(), 5000);
    } catch {
      setMicError('마이크 권한이 거부되었거나 사용할 수 없습니다. 브라우저 설정에서 마이크 권한을 허용해주세요.');
      setRecordingState('idle');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const submit = () => {
    setTouched(true);
    if (!isRequiredComplete) return;
    navigate('/application-complete');
  };

  return (
    <main className="min-h-screen overflow-x-hidden bg-white px-4 py-12 text-black">
      <div className="mx-auto w-full max-w-[430px]">
        <header className="relative mb-8 rounded-[30px] border border-[#f0f3f6] bg-white px-5 pb-7 pt-16 text-center shadow-calendar">
          <button aria-label="뒤로 가기" className="absolute left-5 top-5 grid h-10 w-10 place-items-center text-black" onClick={() => navigate(-1)} type="button">
            <BackIcon />
          </button>
          <div className="absolute left-1/2 top-0 grid h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-meet-blueSoft text-[18px] font-black shadow-sm">
            로고
          </div>
          <h1 className="break-keep text-[23px] font-black leading-tight">타임투밋 행사 참여 위한 프로필 작성</h1>
        </header>

        <form className="space-y-8" onSubmit={(event) => event.preventDefault()}>
          <Section title="1. 참가 전 꼭 확인해주세요">
            <div className="rounded-[22px] border-4 border-meet-blue bg-[#f8fbff] p-4 text-[13px] font-extrabold leading-relaxed text-[#777]">
              <ol className="list-decimal space-y-2 pl-4">
                <li>타임투밋은 여러 참가자와 정해진 시간 동안 1:1로 대화하며 새로운 인연을 만나는 로테이션 소개팅입니다.</li>
                <li className="text-red-500">프로필 작성은 참가 확정을 의미하지 않습니다. 신청 현황과 성비 등을 고려해 선정 결과를 개별 안내드립니다.</li>
                <li className="text-red-500">최소 참가인원(남 6 : 여 6)이 모집되지 않았을 시 행사가 부득이하게 취소될 수 있으며, 이 경우 전액환불을 보장합니다.</li>
                <li>원활한 매칭을 위해 프로필에는 사실에 기반한 정보를 입력해주세요.</li>
                <li className="text-red-500">참가가 확정된 이후에는 안내된 기한 내에 참가비를 결제해야 예약이 완료됩니다.</li>
                <li>행사에서는 모든 참가자와 정해진 순서에 따라 대화합니다.</li>
                <li>프로필은 행사 종료 최종 매칭된 상대에게만 전달되며 전화번호는 매칭 전까지 전달되지 않습니다.</li>
                <li>행사 당일에는 안내된 시간까지 도착해주세요.</li>
                <li>다른 참가자의 프로필과 행사 중 알게 된 개인정보를 촬영·저장하거나 외부에 공유할 수 없습니다.</li>
              </ol>
              <label className="mt-6 flex items-center gap-2 text-black">
                <input checked={guideConfirmed} onChange={(event) => setGuideConfirmed(event.target.checked)} type="checkbox" />
                참가 안내 및 운영 규정을 확인했습니다.
              </label>
            </div>
            <ErrorText>{touched && !guideConfirmed ? '참가 안내 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="2. 필수 동의">
            <p className="mb-4 break-keep text-[14px] font-extrabold leading-relaxed text-[#777]">동의를 거부할 수 있으나, 거부 시 행사 신청 및 참가가 제한됩니다.</p>
            <div className="rounded-[22px] bg-meet-blueSoft p-4">
              {requiredConsentText.map((consent) => (
                <details className="border-b border-white/80 py-3 last:border-b-0" key={consent.id}>
                  <summary className="cursor-pointer text-[14px] font-black">{consent.title}</summary>
                  <div className="mt-3 space-y-2 text-[12px] font-extrabold leading-relaxed text-[#666]">
                    {consent.body.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-[13px] font-black">
                    <input
                      checked={consents[consent.id as keyof typeof consents]}
                      onChange={(event) => setConsents((current) => ({ ...current, [consent.id]: event.target.checked }))}
                      type="checkbox"
                    />
                    동의합니다.
                  </label>
                </details>
              ))}
              <button className="mt-4 border-b-2 border-black text-[14px] font-black" onClick={() => setConsents({ privacy: true, thirdParty: true })} type="button">
                전체 동의하기
              </button>
            </div>
            <ErrorText>{touched && (!consents.privacy || !consents.thirdParty) ? '필수 동의가 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="3. 이름">
            <input className="h-12 w-full border-b-2 border-[#aaa] bg-transparent px-1 text-[17px] font-bold outline-none focus:border-meet-blue" onChange={(event) => setName(event.target.value)} placeholder="이름" value={name} />
            <ErrorText>{touched && !name.trim() ? '이름을 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="4. 나이">
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setBirthDate(event.target.value)} type="date" value={birthDate} />
            {age !== null && !ageError ? <p className="mt-3 text-[13px] font-extrabold text-[#777]">행사일 기준 만 {age}세입니다.</p> : null}
            <ErrorText>{ageError || (touched && !birthDate ? '생년월일을 선택해주세요.' : '')}</ErrorText>
          </Section>

          <Section title="5. 성별">
            <div className="grid grid-cols-2 gap-3">
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
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="010-0000-0000" value={phone} />
            <ErrorText>{touched && !phone.trim() ? '전화번호를 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="8. 결혼 및 교제 여부">
            <p className="mb-4 break-keep text-[13px] font-extrabold leading-relaxed text-[#777]">허위 응답 시 이후 행사 참여 제한 및 법적 조치가 이루어질 수 있습니다.</p>
            <label className="flex items-center gap-2 text-[14px] font-black">
              <input checked={singleConfirmed} onChange={(event) => setSingleConfirmed(event.target.checked)} type="checkbox" />
              미혼이며 교제하는 인원이 없습니다.
            </label>
            <ErrorText>{touched && !singleConfirmed ? '확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="9. 본인확인용 신분증 사진 첨부">
            <p className="mb-4 break-keep text-[13px] font-extrabold leading-relaxed text-[#777]">민감한 정보는 가려도 되며 이름과 생년월일만 확인되면 됩니다.</p>
            <input accept="image/*" onChange={(event) => setIdPhoto(event.target.files?.[0] ?? null)} type="file" />
            {idPreview ? <img alt="신분증 미리보기" className="mt-4 max-h-52 w-full rounded-[18px] object-cover" src={idPreview} /> : null}
            <ErrorText>{touched && !idPhoto ? '신분증 사진을 첨부해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="10. 닉네임">
            <p className="mb-4 break-keep text-[13px] font-extrabold text-[#777]">소개팅에서 계속 사용할 닉네임이니 신중하고 개성있는 닉네임을 사용해주세요.</p>
            <input className="h-12 w-full rounded-[18px] bg-meet-blueSoft px-4 text-[16px] font-bold outline-none" onChange={(event) => setNickname(event.target.value)} placeholder="닉네임" value={nickname} />
            <ErrorText>{touched && !nickname.trim() ? '닉네임을 입력해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="11. 본인 사진">
            <p className="mb-4 break-keep text-[13px] font-extrabold leading-relaxed text-[#777]">최대 3장까지 첨부할 수 있으며, 전신 사진을 최소 1장 포함해주세요. 대표사진은 모자이크 처리된 상태로 참가자 리스트에 공개됩니다.</p>
            <input accept="image/*" multiple onChange={(event) => setProfilePhotos(Array.from(event.target.files ?? []).slice(0, 3))} type="file" />
            <div className="mt-4 grid grid-cols-3 gap-2">
              {photoPreviews.map((preview, index) => (
                <button className={`rounded-[16px] border-4 ${representativeIndex === index ? 'border-meet-blue' : 'border-transparent'}`} key={preview} onClick={() => setRepresentativeIndex(index)} type="button">
                  <img alt={`본인 사진 ${index + 1}`} className="aspect-square w-full rounded-[12px] object-cover" src={preview} />
                  <span className="block py-1 text-[11px] font-black">{representativeIndex === index ? '대표사진' : '대표 선택'}</span>
                </button>
              ))}
            </div>
            <label className="mt-4 flex items-center gap-2 text-[13px] font-black">
              <input checked={hasFullBodyPhoto} onChange={(event) => setHasFullBodyPhoto(event.target.checked)} type="checkbox" />
              전신 사진이 포함되어 있습니다.
            </label>
            <ErrorText>{touched && (profilePhotos.length === 0 || !hasFullBodyPhoto) ? '사진 첨부와 전신 사진 포함 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="12. 5초 자기소개">
            <p className="mb-4 break-keep text-[13px] font-extrabold text-[#777]">너의 목소리를 들려줘. 최대 5초 동안 녹음됩니다.</p>
            {recordingState === 'recording' ? (
              <PrimaryButton onClick={stopRecording}>녹음 중 {countdown}초</PrimaryButton>
            ) : (
              <PrimaryButton onClick={startRecording}>{audioUrl ? '다시 녹음' : '녹음 시작'}</PrimaryButton>
            )}
            {audioUrl ? <audio className="mt-4 w-full" controls src={audioUrl} /> : null}
            <ErrorText>{micError || (touched && !audioUrl ? '5초 자기소개 녹음이 필요합니다.' : '')}</ErrorText>
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
            <p className="mb-4 break-keep text-[13px] font-extrabold text-[#777]">사원증, 명함 등 본인의 재직사실을 증명할 수 있는 사진을 첨부해주세요.</p>
            <input accept="image/*" onChange={(event) => setEmploymentProof(event.target.files?.[0] ?? null)} type="file" />
            {employmentPreview ? <img alt="재직 증명 미리보기" className="mt-4 max-h-52 w-full rounded-[18px] object-cover" src={employmentPreview} /> : null}
            <ErrorText>{touched && !employmentProof ? '재직 증명 사진을 첨부해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="16. 접속 경로">
            <div className="grid grid-cols-2 gap-2">
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
            <p className="mb-4 break-keep text-[13px] font-extrabold text-[#777]">소개팅 현장을 인스타 홍보 및 후기 작성 목적으로 촬영하며 모자이크를 보장합니다.</p>
            <label className="flex items-center gap-2 text-[14px] font-black">
              <input checked={filmingConsent} onChange={(event) => setFilmingConsent(event.target.checked)} type="checkbox" />
              촬영에 동의합니다.
            </label>
            <ErrorText>{touched && !filmingConsent ? '촬영 동의가 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="18. 인터뷰 여부">
            <p className="mb-4 break-keep text-[13px] font-extrabold text-[#777]">원하면 모자이크 제공 또는 얼굴 아래로 촬영합니다.</p>
            <div className="grid grid-cols-2 gap-3">
              {['참여', '미참여'].map((option) => (
                <button className={`h-12 rounded-[18px] text-[16px] font-black ${interview === option ? 'bg-meet-blue text-white' : 'bg-meet-blueSoft text-black'}`} key={option} onClick={() => setInterview(option)} type="button">
                  {option}
                </button>
              ))}
            </div>
            <ErrorText>{touched && !interview ? '인터뷰 여부를 선택해주세요.' : ''}</ErrorText>
          </Section>

          <Section title="19. 환불규정">
            <div className="rounded-[22px] bg-meet-blueSoft p-4 text-[14px] font-extrabold leading-relaxed text-[#555]">
              <p>행사 8일 전까지: 100% 환불</p>
              <p>행사 4~7일 전: 50% 환불</p>
              <p>행사 3일 전부터 당일: 환불 불가</p>
            </div>
            <label className="mt-4 flex items-center gap-2 text-[14px] font-black">
              <input checked={refundConsent} onChange={(event) => setRefundConsent(event.target.checked)} type="checkbox" />
              환불규정을 확인했습니다.
            </label>
            <ErrorText>{touched && !refundConsent ? '환불규정 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <Section title="20. 타임투밋 문의사항">
            <textarea className="min-h-32 w-full rounded-[18px] bg-meet-blueSoft p-4 text-[15px] font-bold outline-none" onChange={(event) => setInquiry(event.target.value)} placeholder="운영진 측에서 알아야 할 정보가 있다면 알려주세요!" value={inquiry} />
          </Section>

          <Section title="21. 심사 후 개별 연락 안내">
            <p className="break-keep text-[14px] font-extrabold leading-relaxed text-[#666]">
              프로필에 누락된 내용이 있을 시 참여가 제한될 수 있으며, 신청 현황과 성비 등을 종합적으로 고려해 참가자를 선정합니다. 일부 신청자는 대기 명단으로 안내될 수 있습니다. 심사결과는 12시간 이내에 메시지, 앱을 통해 확인하실 수 있으며, 참가자로 선정된 후 안내 시점으로부터 24시간 이내에 결제를 완료해야 참가가 최종 확정됩니다.
            </p>
            <label className="mt-4 flex items-center gap-2 text-[14px] font-black">
              <input checked={finalNoticeConfirmed} onChange={(event) => setFinalNoticeConfirmed(event.target.checked)} type="checkbox" />
              안내 내용을 확인했습니다.
            </label>
            <ErrorText>{touched && !finalNoticeConfirmed ? '심사 안내 확인이 필요합니다.' : ''}</ErrorText>
          </Section>

          <div className="sticky bottom-4 z-10">
            <PrimaryButton disabled={!isRequiredComplete} onClick={submit}>
              프로필 제출
            </PrimaryButton>
            {!isRequiredComplete ? <p className="mt-2 text-center text-[12px] font-extrabold text-[#888]">필수 항목을 모두 입력하면 제출할 수 있습니다.</p> : null}
          </div>
        </form>
      </div>
    </main>
  );
}
