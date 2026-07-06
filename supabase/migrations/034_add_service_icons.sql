alter table public.services
  add column if not exists icon text not null default 'scissors';

update public.services
set icon = 'scissors'
where icon is null;
