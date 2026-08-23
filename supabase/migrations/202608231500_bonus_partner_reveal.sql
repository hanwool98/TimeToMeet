-- Bonus-round "다시 만나게 된 행운의 상대" reveal screen support.
--
-- 1) generate_bonus_round_assignments previously renumbered bonus-round
--    tables sequentially (1..K). The operational model for the bonus round
--    (clarified with this feature) is: women stay seated wherever they
--    ended up in the LAST regular round, and men move to find them - so a
--    bonus pair's table number must be the woman's final regular-round
--    table, not a fresh renumbering. The old behavior would have shown
--    mismatched pairs on any table tablet and mislabeled pause-request
--    table context during the bonus round. Fixed to reuse each matched
--    woman's final regular-round table number.
-- 2) get_round_progress_for_participant resolved the partner/table by
--    target_progress.current_round, which still holds the LAST REGULAR
--    round's number throughout bonus_matching/bonus_seat_guide (it isn't
--    bumped to total_rounds+1 until the bonus round_active tick actually
--    starts) - so the reveal screen would have shown the participant's
--    previous regular-round partner instead of their new bonus partner.
--    Also now returns the participant's own gender (for the reveal
--    screen's gender-specific copy) and an isBonusRound flag (so the
--    conversation screen's mini timer can use the 7-minute bonus duration
--    instead of the regular 10 minutes).
create or replace function public.generate_bonus_round_assignments(event_id_value text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  target_event public.events%rowtype;
  total_rounds integer;
  bonus_round_number integer;
  rec record;
  used_males uuid[] := '{}';
  used_females uuid[] := '{}';
  remaining_males uuid[];
  remaining_females uuid[];
  female_table integer;
  i integer;
begin
  if exists (select 1 from public.event_table_assignments where event_id = event_id_value and is_bonus) then
    return;
  end if;

  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));
  bonus_round_number := total_rounds + 1;

  for rec in
    select c.male_application_id, c.female_application_id
    from public.compute_mutual_ratings(event_id_value) c
    where c.male_to_female_score is not null and c.female_to_male_score is not null
    order by (c.male_to_female_score + c.female_to_male_score) desc
  loop
    if not (rec.male_application_id = any(used_males)) and not (rec.female_application_id = any(used_females)) then
      select eta.table_number into female_table
      from public.event_table_assignments eta
      where eta.event_id = event_id_value
        and eta.round_number = total_rounds
        and not eta.is_bonus
        and eta.female_application_id = rec.female_application_id
      limit 1;

      insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
      values (event_id_value, coalesce(female_table, 1), bonus_round_number, rec.male_application_id, rec.female_application_id, true);
      used_males := used_males || rec.male_application_id;
      used_females := used_females || rec.female_application_id;
    end if;
  end loop;

  select array_agg(a.id) into remaining_males
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.gender = '남성'
    and not (a.id = any(used_males));

  select array_agg(a.id) into remaining_females
  from public.applications a
  where a.event_id = event_id_value and a.status = '참가 확정' and a.checked_in_at is not null and a.gender = '여성'
    and not (a.id = any(used_females));

  for i in 1..least(coalesce(array_length(remaining_males, 1), 0), coalesce(array_length(remaining_females, 1), 0)) loop
    select eta.table_number into female_table
    from public.event_table_assignments eta
    where eta.event_id = event_id_value
      and eta.round_number = total_rounds
      and not eta.is_bonus
      and eta.female_application_id = remaining_females[i]
    limit 1;

    insert into public.event_table_assignments (event_id, table_number, round_number, male_application_id, female_application_id, is_bonus)
    values (event_id_value, coalesce(female_table, 1), bonus_round_number, remaining_males[i], remaining_females[i], true);
  end loop;
end;
$$;

revoke all on function public.generate_bonus_round_assignments(text) from public, anon, authenticated;

create or replace function public.get_round_progress_for_participant(session_token text, event_id_value text)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  session_user_id uuid;
  target_application public.applications%rowtype;
  target_progress public.event_progress%rowtype;
  target_event public.events%rowtype;
  total_rounds integer;
  assignment_round integer;
  assignment record;
begin
  select s.user_id into session_user_id
  from public.app_sessions s
  where s.token_hash = encode(extensions.digest(session_token, 'sha256'), 'hex') and s.expires_at > now();

  if session_user_id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into target_application
  from public.applications a
  where a.event_id = event_id_value and a.user_id = session_user_id and a.status = '참가 확정'
  order by a.checked_in_at desc nulls last
  limit 1;

  if not found then
    return jsonb_build_object('ok', false);
  end if;

  perform public.advance_round_state_if_needed(event_id_value);

  select * into target_progress from public.event_progress where event_id = event_id_value;
  select * into target_event from public.events where id = event_id_value;
  total_rounds := greatest(1, least(target_event.male_capacity, target_event.female_capacity));

  assignment_round := case
    when target_progress.stage in ('bonus_matching', 'bonus_seat_guide') then total_rounds + 1
    else target_progress.current_round
  end;

  select
    eta.table_number,
    case when eta.male_application_id = target_application.id then eta.female_application_id else eta.male_application_id end as partner_application_id,
    case when eta.male_application_id = target_application.id then fa.nickname else ma.nickname end as partner_nickname,
    case when eta.male_application_id = target_application.id
      then extract(year from age(target_event.event_date::timestamp, fa.birth_date::timestamp))::integer
      else extract(year from age(target_event.event_date::timestamp, ma.birth_date::timestamp))::integer
    end as partner_age,
    case when eta.male_application_id = target_application.id then fa.job else ma.job end as partner_job
  into assignment
  from public.event_table_assignments eta
  left join public.applications ma on ma.id = eta.male_application_id
  left join public.applications fa on fa.id = eta.female_application_id
  where eta.event_id = event_id_value
    and eta.round_number = coalesce(assignment_round, 1)
    and (eta.male_application_id = target_application.id or eta.female_application_id = target_application.id);

  return jsonb_build_object(
    'ok', true,
    'stage', target_progress.stage,
    'currentRound', target_progress.current_round,
    'totalRounds', total_rounds,
    'roundPhase', target_progress.round_phase,
    'timerStatus', target_progress.round_timer_status,
    'timerPositionSeconds', target_progress.round_timer_position_seconds,
    'timerUpdatedAt', target_progress.round_timer_updated_at,
    'tableNumber', assignment.table_number,
    'partnerApplicationId', assignment.partner_application_id,
    'partnerNickname', assignment.partner_nickname,
    'partnerAge', assignment.partner_age,
    'partnerJob', assignment.partner_job,
    'gender', target_application.gender,
    'isBonusRound', coalesce(target_progress.is_bonus_round, false)
  );
end;
$$;

grant execute on function public.get_round_progress_for_participant(text, text) to anon, authenticated;
