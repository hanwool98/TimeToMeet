-- 관리자 참여이력 조회. 별도 이력 테이블을 만들지 않고 applications와
-- 행사 당시 고정 데이터(event_participant_snapshots/event_profile_cards)를
-- 조회한다. 전화번호는 검색에만 사용하며 행사 snapshot에는 복제하지 않는다.

create index if not exists applications_phone_digits_idx
on public.applications ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')));

create index if not exists participant_profiles_phone_digits_idx
on public.participant_profiles ((regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')));

create or replace function public.get_admin_participation_history_for_session(
  session_token text,
  phone_value text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $$
declare
  normalized_phone text := regexp_replace(coalesce(phone_value, ''), '[^0-9]', '', 'g');
  result_value jsonb;
begin
  if not public.is_admin_session(session_token) then
    raise exception 'Admin session required.';
  end if;

  if normalized_phone !~ '^01[0-9]{8,9}$' then
    raise exception '올바른 휴대폰 번호를 입력해주세요.';
  end if;

  with matched_users as (
    select a.user_id
    from public.applications a
    where regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') = normalized_phone
    union
    select p.user_id
    from public.participant_profiles p
    where regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g') = normalized_phone
    union
    select g.user_id
    from public.guest_accounts g
    where regexp_replace(coalesce(g.phone_normalized, ''), '[^0-9]', '', 'g') = normalized_phone
  ), candidate_applications as (
    select
      a.*,
      row_number() over (
        partition by a.event_id
        order by
          (a.checked_in_at is not null) desc,
          (a.status::text = '참가 확정') desc,
          a.submitted_at desc,
          a.id desc
      ) as event_rank
    from public.applications a
    where regexp_replace(coalesce(a.phone, ''), '[^0-9]', '', 'g') = normalized_phone
       or a.user_id in (select user_id from matched_users)
  ), history_rows as (
    select
      a.id as application_id,
      a.application_no,
      a.event_id,
      e.title as event_title,
      e.event_date,
      e.start_time,
      e.end_time,
      e.location,
      a.status::text as application_status,
      case
        when a.attendance_status = 'no_show' then '노쇼'
        when a.checked_in_at is not null and a.attendance_status = 'left_early' then '중도 이탈'
        when a.checked_in_at is not null and coalesce(a.is_marked_late, false) then '지각'
        when a.checked_in_at is not null and e.ended_at is not null then '참여 완료'
        when a.checked_in_at is not null then '참여 확인'
        when a.status::text = '신청 취소' then '신청 취소'
        when a.status::text = '자동 취소' then '자동 취소'
        when a.status::text = '환불 완료' then '환불 완료'
        when a.status::text = '반려' then '참가 거부'
        when a.status::text = '참여 보류' then '참가 대기'
        else a.status::text
      end as history_status,
      coalesce(nullif(eps.nickname, ''), nullif(a.nickname, ''), nullif(cp.nickname, ''), '미입력') as nickname,
      coalesce(nullif(eps.job, ''), nullif(a.job, ''), nullif(cp.job, ''), '미입력') as job,
      coalesce(
        eps.age,
        case when a.birth_date is not null then extract(year from age(e.event_date::timestamp, a.birth_date::timestamp))::integer end,
        case when cp.birth_date is not null then extract(year from age(e.event_date::timestamp, cp.birth_date::timestamp))::integer end
      ) as age,
      coalesce(
        eps.photo_path,
        epc.photo_path,
        a.profile_photo_paths[coalesce(a.representative_photo_index, 0) + 1],
        cp.profile_photo_paths[coalesce(cp.representative_photo_index, 0) + 1]
      ) as representative_photo_path,
      coalesce(eps.photo_crop, epc.photo_crop, a.representative_crop, cp.representative_crop) as representative_crop,
      case
        when eps.photo_path is not null then 'event_participant_snapshot'
        when epc.photo_path is not null then 'event_profile_card'
        when a.profile_photo_paths[coalesce(a.representative_photo_index, 0) + 1] is not null then 'application_snapshot'
        when cp.profile_photo_paths[coalesce(cp.representative_photo_index, 0) + 1] is not null then 'current_profile_fallback'
        else null
      end as profile_source,
      a.submitted_at,
      a.payment_completed_at,
      a.checked_in_at,
      a.attendance_status,
      case
        when a.payment_completed_at is not null then '결제 완료'
        when a.deposit_requested_at is not null then '입금 확인 중'
        when coalesce(a.transfer_intent_confirmed, false) then '결제중'
        when a.status::text = '결제 대기' then '결제 대기'
        else null
      end as payment_status,
      exists (
        select 1 from public.final_selection_submissions fss
        where fss.event_id = a.event_id and fss.participant_id = a.id
      ) or a.final_selection_submitted_at is not null as final_selection_submitted,
      exists (
        select 1 from public.event_reviews er
        where er.event_id = a.event_id and er.application_id = a.id and er.submitted_at is not null
      ) as review_submitted,
      exists (
        select 1
        from public.final_selections mine
        join public.final_selections theirs
          on theirs.event_id = mine.event_id
         and theirs.selector_application_id = mine.selected_application_id
         and theirs.selected_application_id = mine.selector_application_id
        where mine.event_id = a.event_id and mine.selector_application_id = a.id
      ) as matched
    from candidate_applications a
    join public.events e on e.id = a.event_id
    left join public.event_participant_snapshots eps
      on eps.event_id = a.event_id and eps.application_id = a.id
    left join public.event_profile_cards epc
      on epc.event_id = a.event_id and epc.application_id = a.id
    left join lateral (
      select p.*
      from public.participant_profiles p
      where p.user_id = a.user_id and p.is_active
      order by p.updated_at desc
      limit 1
    ) cp on true
    where a.event_rank = 1
  ), latest_identity as (
    select a.name, a.nickname, a.phone
    from candidate_applications a
    order by a.submitted_at desc
    limit 1
  )
  select jsonb_build_object(
    'found', exists (select 1 from history_rows),
    'summary', case when exists (select 1 from history_rows) then jsonb_build_object(
      'name', coalesce((select name from latest_identity), '미입력'),
      'nickname', coalesce(nullif((select nickname from latest_identity), ''), '미입력'),
      'phone', normalized_phone,
      'totalApplications', (select count(*) from history_rows),
      'actualParticipations', (select count(*) from history_rows where checked_in_at is not null)
    ) else null end,
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'applicationId', application_id,
        'applicationNo', application_no,
        'eventId', event_id,
        'eventTitle', event_title,
        'eventDate', event_date,
        'startTime', start_time,
        'endTime', end_time,
        'location', location,
        'applicationStatus', application_status,
        'historyStatus', history_status,
        'nickname', nickname,
        'age', age,
        'job', job,
        'representativePhotoPath', representative_photo_path,
        'representativeCrop', representative_crop,
        'profileSource', profile_source,
        'submittedAt', submitted_at,
        'paymentStatus', payment_status,
        'checkedInAt', checked_in_at,
        'attendanceStatus', attendance_status,
        'finalSelectionSubmitted', final_selection_submitted,
        'reviewSubmitted', review_submitted,
        'matched', matched
      ) order by event_date desc, start_time desc, submitted_at desc)
      from history_rows
    ), '[]'::jsonb)
  ) into result_value;

  return result_value;
end;
$$;

revoke all on function public.get_admin_participation_history_for_session(text, text) from public;
grant execute on function public.get_admin_participation_history_for_session(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
