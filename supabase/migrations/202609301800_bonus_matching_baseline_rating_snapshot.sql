-- 추가대화 자동 매칭(호감도/최저점)이 사용하는 호감도의 기준 시점을
-- "정규 라운드가 모두 종료된 시점"으로 고정한다.
--
-- ============================================================
-- 배경 - submit_bonus_round_rating이 정규 라운드 행을 덮어쓰는 이유
-- ============================================================
-- round_ratings의 유일 제약은 (event_id, round_number, rater)다 - 즉
-- "이 사람이 이 라운드에서 매긴 평가 1건"이 기본 단위이고, "이 두 사람
-- 사이의 평가"라는 제약은 없다. 그래서 참가자가 추가대화에서 정규
-- 라운드 때 만난 적 있는 상대를 다시 만나 평가를 남기면, 그 상대에 대한
-- "내 최종 평가"가 두 행(정규 라운드 행 + 새 추가대화 행)으로 쪼개지지
-- 않도록, submit_bonus_round_rating이 의도적으로 기존 정규 라운드 행을
-- 찾아 그 자리에서 덮어쓴다(있으면 update, 없으면 insert) - "이 사람에
-- 대한 내 최종 평가는 항상 단일 최신 행"이라는 계약을 유지하기 위한
-- 설계였다. get_admin_participant_ratings/get_final_selection_candidates
-- 등 "최신 호감도"를 읽는 다른 화면들은 전부 이 계약(round_ratings를
-- 그대로 조회하면 항상 최신값)에 의존하고 있다.
--
-- 문제는 generate_bonus_round_assignments도 지금까지 이 "최신값"
-- round_ratings를 그대로 읽고 있었다는 것 - 그래서 추가대화 중 수정한
-- 점수가 다음 추가대화의 매칭(호감도 가중치 + 최저점 판단) 계산에도
-- 그대로 흘러들어갈 수 있었다.
--
-- ============================================================
-- 채택한 방식 (검토한 A/B/C 중 A - snapshot)
-- ============================================================
-- B(추가대화 수정값을 완전히 별도 테이블로 분리)는 submit_bonus_round_rating
-- 자체의 "최신값은 항상 round_ratings" 계약을 깨야 해서, 위에 나열된
-- 모든 다른 리더(관리자 호감도 조회, 최종선택 후보, 참가자 자기 평가
-- 조회 등)를 전부 같이 고쳐야 하는 훨씬 넓은 변경이 된다.
-- C(기존 구조에 이미 원본/수정 구분이 있는지) - 확인 결과 없다
-- (round_ratings는 단일 최신값만 유지하는 구조).
--
-- 따라서 A를 선택한다: round_ratings와 submit_bonus_round_rating은
-- 단 한 글자도 건드리지 않는다(=참가자의 최종 호감도, 관리자 조회,
-- 최종선택 후보 등 기존 동작 전부 무변경, 회귀 위험 0). 대신 "정규
-- 라운드가 모두 끝난 시점"에 round_ratings의 정규 라운드 구간을 그대로
-- 복사해 별도 스냅샷 테이블에 얼려두고, generate_bonus_round_assignments
-- 만 이 스냅샷을 보도록 바꾼다.
--
-- 스냅샷 시점 및 lifecycle (중요 - 최종 확정 정책):
--
-- "정규 라운드가 모두 종료된 시점"은 이벤트 생애주기에서 딱 한 번만
-- 존재하는 시점이다. bonus1을 최초로 생성하는 유일한 지점인
-- resume_after_regular_rounds_for_session(관리자가 "추가대화 시작"을
-- 누르는 순간, stage='round_complete'에서만 호출 가능함이 이미
-- 보장되어 있음)에서 캡처하되, **이 event_id에 대해 baseline이 이미
-- 존재하면 절대 다시 캡처(overwrite/delete)하지 않는다** - INSERT ...
-- WHERE NOT EXISTS 형태의 완전히 idempotent한 "최초 1회만" 쓰기다.
--
-- 이게 중요한 이유: 테스트 행사의 "추가대화 재시작"
-- (restart_bonus_phase_for_test_session)은 bonus assignment/progress만
-- 초기화하고 resume_after_regular_rounds_for_session을 다시 호출하게
-- 만드는데, 그 시점에 round_ratings는 이미 추가대화 중 수정된 "현재"
-- 값으로 바뀌어 있을 수 있다. 만약 재개할 때마다 다시 캡처한다면
-- "정규 라운드 종료 시점"이 아니라 "가장 최근 재시작 시점"의 오염된
-- 값이 baseline이 되어버려 이번 기능의 목적 자체가 깨진다. 따라서
-- resume_after_regular_rounds_for_session은 baseline이 이미 있으면
-- 완전히 건드리지 않고 넘어간다 - "추가대화 재시작"은 baseline
-- 테이블에 대해 delete/insert 문 자체가 없으므로(확인됨) 애초에
-- 건드릴 수 없다.
--
-- 반대로 "행사 전체 초기화"(restart_test_event_progress_for_session)는
-- round_ratings를 정규 라운드분까지 포함해 전부 삭제하고 체크인 이전
-- 상태로 되돌리는, 정규 라운드 자체를 처음부터 다시 진행하는 완전히
-- 다른 종류의 reset이다. 이 경우 기존 baseline은 이제 존재하지 않는
-- 정규 라운드 평가를 가리키는 죽은 데이터이므로, 이때는 baseline도
-- 같이 삭제해 다음 번 "정규 라운드가 새로 종료되는 시점"에 새
-- baseline이 자연스럽게 캡처되게 한다.
--
-- 기존 데이터 호환성: 이 migration 배포 이전에 이미 bonus1이 생성된(즉
-- resume_after_regular_rounds_for_session이 스냅샷 로직 없이 이미
-- 실행된) 진행 중인 행사는 스냅샷이 없다. 이런 경우
-- generate_bonus_round_assignments는 스냅샷이 "이 이벤트에 대해
-- 아예 존재하지 않으면" round_ratings를 직접 읽는 기존 동작으로
-- 자동 폴백한다 - 스냅샷이 없다는 이유로 호감도 가중치가 조용히
-- 0으로 사라지는 회귀를 방지한다.

create table if not exists public.bonus_matching_baseline_ratings (
  event_id text not null references public.events(id) on delete cascade,
  rater_application_id uuid not null,
  ratee_application_id uuid not null,
  round_number integer not null,
  score numeric not null,
  created_at timestamptz not null default now(),
  primary key (event_id, rater_application_id, round_number)
);

comment on table public.bonus_matching_baseline_ratings is
  '정규 라운드가 모두 종료된 시점의 round_ratings 스냅샷 - 추가대화 자동 매칭(generate_bonus_round_assignments)의 호감도/최저점 계산 전용 기준선. 추가대화 중 평가를 수정해도 이 테이블은 절대 바뀌지 않는다. round_ratings 자체(참가자 최종 평가, 관리자 조회, 최종선택 후보 등)는 이 테이블과 무관하게 기존과 동일하게 계속 최신값을 유지한다.';

revoke all on table public.bonus_matching_baseline_ratings from public, anon, authenticated;

create or replace function public.resume_after_regular_rounds_for_session(session_token text, event_id_value text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  target public.event_progress%rowtype;
  target_event public.events%rowtype;
  plan record;
  total_rounds integer;
  first_bonus_round integer;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if exists (select 1 from public.events where id = event_id_value and deleted_at is not null) then
    raise exception '삭제된 행사입니다.';
  end if;

  select * into target from public.event_progress where event_id = event_id_value for update;
  if not found or target.stage <> 'round_complete' then
    raise exception '지금은 재개할 수 있는 상태가 아닙니다.';
  end if;

  select * into target_event from public.events where id = event_id_value;
  if coalesce(target_event.bonus_round_count, 0) <= 0 then
    raise exception '추가시간이 설정되지 않은 행사입니다.';
  end if;

  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  first_bonus_round := total_rounds + 1;

  -- 추가대화 자동 매칭이 쓸 "정규 라운드 종료 시점" 호감도 기준선을
  -- 캡처한다 - 단, 이 event_id에 대해 이미 baseline이 있으면(추가대화
  -- 재시작 후 재개하는 경우) 절대 다시 캡처하지 않는다. "정규 라운드가
  -- 최초로 종료된 시점"의 값만 영구히 고정하기 위함 - 그 이후 재개될
  -- 때마다 round_ratings의 "현재" 값으로 덮어쓰면 추가대화 중 수정한
  -- 값이 기준선을 오염시켜 이번 기능의 목적이 깨진다.
  if not exists (
    select 1 from public.bonus_matching_baseline_ratings where event_id = event_id_value
  ) then
    insert into public.bonus_matching_baseline_ratings (event_id, rater_application_id, ratee_application_id, round_number, score)
    select event_id, rater_application_id, ratee_application_id, round_number, score
    from public.round_ratings
    where event_id = event_id_value and round_number <= total_rounds;
  end if;

  begin
    perform public.generate_bonus_round_assignments(event_id_value, first_bonus_round);
  exception when others then
    raise log '[BONUS_MATCH] generate_bonus_round_assignments raised unexpectedly on resume - event=% round=% error=%',
      event_id_value, first_bonus_round, sqlerrm;
  end;

  if not exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = first_bonus_round
  ) then
    raise log '[BONUS_MATCH] 추가시간 매칭 생성 실패 - 최종선택 단계로 전환됨 (event=% failedRound=%)',
      event_id_value, first_bonus_round;
  end if;

  update public.event_progress ep
  set stage = 'bonus_seat_guide',
      current_round = total_rounds,
      is_bonus_round = true,
      round_phase = 'reveal',
      round_timer_status = 'running',
      round_timer_position_seconds = 0,
      round_timer_updated_at = now(),
      round_phase_started_at = now(),
      updated_at = now()
  where ep.event_id = event_id_value;
end;
$function$;

-- ============================================================
-- generate_bonus_round_assignments: 호감도/최저점 source만
-- round_ratings -> "스냅샷이 있으면 스냅샷, 없으면(기존 진행 중이던
-- 행사 호환) round_ratings 그대로"로 교체한다. 그 외 matching
-- 알고리즘(하드제약, safety, 최저점 penalty 스케일, 휴식자 우선,
-- deterministic tie-break 등)은 전혀 변경하지 않는다.
-- ============================================================
create or replace function public.generate_bonus_round_assignments(event_id_value text, target_round_number integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  plan record;
  total_rounds integer;
  bonus_round_index integer;
  is_test boolean;
  male_ids uuid[];
  female_ids uuid[];
  male_count integer;
  female_count integer;
  expected_matches integer;
  majority_gender text;
  rested_last_round_ids uuid[];
  final_males uuid[];
  final_females uuid[];
  final_matched integer;
  used_tier text := 'primary';
  pair_index integer;
  table_number_value integer;
  male_index_value integer;
  safety_match_female integer[];
  penalty_scale constant numeric := 10000;
  rest_scale constant numeric := 1000;
  old_bonus_scale constant numeric := 1000000;
begin
  perform pg_catalog.pg_advisory_xact_lock(hashtext(event_id_value), target_round_number);

  if exists (
    select 1 from public.event_table_assignments
    where event_id = event_id_value and round_number = target_round_number
  ) then
    return;
  end if;

  select coalesce(e.is_test_event, false) into is_test
  from public.events e where e.id = event_id_value;
  select * into plan from public.compute_event_round_plan(event_id_value);
  total_rounds := coalesce(
    (select max(round_number) from public.event_table_assignments where event_id = event_id_value and not is_bonus),
    plan.total_rounds
  );
  bonus_round_index := target_round_number - total_rounds;

  select array_agg(a.id order by a.id) into male_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '남성';
  select array_agg(a.id order by a.id) into female_ids
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정'
    and a.checked_in_at is not null and a.attendance_status = 'active' and a.gender = '여성';

  male_count := coalesce(array_length(male_ids, 1), 0);
  female_count := coalesce(array_length(female_ids, 1), 0);
  expected_matches := least(male_count, female_count);

  if expected_matches = 0 or male_count > 60 or female_count > 60 then
    return;
  end if;

  majority_gender := case
    when male_count > female_count then '남성'
    when female_count > male_count then '여성'
    else null
  end;

  rested_last_round_ids := '{}'::uuid[];
  if majority_gender is not null then
    select coalesce(array_agg(a.id), '{}'::uuid[]) into rested_last_round_ids
    from public.applications a
    where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null
      and a.attendance_status = 'active' and a.gender = majority_gender
      and a.id <> all (
        select unnest(array[male_application_id, female_application_id])
        from public.event_table_assignments
        where event_id = event_id_value and is_bonus and round_number = target_round_number - 1
      );
  end if;

  begin
    -- 호감도/최저점 source: "정규 라운드 종료 시점" 스냅샷이 이 행사에
    -- 존재하면 그것만 쓰고, 존재하지 않으면(이 migration 배포 이전에
    -- 이미 bonus1이 생성된 진행 중인 행사 - 호환성 폴백) round_ratings의
    -- 정규 라운드 구간을 그대로 쓴다. 이 시점 이후로는 추가대화 중
    -- 수정이 반영되지 않는다는 정책이 두 경우 모두 동일하게 지켜진다
    -- (스냅샷 경로는 애초에 얼려둔 값이라 당연히 무관하고, 폴백 경로도
    -- round_ratings의 "정규 라운드 번호" 구간만 보므로 - 다만 폴백
    -- 경로는 submit_bonus_round_rating이 정규 라운드 행을 그 자리에서
    -- 덮어쓸 수 있다는 기존 제약이 여전히 남아있다 - 폴백은 오직 이번
    -- 배포 "이전에 이미 bonus1이 생성된" 극히 일시적인 경우에만
    -- 발동한다).
    drop table if exists tmp_bonus_rating_source;
    create temporary table tmp_bonus_rating_source on commit drop as
    select rater_application_id, ratee_application_id, round_number, score
    from public.bonus_matching_baseline_ratings
    where event_id = event_id_value
    union all
    select rater_application_id, ratee_application_id, round_number, score
    from public.round_ratings
    where event_id = event_id_value and round_number <= total_rounds
      and not exists (
        select 1 from public.bonus_matching_baseline_ratings where event_id = event_id_value
      );

    drop table if exists tmp_bonus_lowest;
    create temporary table tmp_bonus_lowest on commit drop as
    select distinct on (rr.rater_application_id)
      rr.rater_application_id, rr.ratee_application_id
    from tmp_bonus_rating_source rr
    order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

    drop table if exists tmp_bonus_edges;
    create temporary table tmp_bonus_edges on commit drop as
    select
      ma.id as male_application_id,
      fa.id as female_application_id,
      array_position(male_ids, ma.id) as male_index,
      array_position(female_ids, fa.id) as female_index,
      (
        - penalty_scale * (
            coalesce((select lm.ratee_application_id = fa.id from tmp_bonus_lowest lm where lm.rater_application_id = ma.id), false)::int
            + coalesce((select lf.ratee_application_id = ma.id from tmp_bonus_lowest lf where lf.rater_application_id = fa.id), false)::int
          )
        + rest_scale * (case when ma.id = any(rested_last_round_ids) or fa.id = any(rested_last_round_ids) then 1 else 0 end)
        + coalesce(mf.score, 0) + coalesce(fm.score, 0)
      ) as weight
    from public.applications ma
    cross join public.applications fa
    left join lateral (
      select rr.score from tmp_bonus_rating_source rr
      where rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
      order by rr.round_number desc limit 1
    ) mf on true
    left join lateral (
      select rr.score from tmp_bonus_rating_source rr
      where rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
      order by rr.round_number desc limit 1
    ) fm on true
    where ma.id = any(male_ids) and fa.id = any(female_ids)
      and not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.male_application_id = ma.id
          and prev.female_application_id = fa.id
      )
      and not exists (
        select 1 from public.event_table_assignments prevbonus
        where prevbonus.event_id = event_id_value
          and prevbonus.is_bonus
          and prevbonus.round_number < target_round_number
          and prevbonus.male_application_id = ma.id
          and prevbonus.female_application_id = fa.id
      );

    select * into final_males, final_females, final_matched
      from public._bonus_weighted_dp(male_ids, female_ids, male_count, female_count);
  exception when others then
    raise log '[BONUS_MATCH] primary weighted matching raised unexpectedly - event=% round=% error=%',
      event_id_value, target_round_number, sqlerrm;
    final_matched := 0;
    final_males := '{}'::uuid[];
    final_females := '{}'::uuid[];
  end;

  if final_matched < expected_matches then
    used_tier := 'safety_soft_old_bonus';
    begin
      drop table if exists tmp_bonus_rating_source;
      create temporary table tmp_bonus_rating_source on commit drop as
      select rater_application_id, ratee_application_id, round_number, score
      from public.bonus_matching_baseline_ratings
      where event_id = event_id_value
      union all
      select rater_application_id, ratee_application_id, round_number, score
      from public.round_ratings
      where event_id = event_id_value and round_number <= total_rounds
        and not exists (
          select 1 from public.bonus_matching_baseline_ratings where event_id = event_id_value
        );

      drop table if exists tmp_bonus_lowest;
      create temporary table tmp_bonus_lowest on commit drop as
      select distinct on (rr.rater_application_id)
        rr.rater_application_id, rr.ratee_application_id
      from tmp_bonus_rating_source rr
      order by rr.rater_application_id, rr.score asc, rr.round_number asc, rr.ratee_application_id asc;

      drop table if exists tmp_bonus_edges;
      create temporary table tmp_bonus_edges on commit drop as
      select
        ma.id as male_application_id,
        fa.id as female_application_id,
        array_position(male_ids, ma.id) as male_index,
        array_position(female_ids, fa.id) as female_index,
        (
          - old_bonus_scale * (
              case when exists (
                select 1 from public.event_table_assignments prevbonus
                where prevbonus.event_id = event_id_value
                  and prevbonus.is_bonus
                  and prevbonus.round_number < target_round_number
                  and prevbonus.male_application_id = ma.id
                  and prevbonus.female_application_id = fa.id
              ) then 1 else 0 end
            )
          - penalty_scale * (
              coalesce((select lm.ratee_application_id = fa.id from tmp_bonus_lowest lm where lm.rater_application_id = ma.id), false)::int
              + coalesce((select lf.ratee_application_id = ma.id from tmp_bonus_lowest lf where lf.rater_application_id = fa.id), false)::int
            )
          + rest_scale * (case when ma.id = any(rested_last_round_ids) or fa.id = any(rested_last_round_ids) then 1 else 0 end)
          + coalesce(mf.score, 0) + coalesce(fm.score, 0)
        ) as weight
      from public.applications ma
      cross join public.applications fa
      left join lateral (
        select rr.score from tmp_bonus_rating_source rr
        where rr.rater_application_id = ma.id and rr.ratee_application_id = fa.id
        order by rr.round_number desc limit 1
      ) mf on true
      left join lateral (
        select rr.score from tmp_bonus_rating_source rr
        where rr.rater_application_id = fa.id and rr.ratee_application_id = ma.id
        order by rr.round_number desc limit 1
      ) fm on true
      where ma.id = any(male_ids) and fa.id = any(female_ids)
        and not exists (
          select 1 from public.event_table_assignments prev
          where prev.event_id = event_id_value
            and prev.round_number = target_round_number - 1
            and prev.male_application_id = ma.id
            and prev.female_application_id = fa.id
        );

      select * into final_males, final_females, final_matched
        from public._bonus_weighted_dp(male_ids, female_ids, male_count, female_count);

      raise log '[BONUS_MATCH] safety_soft_old_bonus matching used - event=% round=% matched=%/%',
        event_id_value, target_round_number, final_matched, expected_matches;
    exception when others then
      raise log '[BONUS_MATCH] safety_soft_old_bonus matching raised unexpectedly - event=% round=% error=%',
        event_id_value, target_round_number, sqlerrm;
      final_matched := 0;
      final_males := '{}'::uuid[];
      final_females := '{}'::uuid[];
    end;
  end if;

  if final_matched < expected_matches then
    used_tier := 'emergency_safety_net';
    begin
      drop table if exists tmp_bonus_safety_edges;
      create temporary table tmp_bonus_safety_edges on commit drop as
      select
        array_position(male_ids, ma) as male_index,
        array_position(female_ids, fa) as female_index
      from unnest(male_ids) as ma
      cross join unnest(female_ids) as fa
      where not exists (
        select 1 from public.event_table_assignments prev
        where prev.event_id = event_id_value
          and prev.round_number = target_round_number - 1
          and prev.male_application_id = ma
          and prev.female_application_id = fa
      );

      safety_match_female := public._bonus_safety_matching(male_count, female_count);

      select array_agg(male_ids[safety_match_female[fi]] order by fi), array_agg(female_ids[fi] order by fi), count(*)
        into final_males, final_females, final_matched
      from generate_series(1, female_count) as fi
      where safety_match_female[fi] is not null;

      final_matched := coalesce(final_matched, 0);
      final_males := coalesce(final_males, '{}'::uuid[]);
      final_females := coalesce(final_females, '{}'::uuid[]);

      raise log '[BONUS_MATCH] emergency safety matching used - event=% round=% matched=%/%',
        event_id_value, target_round_number, final_matched, expected_matches;
    exception when others then
      raise log '[BONUS_MATCH] emergency safety matching also raised unexpectedly - event=% round=% error=%',
        event_id_value, target_round_number, sqlerrm;
      final_matched := coalesce(array_length(final_males, 1), 0);
    end;
  end if;

  if is_test then
    raise notice '[BONUS_MATCH] eventId=% bonusRound=% method=% matched=%/%',
      event_id_value, bonus_round_index, used_tier, final_matched, expected_matches;
  end if;

  if final_matched < expected_matches then
    raise log '[BONUS_MATCH] partial matching accepted (rest applied) - event=% round=% matched=%/%',
      event_id_value, target_round_number, final_matched, expected_matches;
  end if;

  for pair_index in 1..final_matched loop
    select eta.table_number into table_number_value
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and not eta.is_bonus
      and eta.female_application_id = final_females[pair_index]
    order by eta.round_number desc
    limit 1;

    insert into public.event_table_assignments (
      event_id, table_number, round_number, male_application_id, female_application_id, is_bonus
    ) values (
      event_id_value, coalesce(table_number_value, pair_index), target_round_number,
      final_males[pair_index], final_females[pair_index], true
    );

    if is_test then
      raise notice '[BONUS_MATCH] eventId=% bonusRound=% maleApplicationId=% femaleApplicationId=%',
        event_id_value, bonus_round_index, final_males[pair_index], final_females[pair_index];
    end if;
  end loop;
end;
$function$;

revoke all on function public.generate_bonus_round_assignments(text, integer) from public, anon, authenticated;

-- ============================================================
-- restart_test_event_progress_for_session ("행사 전체 초기화", 정규
-- 라운드/체크인부터 전부 다시 시작하는 테스트 전용 reset): 이 reset은
-- round_ratings를 정규 라운드분까지 포함해 전부 지우므로, 기존 baseline
-- 스냅샷은 더 이상 존재하지 않는 평가를 가리키는 죽은 데이터가 된다.
-- 이 reset에서만 baseline도 함께 지워, 다음 번 정규 라운드가 새로
-- 종료될 때 resume_after_regular_rounds_for_session이 새 baseline을
-- 자연스럽게 캡처하게 한다. "추가대화 재시작"(restart_bonus_phase_for_test_session)은
-- 이 함수와 다른 함수이며 여기서 전혀 수정하지 않는다 - 그 함수는
-- 원래부터 round_ratings를 정규 라운드분은 건드리지 않고(주석 확인됨)
-- baseline 테이블도 참조하지 않는다.
-- ============================================================
create or replace function public.restart_test_event_progress_for_session(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  orphaned_paths text[];
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  -- 하드 안전장치: 프론트에서 버튼을 숨기는 것과 무관하게, 실제 행사
  -- event_id를 넣어 직접 호출해도 절대 실행되지 않는다.
  if not exists (select 1 from public.events e where e.id = event_id_value and e.is_test_event = true) then
    raise exception '테스트 행사만 초기화할 수 있습니다.';
  end if;

  select coalesce(array_agg(photo_path), '{}') into orphaned_paths
  from public.event_profile_cards where event_id = event_id_value and photo_path is not null;

  delete from public.event_table_assignments where event_id = event_id_value;
  delete from public.round_ratings where event_id = event_id_value;
  delete from public.bonus_matching_baseline_ratings where event_id = event_id_value;
  delete from public.final_selections where event_id = event_id_value;
  delete from public.final_selection_submissions where event_id = event_id_value;
  delete from public.event_pause_requests where event_id = event_id_value;
  delete from public.participant_reports where event_id = event_id_value;
  delete from public.event_preround_seats where event_id = event_id_value;
  delete from public.event_profile_cards where event_id = event_id_value;

  -- 체크인도 초기화 대상에 포함한다 - applications와 application_tickets
  -- 양쪽 다 checked_in_at을 갖고 있어(finalize_application_check_in이 둘 다
  -- 채움) 같이 지워야 한다.
  update public.application_tickets
  set checked_in_at = null, checked_in_by = null, updated_at = now()
  where application_id in (select id from public.applications where event_id = event_id_value);

  update public.applications
  set final_selection_submitted_at = null,
      checked_in_at = null,
      checked_in_by = null
  where event_id = event_id_value;

  update public.events set started_at = null, ended_at = null where id = event_id_value;

  update public.event_progress
  set stage = 'seat_guide', intro_video_status = 'paused', intro_video_position_seconds = 0,
      intro_video_updated_at = now(), intro_video_completed_at = null, current_round = null,
      round_phase = null, round_timer_status = 'paused', round_timer_position_seconds = 0,
      round_timer_updated_at = null, is_bonus_round = false, round_phase_started_at = null,
      updated_at = now()
  where event_id = event_id_value;

  return jsonb_build_object('ok', true, 'orphanedPhotoPaths', to_jsonb(orphaned_paths));
end;
$function$;
