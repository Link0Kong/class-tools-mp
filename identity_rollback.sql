-- 回滚班级身份认证（2026-10-19）
-- 恢复：名单仅要求登录；删除认证表/私有名单/策略；不动现有 roster 数据。
begin;
drop policy if exists idv_read on public.identity_verify;
drop policy if exists idv_insert on public.identity_verify;
drop policy if exists idv_update on public.identity_verify;
drop table if exists public.identity_verify;
drop policy if exists rstr_read on public.roster;
create policy rstr_read on public.roster for select using (auth_ok());
drop function if exists private.identity_match(text,text);
drop function if exists private.identity_verified();
drop schema if exists private cascade;
commit;
