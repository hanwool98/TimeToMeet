-- Conversation-topic deck for the tablet round-timer screen. Topics are
-- global (not per-event) content managed by admins, drawn at random by
-- tablets during the conversation phase of a round.
create table if not exists public.conversation_topics (
  id uuid primary key default gen_random_uuid(),
  content text not null,
  category text not null default '일반 대화주제',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversation_topics enable row level security;

create policy "Admins can manage conversation topics" on public.conversation_topics
  for all using (public.is_admin()) with check (public.is_admin());

-- Admin: full list (including inactive), for the management screen.
create or replace function public.get_admin_conversation_topics(session_token text)
returns table (id uuid, content text, category text, is_active boolean, sort_order integer, created_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  return query
  select ct.id, ct.content, ct.category, ct.is_active, ct.sort_order, ct.created_at, ct.updated_at
  from public.conversation_topics ct
  order by ct.sort_order asc, ct.created_at asc;
end;
$$;

grant execute on function public.get_admin_conversation_topics(text) to anon, authenticated;

create or replace function public.create_conversation_topic_for_session(session_token text, content_value text, category_value text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  new_id uuid;
  next_sort_order integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if trim(coalesce(content_value, '')) = '' then
    raise exception '질문 내용을 입력해주세요.';
  end if;

  select coalesce(max(ct.sort_order), 0) + 1 into next_sort_order from public.conversation_topics ct;

  insert into public.conversation_topics (content, category, sort_order)
  values (trim(content_value), coalesce(nullif(trim(category_value), ''), '일반 대화주제'), next_sort_order)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.create_conversation_topic_for_session(text, text, text) to anon, authenticated;

create or replace function public.update_conversation_topic_for_session(session_token text, topic_id uuid, content_value text, category_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if trim(coalesce(content_value, '')) = '' then
    raise exception '질문 내용을 입력해주세요.';
  end if;

  update public.conversation_topics ct
  set content = trim(content_value),
      category = coalesce(nullif(trim(category_value), ''), ct.category),
      updated_at = now()
  where ct.id = topic_id;
end;
$$;

grant execute on function public.update_conversation_topic_for_session(text, uuid, text, text) to anon, authenticated;

create or replace function public.set_conversation_topic_active_for_session(session_token text, topic_id uuid, is_active_value boolean)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  update public.conversation_topics ct
  set is_active = is_active_value, updated_at = now()
  where ct.id = topic_id;
end;
$$;

grant execute on function public.set_conversation_topic_active_for_session(text, uuid, boolean) to anon, authenticated;

create or replace function public.delete_conversation_topic_for_session(session_token text, topic_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  delete from public.conversation_topics ct where ct.id = topic_id;
end;
$$;

grant execute on function public.delete_conversation_topic_for_session(text, uuid) to anon, authenticated;

-- Tablet: fetch the active topic list once per table connection. The
-- tablet does the random pick locally (see ConversationTopicDeck) rather
-- than round-tripping per card draw, so this mirrors the same
-- event_tablets connection-token gate used by get_round_progress_for_tablet
-- but is polled far less often.
create or replace function public.get_conversation_topics_for_tablet(
  event_id_value text,
  table_number_value integer,
  connection_token text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  tablet public.event_tablets%rowtype;
  topics jsonb;
begin
  select et.* into tablet
  from public.event_tablets et
  where et.event_id = event_id_value
    and et.table_number = table_number_value
    and et.connection_status = 'online'
    and et.connection_token_hash = encode(extensions.digest(connection_token, 'sha256'), 'hex');

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', ct.id, 'content', ct.content) order by ct.sort_order asc), '[]'::jsonb)
  into topics
  from public.conversation_topics ct
  where ct.is_active = true;

  return jsonb_build_object('ok', true, 'topics', topics);
end;
$$;

grant execute on function public.get_conversation_topics_for_tablet(text, integer, text) to anon, authenticated;

-- Seed the initial 100 topics (leading "N. " numbering from the source
-- document stripped - the number was never part of the question content).
insert into public.conversation_topics (content, category, sort_order) values
('매일 연락하지만 일주일에 한 번 만나기 vs 연락은 뜸하지만 일주일에 세 번 만나기', '밸런스게임', 1),
('얼굴이 완전 내 스타일 vs 성격이 완전 내 스타일', '밸런스게임', 2),
('친구 같은 연애 vs 설레는 연애', '밸런스게임', 3),
('먼저 고백하기 vs 고백받기', '밸런스게임', 4),
('계획적인 데이트 vs 즉흥적인 데이트', '밸런스게임', 5),
('집데이트 vs 밖에서 하루 종일 데이트', '밸런스게임', 6),
('맛집 데이트 vs 분위기 좋은 카페 데이트', '밸런스게임', 7),
('바다 여행 vs 산 여행', '밸런스게임', 8),
('놀이공원 데이트 vs 한강 데이트', '밸런스게임', 9),
('영화관 데이트 vs 집에서 넷플릭스', '밸런스게임', 10),
('밤에 만나기 vs 낮에 만나기', '밸런스게임', 11),
('드라이브 데이트 vs 산책 데이트', '밸런스게임', 12),
('사진 많이 찍는 연인 vs 사진 거의 안 찍는 연인', '밸런스게임', 13),
('커플템 많이 하기 vs 커플템 전혀 안 하기', '밸런스게임', 14),
('애칭 쓰기 vs 이름 부르기', '밸런스게임', 15),
('전화 오래 하기 vs 카톡 오래 하기', '밸런스게임', 16),
('아침마다 연락 vs 자기 전에 연락', '밸런스게임', 17),
('답장 빠르지만 짧게 vs 느리지만 길게', '밸런스게임', 18),
('질투 조금 하는 사람 vs 질투 전혀 안 하는 사람', '밸런스게임', 19),
('표현 많이 하는 사람 vs 행동으로 보여주는 사람', '밸런스게임', 20),
('귀여운 사람 vs 섹시한 사람', '밸런스게임', 21),
('웃긴 사람 vs 다정한 사람', '밸런스게임', 22),
('말 많은 사람 vs 잘 들어주는 사람', '밸런스게임', 23),
('나보다 활발한 사람 vs 나보다 차분한 사람', '밸런스게임', 24),
('나랑 취향 비슷한 사람 vs 취향 완전 다른 사람', '밸런스게임', 25),
('술 잘 마시는 사람 vs 술 거의 안 마시는 사람', '밸런스게임', 26),
('운동 좋아하는 사람 vs 맛집 좋아하는 사람', '밸런스게임', 27),
('패션 센스 좋은 사람 vs 유머 감각 좋은 사람', '밸런스게임', 28),
('키 큰 사람 vs 비율 좋은 사람', '밸런스게임', 29),
('목소리 좋은 사람 vs 웃는 모습 예쁜 사람', '밸런스게임', 30),
('첫눈에 확 끌리는 사람 vs 볼수록 좋아지는 사람', '밸런스게임', 31),
('썸 오래 타기 vs 빠르게 사귀기', '밸런스게임', 32),
('친구에서 연인 되기 vs 처음부터 이성으로 만나기', '밸런스게임', 33),
('공개연애 vs 조용히 연애', '밸런스게임', 34),
('SNS에 연애 티 내기 vs 전혀 안 내기', '밸런스게임', 35),
('상대 친구들과 자주 어울리기 vs 둘이서만 많이 만나기', '밸런스게임', 36),
('생일 크게 챙기기 vs 평소에 소소하게 챙기기', '밸런스게임', 37),
('비싼 선물 하나 vs 작은 선물 여러 번', '밸런스게임', 38),
('깜짝 이벤트 vs 미리 물어보고 원하는 것 해주기', '밸런스게임', 39),
('여행 가서 관광 많이 하기 vs 숙소에서 푹 쉬기', '밸런스게임', 40),
('국내여행 자주 가기 vs 해외여행 가끔 크게 가기', '밸런스게임', 41),
('연인과 취미 같이 하기 vs 각자 취미 존중하기', '밸런스게임', 42),
('싸우면 바로 풀기 vs 시간 좀 갖고 이야기하기', '밸런스게임', 43),
('솔직해서 가끔 상처 주는 사람 vs 배려해서 돌려 말하는 사람', '밸런스게임', 44),
('연인이 이성친구 많은 것 vs 전 애인과 연락하는 것', '밸런스게임', 45),
('사랑한다는 말 자주 하기 vs 중요한 순간에만 하기', '밸런스게임', 46),
('연애 초반 매일 만나기 vs 조금씩 천천히 만나기', '밸런스게임', 47),
('결혼 생각하고 연애하기 vs 일단 현재가 행복하면 됨', '밸런스게임', 48),
('안정적인 사랑 vs 미친 듯이 설레는 사랑', '밸런스게임', 49),
('내가 더 좋아하는 연애 vs 상대가 나를 더 좋아하는 연애', '밸런스게임', 50),
('요즘 제일 자주 듣는 노래는?', '일반 대화주제', 51),
('하루 중 가장 좋아하는 시간대는?', '일반 대화주제', 52),
('쉬는 날 갑자기 하루가 비면 뭐 하고 싶어?', '일반 대화주제', 53),
('최근에 제일 재밌게 본 영화나 드라마는?', '일반 대화주제', 54),
('평생 한 가지 음식만 먹어야 한다면?', '일반 대화주제', 55),
('술 마실 때 가장 좋아하는 안주는?', '일반 대화주제', 56),
('해장할 때 무조건 먹는 음식은?', '일반 대화주제', 57),
('커피파야, 술파야?', '일반 대화주제', 58),
('여행 가면 계획 세우는 편이야?', '일반 대화주제', 59),
('지금 당장 비행기표 주면 어디 가고 싶어?', '일반 대화주제', 60),
('살면서 한 번쯤 꼭 가보고 싶은 나라는?', '일반 대화주제', 61),
('바다 보면 들어가고 싶어지는 편이야, 그냥 보고 싶은 편이야?', '일반 대화주제', 62),
('놀이공원 가면 무서운 놀이기구 잘 타?', '일반 대화주제', 63),
('노래방 가면 첫 곡으로 뭐 불러?', '일반 대화주제', 64),
('집에서 혼자 있을 때 제일 많이 하는 건 뭐야?', '일반 대화주제', 65),
('요즘 은근히 빠져 있는 게 있어?', '일반 대화주제', 66),
('사람들이 잘 모르는 취미 있어?', '일반 대화주제', 67),
('어릴 때 꿈이 뭐였어?', '일반 대화주제', 68),
('지금 하는 일 말고 한 번 해보고 싶은 직업 있어?', '일반 대화주제', 69),
('돈 걱정 없으면 어떤 삶 살고 싶어?', '일반 대화주제', 70),
('무조건 아침형 인간 vs 무조건 야행성이라면 어느 쪽이야?', '일반 대화주제', 71),
('스트레스 받을 때 혼자 있는 편이야, 사람 만나는 편이야?', '일반 대화주제', 72),
('기분 안 좋을 때 뭐 해주면 제일 좋아?', '일반 대화주제', 73),
('힘들 때 위로받고 싶어, 해결책을 듣고 싶어?', '일반 대화주제', 74),
('친해지는 데 시간이 오래 걸리는 편이야?', '일반 대화주제', 75),
('첫인상이랑 친해진 뒤 이미지가 많이 달라지는 편이야?', '일반 대화주제', 76),
('본인 성격에서 제일 마음에 드는 부분은?', '일반 대화주제', 77),
('반대로 고치고 싶은 성격 하나는?', '일반 대화주제', 78),
('주변 친구들이 널 한 단어로 표현하면 뭐라고 할 것 같아?', '일반 대화주제', 79),
('사람 볼 때 은근 중요하게 보는 부분이 있어?', '일반 대화주제', 80),
('사람에게 정 떨어지는 순간은 언제야?', '일반 대화주제', 81),
('반대로 갑자기 호감 생기는 행동은?', '일반 대화주제', 82),
('이성이 하면 설레는 행동 하나만 고르면?', '일반 대화주제', 83),
('외모에서 은근히 보는 포인트가 있어?', '일반 대화주제', 84),
('목소리, 향, 손, 웃는 모습 중에 제일 중요한 건?', '일반 대화주제', 85),
('연락할 때 답장 속도 신경 쓰는 편이야?', '일반 대화주제', 86),
('썸 탈 때 먼저 연락 잘하는 편이야?', '일반 대화주제', 87),
('좋아하는 사람 생기면 티가 나는 편이야?', '일반 대화주제', 88),
('누가 너 좋아하는 것 같으면 바로 알아채는 편이야?', '일반 대화주제', 89),
('연애할 때 표현 많이 하는 편이야?', '일반 대화주제', 90),
('연애하면서 꼭 같이 해보고 싶은 게 있어?', '일반 대화주제', 91),
('연인이랑 여행 간다면 첫 여행지는 어디가 좋을 것 같아?', '일반 대화주제', 92),
('이상적인 데이트 하루를 짜본다면?', '일반 대화주제', 93),
('연애할 때 가장 중요하다고 생각하는 건 뭐야?', '일반 대화주제', 94),
('싸울 때 절대 하면 안 된다고 생각하는 행동은?', '일반 대화주제', 95),
('사랑받고 있다고 가장 느끼는 순간은 언제야?', '일반 대화주제', 96),
('오래 만나는 커플들의 공통점은 뭐라고 생각해?', '일반 대화주제', 97),
('어떤 사람을 만나면 결혼하고 싶다는 생각이 들 것 같아?', '일반 대화주제', 98),
('지금까지 누군가에게 들었던 말 중 가장 설렜던 말은?', '일반 대화주제', 99),
('지금 여기 있는 사람 중 한 명이랑 데이트해야 한다면 어떤 데이트 하고 싶어?', '일반 대화주제', 100)
on conflict do nothing;
