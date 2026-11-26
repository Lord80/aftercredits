-- Run as the dashboard migration owner. The entire migration is repeatable and atomic.
begin;
create schema if not exists aftercredits_private;
revoke all on schema aftercredits_private from public, anon, authenticated;
create collation if not exists aftercredits_private.unicode_root (provider = icu, locale = 'und', deterministic = true);

create or replace function aftercredits_private.title_key(t text) returns text
language sql immutable strict set search_path = pg_catalog as $$
  select lower(btrim(regexp_replace(translate(normalize(t, NFKC),
    U&'\0009\000A\000B\000C\000D\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF',
    repeat(' ', 24)), ' +', ' ', 'g')) collate aftercredits_private.unicode_root)
$$;
create or replace function aftercredits_private.units(t text) returns integer
language sql immutable strict set search_path=pg_catalog as $$
  select length(t) + length(regexp_replace(t, U&'[^\+010000-\+10FFFF]', '', 'g'))
$$;
create or replace function aftercredits_private.safe_tree(j jsonb, depth integer) returns boolean
language plpgsql immutable strict set search_path=pg_catalog as $$
declare k text; v jsonb; n integer := 0;
begin
  if depth > 12 then return false; end if;
  case jsonb_typeof(j)
  when 'object' then
    for k,v in select * from jsonb_each(j) loop
      n := n+1;
      if n>128 or aftercredits_private.units(k) not between 1 and 128
        or k in ('__proto__','constructor','prototype')
        or regexp_replace(lower(k),'[-_[:space:]]','','g') ~ '(password|secret|token|credential|authorization|apikey)'
        or not aftercredits_private.safe_tree(v,depth+1) then return false; end if;
    end loop;
  when 'array' then
    if jsonb_array_length(j)>2048 then return false; end if;
    for v in select value from jsonb_array_elements(j) loop
      if not aftercredits_private.safe_tree(v,depth+1) then return false; end if;
    end loop;
  when 'string' then return aftercredits_private.units(j #>> '{}')<=262144;
  when 'number' then return abs((j #>> '{}')::numeric)<=1.7976931348623157e308;
  else null;
  end case;
  return true;
end $$;
create or replace function aftercredits_private.good_date(t text, day_only boolean) returns boolean
language sql stable strict set search_path=pg_catalog as $$
  select t ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9]))?$'
    and (not day_only or length(t)=10)
    and pg_input_is_valid(regexp_replace(left(t,10),'^0000-', '2000-'), 'date')
$$;
create or replace function aftercredits_private.positive_id(v jsonb) returns boolean
language sql immutable set search_path=pg_catalog as $$
  select case when jsonb_typeof(v)='number' then (v::numeric between 1 and 9007199254740991 and trunc(v::numeric)=v::numeric) else false end
$$;
create or replace function aftercredits_private.valid_print(j jsonb) returns boolean
language plpgsql stable set search_path=pg_catalog as $$
declare m jsonb; k text; g jsonb;
begin
  if (jsonb_typeof(j)='object' and j ?& array['id','title','mediaType','tmdbId','rating','added']
    and not (j ?| array['owner','owner_id','ownerId','revision','updated_at','deleted_at'])
    and jsonb_typeof(j->'id')='string' and aftercredits_private.units(j->>'id') between 1 and 512
    and aftercredits_private.title_key(j->>'id')<>'' and (j->>'id') !~ U&'[\0001-\001F\007F]'
    and jsonb_typeof(j->'title')='string' and aftercredits_private.units(j->>'title')<=65536
    and aftercredits_private.title_key(j->>'title')<>'' and j->>'mediaType' in ('movie','tv')
    and (j->'tmdbId'='null'::jsonb or aftercredits_private.positive_id(j->'tmdbId'))
    and jsonb_typeof(j->'rating')='number' and jsonb_typeof(j->'added')='string'
    and aftercredits_private.good_date(j->>'added',false) and aftercredits_private.safe_tree(j,0)) is not true then return false; end if;
  if (j->>'rating')::numeric not between 1 and 10 or mod((j->>'rating')::numeric,0.5)<>0 then return false; end if;
  m:=j->'metadata';
  if m is null or m='null'::jsonb then return true; end if;
  if jsonb_typeof(m)<>'object' then return false; end if;
  foreach k in array array['title','originalTitle','overview','originalLanguage','releaseDate'] loop
    if m?k and jsonb_typeof(m->k)<>'string' then return false; end if;
  end loop;
  if aftercredits_private.units(m->>'title')>65536 or aftercredits_private.units(m->>'originalTitle')>65536
    or (m->>'originalLanguage') !~ '^([a-zA-Z]{2,3})?$' or
    ((m->>'releaseDate')<>'' and not aftercredits_private.good_date(m->>'releaseDate',true)) then return false; end if;
  foreach k in array array['posterPath','backdropPath'] loop
    if m?k and m->k<>'null'::jsonb and (jsonb_typeof(m->k)<>'string' or length(m->>k)>512 or
      (m->>k) !~* '^/[a-zA-Z0-9_.-]+[.](jpg|png|webp)$') then return false; end if;
  end loop;
  if m?'genres' then
    if jsonb_typeof(m->'genres')<>'array' then return false; end if;
    if jsonb_array_length(m->'genres')>128 then return false; end if;
    for g in select value from jsonb_array_elements(m->'genres') loop
      if jsonb_typeof(g)<>'object' or not aftercredits_private.positive_id(g->'id')
        or (g?'name' and (jsonb_typeof(g->'name')<>'string' or aftercredits_private.units(g->>'name')>512)) then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create table if not exists aftercredits_private.heads (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision bigint not null default 0 check (revision between 0 and 9007199254740991)
);
create table if not exists aftercredits_private.entries (
  owner_id uuid not null references aftercredits_private.heads(owner_id) on delete cascade,
  local_id text not null, payload jsonb, revision bigint not null check(revision>0),
  updated_at timestamptz not null, deleted_at timestamptz,
  primary key(owner_id,local_id), unique(owner_id,revision),
  check ((payload is null) = (deleted_at is not null)),
  check (payload is null or (aftercredits_private.valid_print(payload) and payload->>'id'=local_id))
);
create unique index if not exists ac_catalog_identity on aftercredits_private.entries
  (owner_id,(payload->>'mediaType'),((payload->>'tmdbId')::numeric)) where payload->>'tmdbId' is not null;
-- A digest keeps even long manual titles within PostgreSQL's B-tree key size.
create or replace function aftercredits_private.title_digest(t text) returns bytea
language sql immutable strict set search_path=pg_catalog as $$
  select sha256(convert_to(aftercredits_private.title_key(t),'UTF8'))
$$;
create unique index if not exists ac_manual_identity on aftercredits_private.entries
  (owner_id,(payload->>'mediaType'),(aftercredits_private.title_digest(payload->>'title'))) where payload is not null and payload->>'tmdbId' is null;
create table if not exists aftercredits_private.operations (
  owner_id uuid not null references aftercredits_private.heads(owner_id) on delete cascade,
  op_id uuid not null, fingerprint bytea not null, committed_head bigint not null, primary key(owner_id,op_id)
);
do $$
declare name text;
begin
  foreach name in array array['heads','entries','operations'] loop
    execute format('alter table aftercredits_private.%I enable row level security',name);
    execute format('drop policy if exists own_archive on aftercredits_private.%I',name);
    execute format('create policy own_archive on aftercredits_private.%I for select to authenticated using (owner_id=(select auth.uid()))',name);
  end loop;
end $$;

create or replace function public.ac_pull(after_revision bigint, pinned_head bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); head bigint; batch jsonb;
begin
  if who is null then raise insufficient_privilege; end if;
  select revision into head from aftercredits_private.heads where owner_id=who;
  head:=coalesce(head,0);
  if after_revision is null or after_revision<0 or after_revision>head then raise exception 'Invalid cloud cursor'; end if;
  if pinned_head is not null and head<>pinned_head then return jsonb_build_object('status','stale'); end if;
  select coalesce(jsonb_agg(to_jsonb(p) order by p.revision),'[]'::jsonb) into batch from
    (select local_id as id, payload as entry, revision from aftercredits_private.entries
       where owner_id=who and revision>after_revision order by revision limit 100) p;
  return jsonb_build_object('status','ok','head',head,'rows',batch);
end $$;

create or replace function public.ac_apply(expected bigint, operation_id uuid, changes jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare who uuid:=auth.uid(); head bigint; total integer; digest bytea; prior aftercredits_private.operations%rowtype;
begin
  if who is null then raise insufficient_privilege; end if;
  if operation_id is null or expected is null or expected<0 or jsonb_typeof(changes) is distinct from 'array'
    then raise exception 'Invalid operation'; end if;
  total:=jsonb_array_length(changes);
  if total not between 1 and 100000 or octet_length(changes::text)>33554432 then raise exception 'Invalid batch size'; end if;
  digest:=sha256(convert_to(jsonb_build_array(expected,changes)::text,'UTF8'));
  insert into aftercredits_private.heads(owner_id) values(who) on conflict do nothing;
  select revision into strict head from aftercredits_private.heads where owner_id=who for update;
  select * into prior from aftercredits_private.operations where owner_id=who and op_id=operation_id;
  if found then
    if prior.fingerprint<>digest then raise exception 'Operation already used for different content'; end if;
    return jsonb_build_object('status','ok','head',prior.committed_head);
  end if;
  if expected<>head then return jsonb_build_object('status','stale'); end if;
  if exists(select 1 from jsonb_array_elements(changes) c where
    (jsonb_typeof(c)='object' and c ?& array['id','entry'] and (c-'id'-'entry')='{}'::jsonb
    and jsonb_typeof(c->'id')='string' and aftercredits_private.units(c->>'id') between 1 and 512
    and aftercredits_private.title_key(c->>'id')<>'' and (c->>'id') !~ U&'[\0001-\001F\007F]'
    and (c->'entry'='null'::jsonb or (aftercredits_private.valid_print(c->'entry') and c->>'id'=c->'entry'->>'id'))) is not true)
    or (select count(distinct c->>'id') from jsonb_array_elements(changes) c)<>total then raise exception 'Invalid collection change'; end if;
  -- Release old identity keys inside this transaction so a restore can move or swap titles.
  update aftercredits_private.entries e set payload=null,deleted_at=now()
    from jsonb_array_elements(changes) c where e.owner_id=who and e.local_id=c->>'id';
  insert into aftercredits_private.entries(owner_id,local_id,payload,revision,updated_at,deleted_at)
    select who,c->>'id',nullif(c->'entry','null'::jsonb),head+n,now(),case when c->'entry'='null'::jsonb then now() end
    from jsonb_array_elements(changes) with ordinality t(c,n)
    on conflict(owner_id,local_id) do update set payload=excluded.payload,revision=excluded.revision,
      updated_at=excluded.updated_at,deleted_at=excluded.deleted_at;
  if (select count(*) from aftercredits_private.entries where owner_id=who and payload is not null)>50000 then raise exception 'Archive exceeds the title limit'; end if;
  head:=head+total;
  update aftercredits_private.heads set revision=head where owner_id=who;
  insert into aftercredits_private.operations values(who,operation_id,digest,head);
  return jsonb_build_object('status','ok','head',head);
end $$;

revoke all on all tables in schema aftercredits_private from public, anon, authenticated, service_role;
revoke all on all functions in schema aftercredits_private from public, anon, authenticated, service_role;
revoke all on function public.ac_apply(bigint,uuid,jsonb),public.ac_pull(bigint,bigint) from public,anon,authenticated,service_role;
grant execute on function public.ac_apply(bigint,uuid,jsonb),public.ac_pull(bigint,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
