-- Run in the disposable bootstrap database after applying the migration twice.
begin;
set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
set local request.jwt.claims='{"sub":"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"}';
do $$
declare print jsonb:='{"id":"old","mediaType":"movie","tmdbId":null,"added":"2024-02-29T08:00:00.123456+04:00","rating":7.5,"title":" Ｆilm　ΙΣ ","metadata":null,"edition":{"name":"夜"}}';
 body jsonb; result jsonb; bad jsonb; denied boolean;
begin
  body:=jsonb_build_array(jsonb_build_object('id','old','entry',print));
  result:=public.ac_apply(0,'11111111-1111-4111-8111-111111111111',body);
  if result->>'head'<>'1' or public.ac_apply(0,'11111111-1111-4111-8111-111111111111',body)<>result then raise exception 'receipt mismatch'; end if;
  if public.ac_pull(0,null)#>'{rows,0,entry}'<>print then raise exception 'round trip mismatch'; end if;
  if public.ac_apply(0,gen_random_uuid(),body)->>'status'<>'stale' then raise exception 'stale update accepted'; end if;
  denied:=false;
  begin perform public.ac_apply(1,'11111111-1111-4111-8111-111111111111',body);
  exception when raise_exception then denied:=true; end;
  if not denied then raise exception 'operation ID changed meaning'; end if;
  foreach bad in array array[print||'{"rating":4.2}',print||'{"title":false}',print||'{"owner_id":"other"}',print||'{"revision":45}',
    print||'{"metadata":{"genres":[{"id":false}]}}',print||'{"added":"2024-02-30"}',print||'{"metadata":{"posterPath":"https://example.org/image.jpg"}}'] loop
    denied:=false;
    begin perform public.ac_apply(1,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id','old','entry',bad)));
    exception when raise_exception then denied:=true; end;
    if not denied then raise exception 'malformed record accepted'; end if;
  end loop;
  denied:=false;
  begin perform public.ac_apply(1,gen_random_uuid(),jsonb_build_array(jsonb_build_object('id','two','entry',print||'{"id":"two","title":"film ις"}')));
  exception when unique_violation then denied:=true; end;
  if not denied then raise exception 'normalized duplicate accepted'; end if;
  if public.ac_pull(0,null)#>'{rows,0,entry}'<>print or public.ac_pull(0,null)->>'head'<>'1' then raise exception 'failed write mutated archive'; end if;
  denied:=false;
  begin update aftercredits_private.entries set revision=100;
  exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'direct write permitted'; end if;
end $$;
set local request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
set local request.jwt.claims='{"sub":"bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb"}';
do $$ begin
  if public.ac_pull(0,null)->'rows'<>'[]' then raise exception 'owner isolation failed'; end if;
end $$;
reset role;
-- Independently exercise the ownership policy even with a temporary read grant.
grant usage on schema aftercredits_private to authenticated;
grant select on aftercredits_private.entries to authenticated;
set local role authenticated;
do $$ begin
  if exists(select from aftercredits_private.entries) then raise exception 'RLS leaked another owner'; end if;
end $$;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
set local request.jwt.claims='{"sub":"aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"}';
do $$ begin
 if (select count(*) from aftercredits_private.entries)<>1 then raise exception 'RLS hid own entry'; end if;
 perform public.ac_apply(1,gen_random_uuid(),'[{"id":"old","entry":null}]');
 if public.ac_pull(1,null)#>'{rows,0,entry}' is distinct from 'null'::jsonb then raise exception 'missing tombstone'; end if;
end $$;
reset role;
set local role anon;
do $$ declare denied boolean:=false; begin
 begin perform public.ac_pull(0,null); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous read permitted'; end if;
 denied:=false;
 begin perform public.ac_apply(0,gen_random_uuid(),'[]'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'anonymous write permitted'; end if;
end $$;
rollback;
