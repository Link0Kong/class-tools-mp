-- 班级身份认证建表说明（不含名单数据）
-- 实际 69 条名单由一次性导入脚本写入 private.class_ids；本文件只保留结构与策略，便于复查/重建。
-- 姓名 + 学号（32607070 + 两位座号）由 security definer 函数校验，名单 RLS 要求 identity_verify 行存在。
begin;
create schema if not exists private;
create table if not exists private.class_ids (
  seat integer primary key,
  name text not null,
  sid text not null unique
);
alter table private.class_ids enable row level security;
revoke all on private.class_ids from public;
revoke all on private.class_ids from anon;
revoke all on private.class_ids from authenticated;

create table if not exists public.identity_verify (
  acc text primary key,
  name text not null,
  sid text not null,
  ok boolean not null default true,
  ts bigint not null default 0
);
alter table public.identity_verify enable row level security;
grant select, insert, update on public.identity_verify to anon, authenticated;
grant usage on schema private to anon, authenticated;

create or replace function private.identity_match(p_name text, p_sid text)
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select exists(select 1 from private.class_ids where name = btrim(p_name) and sid = btrim(p_sid));
$$;
revoke all on function private.identity_match(text,text) from public;
grant execute on function private.identity_match(text,text) to anon, authenticated;

create or replace function private.identity_verified()
returns boolean language sql stable security definer set search_path = public, private, pg_temp as $$
  select exists(select 1 from public.identity_verify where acc = auth_acc() and ok = true);
$$;
revoke all on function private.identity_verified() from public;
grant execute on function private.identity_verified() to anon, authenticated;

drop policy if exists idv_read on public.identity_verify;
drop policy if exists idv_insert on public.identity_verify;
drop policy if exists idv_update on public.identity_verify;
create policy idv_read on public.identity_verify for select using (auth_ok() and acc = auth_acc());
create policy idv_insert on public.identity_verify for insert with check (auth_ok() and acc = auth_acc() and private.identity_match(name, sid));
create policy idv_update on public.identity_verify for update using (auth_ok() and acc = auth_acc()) with check (auth_ok() and acc = auth_acc() and private.identity_match(name, sid));

drop policy if exists rstr_read on public.roster;
create policy rstr_read on public.roster for select using (auth_admin() or (auth_ok() and private.identity_verified()));
commit;
