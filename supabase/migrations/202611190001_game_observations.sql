-- Isolated, append-only observations. This migration does not collect game data.
begin;

do $prerequisite$
declare
  v_profile oid := pg_catalog.to_regprocedure('public.get_editor_profile(text,text)');
begin
  if v_profile is null or not exists (
    select 1 from pg_catalog.pg_proc
    where oid = v_profile and not proretset
      and prorettype in ('json'::pg_catalog.regtype, 'jsonb'::pg_catalog.regtype)
  ) then
    raise exception 'Prerequisite: get_editor_profile(text,text) must return a JSON object';
  end if;
end
$prerequisite$;

create table public.dw_game_observations (
  id bigint generated always as identity primary key,
  uid text not null check (uid ~ '^[0-9]{6,20}$'),
  observed_at timestamptz not null check (pg_catalog.isfinite(observed_at)),
  source text not null check (source in ('get.new.user.info', 'migrate.user.info')),
  name text check (pg_catalog.char_length(name) <= 200),
  alliance text check (pg_catalog.char_length(alliance) <= 200),
  server bigint check (server between 0 and 9007199254740991),
  total_power bigint check (total_power between 0 and 9007199254740991),
  migration_power bigint check (migration_power between 0 and 9007199254740991),
  army_power bigint check (army_power between 0 and 9007199254740991),
  hero_power bigint check (hero_power between 0 and 9007199254740991),
  building_power bigint check (building_power between 0 and 9007199254740991),
  science_power bigint check (science_power between 0 and 9007199254740991),
  pet_power bigint check (pet_power between 0 and 9007199254740991),
  vehicle_power bigint check (vehicle_power between 0 and 9007199254740991),
  kills bigint check (kills between 0 and 9007199254740991),
  base_level bigint check (base_level between 0 and 9007199254740991),
  imported_by text not null check (
    pg_catalog.char_length(imported_by) between 1 and 120
    and pg_catalog.btrim(imported_by) <> ''
  ),
  imported_at timestamptz not null default pg_catalog.clock_timestamp(),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{32}$'),
  constraint dw_game_observations_dedupe unique (uid, observed_at, source, content_hash)
);

create index dw_game_observations_recent_idx
  on public.dw_game_observations (observed_at desc, imported_at desc, id desc);

alter table public.dw_game_observations enable row level security;
-- No direct table policies: only the two narrowly scoped RPCs below expose it.
revoke all on table public.dw_game_observations from public, anon, authenticated;
revoke all on sequence public.dw_game_observations_id_seq from public, anon, authenticated;

create function public.dw_game_observations_import(
  p_actor text,
  p_device_id text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'UTC'
as $function$
declare
  v_profile jsonb;
  v_item jsonb;
  v_key text;
  v_uid text;
  v_source text;
  v_timestamp text;
  v_observed_at timestamptz;
  v_number numeric;
  v_canonical jsonb;
  v_existing jsonb;
  v_hash text;
  v_record record;
  v_inserted integer := 0;
  v_duplicates integer := 0;
  v_count integer;
  v_row integer := 0;
  v_allowed constant text[] := array[
    'uid', 'name', 'alliance', 'server', 'observed_at', 'source',
    'total_power', 'migration_power', 'army_power', 'hero_power',
    'building_power', 'science_power', 'pet_power', 'vehicle_power',
    'kills', 'base_level'
  ];
  v_numbers constant text[] := array[
    'server', 'total_power', 'migration_power', 'army_power', 'hero_power',
    'building_power', 'science_power', 'pet_power', 'vehicle_power',
    'kills', 'base_level'
  ];
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated session required';
  end if;
  if p_actor is null or pg_catalog.btrim(p_actor) = ''
     or pg_catalog.char_length(p_actor) > 120
     or p_device_id is null or pg_catalog.btrim(p_device_id) = ''
     or pg_catalog.char_length(p_device_id) > 256 then
    raise exception using errcode = '42501', message = 'Editor and approved device required';
  end if;
  v_profile := pg_catalog.to_jsonb(public.get_editor_profile(
    p_name => p_actor, p_device_id => p_device_id
  ));
  if pg_catalog.jsonb_typeof(v_profile) is distinct from 'object'
     or (v_profile ->> 'device_status') is distinct from 'approved'
     or not (
       coalesce(v_profile ->> 'role', '') = 'admin'
       or exists (
         select 1
         from pg_catalog.regexp_split_to_table(
           coalesce(v_profile ->> 'perms', ''), ','
         ) as permission(value)
         where pg_catalog.btrim(permission.value) in ('*', 'entry')
       )
     ) then
    raise exception using errcode = '42501', message = 'Approved device and entry permission required';
  end if;

  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Rows must be a JSON array';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) not between 1 and 500
     or pg_catalog.octet_length(p_rows::text) > 2097152 then
    raise exception using errcode = '22023', message = 'Import requires 1-500 rows and at most 2 MiB';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_rows)
  loop
    v_row := v_row + 1;
    if pg_catalog.jsonb_typeof(v_item) is distinct from 'object' then
      raise exception 'Row % must be an object', v_row using errcode = '22023';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_object_keys(v_item) as field(value)
      where not (field.value = any(v_allowed))
    ) then
      -- Do not echo unknown fields or their values: they may contain credentials.
      raise exception 'Row % contains an unsupported field', v_row using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_item -> 'uid') is distinct from 'string'
       or (v_item ->> 'uid') !~ '^[0-9]{6,20}$' then
      raise exception 'Row % requires a 6-20 digit string UID', v_row using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_item -> 'source') is distinct from 'string'
       or (v_item ->> 'source') not in ('get.new.user.info', 'migrate.user.info') then
      raise exception 'Row % has an unsupported source', v_row using errcode = '22023';
    end if;
    if pg_catalog.jsonb_typeof(v_item -> 'observed_at') is distinct from 'string' then
      raise exception 'Row % requires observed_at with an explicit timezone', v_row using errcode = '22023';
    end if;
    v_timestamp := v_item ->> 'observed_at';
    if v_timestamp !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?([Zz]|[+-][0-9]{2}:[0-9]{2})$' then
      raise exception 'Row % requires an ISO timestamp with Z or a timezone offset', v_row using errcode = '22023';
    end if;
    begin
      v_observed_at := v_timestamp::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'Row % has an invalid observation timestamp', v_row using errcode = '22023';
    end;
    if not pg_catalog.isfinite(v_observed_at) then
      raise exception 'Row % has an invalid observation timestamp', v_row using errcode = '22023';
    end if;

    v_uid := v_item ->> 'uid';
    v_source := v_item ->> 'source';
    v_canonical := '{}'::jsonb;
    foreach v_key in array array['name', 'alliance']
    loop
      if v_item ? v_key and pg_catalog.jsonb_typeof(v_item -> v_key) <> 'null' then
        if pg_catalog.jsonb_typeof(v_item -> v_key) is distinct from 'string'
           or pg_catalog.char_length(v_item ->> v_key) > 200 then
          raise exception 'Row % has an invalid display field', v_row using errcode = '22023';
        end if;
        v_canonical := v_canonical || pg_catalog.jsonb_build_object(v_key, v_item -> v_key);
      end if;
    end loop;
    foreach v_key in array v_numbers
    loop
      if v_item ? v_key and pg_catalog.jsonb_typeof(v_item -> v_key) <> 'null' then
        if pg_catalog.jsonb_typeof(v_item -> v_key) is distinct from 'number' then
          raise exception 'Row % requires numeric metrics, without unit suffixes', v_row using errcode = '22023';
        end if;
        v_number := (v_item ->> v_key)::numeric;
        if v_number < 0 or v_number > 9007199254740991
           or v_number <> pg_catalog.trunc(v_number) then
          raise exception 'Row % metrics must be whole numbers from 0 to 9007199254740991', v_row using errcode = '22023';
        end if;
        v_canonical := v_canonical || pg_catalog.jsonb_build_object(v_key, v_number::bigint);
      end if;
    end loop;
    v_hash := pg_catalog.md5(v_canonical::text);
    select * into v_record from pg_catalog.jsonb_to_record(v_canonical) as fields(
      name text, alliance text, server bigint, total_power bigint,
      migration_power bigint, army_power bigint, hero_power bigint,
      building_power bigint, science_power bigint, pet_power bigint,
      vehicle_power bigint, kills bigint, base_level bigint
    );
    insert into public.dw_game_observations (
      uid, observed_at, source, name, alliance, server,
      total_power, migration_power, army_power, hero_power, building_power,
      science_power, pet_power, vehicle_power, kills, base_level,
      imported_by, content_hash
    ) values (
      v_uid, v_observed_at, v_source, v_record.name, v_record.alliance, v_record.server,
      v_record.total_power, v_record.migration_power, v_record.army_power,
      v_record.hero_power, v_record.building_power, v_record.science_power,
      v_record.pet_power, v_record.vehicle_power, v_record.kills, v_record.base_level,
      p_actor, v_hash
    ) on conflict on constraint dw_game_observations_dedupe do nothing;
    get diagnostics v_count = row_count;
    if v_count = 1 then
      v_inserted := v_inserted + 1;
    else
      -- Hashes index canonical content. Never silently discard different content
      -- on a hash collision, even though every input field is tightly bounded.
      select pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'name', existing.name, 'alliance', existing.alliance, 'server', existing.server,
        'total_power', existing.total_power, 'migration_power', existing.migration_power,
        'army_power', existing.army_power, 'hero_power', existing.hero_power,
        'building_power', existing.building_power, 'science_power', existing.science_power,
        'pet_power', existing.pet_power, 'vehicle_power', existing.vehicle_power,
        'kills', existing.kills, 'base_level', existing.base_level
      )) into v_existing
      from public.dw_game_observations as existing
      where existing.uid = v_uid and existing.observed_at = v_observed_at
        and existing.source = v_source and existing.content_hash = v_hash;
      if v_existing is distinct from v_canonical then
        raise exception 'Row % could not be safely deduplicated', v_row using errcode = '22023';
      end if;
      v_duplicates := v_duplicates + 1;
    end if;
  end loop;
  -- Unhandled validation errors abort the entire RPC statement, including
  -- earlier rows in the same batch. No row-level exception is swallowed.
  return pg_catalog.jsonb_build_object('inserted', v_inserted, 'duplicates', v_duplicates);
end
$function$;

create function public.dw_game_observations_list(
  p_actor text,
  p_device_id text,
  p_limit integer default 500
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
set timezone = 'UTC'
as $function$
declare
  v_profile jsonb;
  v_result jsonb;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated session required';
  end if;
  if p_actor is null or pg_catalog.btrim(p_actor) = ''
     or pg_catalog.char_length(p_actor) > 120
     or p_device_id is null or pg_catalog.btrim(p_device_id) = ''
     or pg_catalog.char_length(p_device_id) > 256 then
    raise exception using errcode = '42501', message = 'Editor and approved device required';
  end if;
  v_profile := pg_catalog.to_jsonb(public.get_editor_profile(
    p_name => p_actor, p_device_id => p_device_id
  ));
  if pg_catalog.jsonb_typeof(v_profile) is distinct from 'object'
     or (v_profile ->> 'device_status') is distinct from 'approved'
     or not (
       coalesce(v_profile ->> 'role', '') = 'admin'
       or exists (
         select 1
         from pg_catalog.regexp_split_to_table(
           coalesce(v_profile ->> 'perms', ''), ','
         ) as permission(value)
         where pg_catalog.btrim(permission.value) in ('*', 'entry')
       )
     ) then
    raise exception using errcode = '42501', message = 'Approved device and entry permission required';
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception using errcode = '22023', message = 'Limit must be between 1 and 500';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.to_jsonb(observation))
      order by observation.observed_at desc, observation.imported_at desc, observation.id desc),
    '[]'::jsonb
  ) into v_result
  from (
    select id, uid, observed_at, source, name, alliance, server,
      total_power, migration_power, army_power, hero_power, building_power,
      science_power, pet_power, vehicle_power, kills, base_level,
      imported_by, imported_at
    from public.dw_game_observations
    order by observed_at desc, imported_at desc, id desc
    limit p_limit
  ) as observation;
  return v_result;
end
$function$;

revoke all on function public.dw_game_observations_import(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.dw_game_observations_list(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.dw_game_observations_import(text, text, jsonb) to authenticated;
grant execute on function public.dw_game_observations_list(text, text, integer) to authenticated;

comment on table public.dw_game_observations is
  'Isolated imported game observations; no credential storage, collection, or automatic sheet-member linkage.';

commit;
