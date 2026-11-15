-- =====================================================================
-- Journal familial — Étape 1 : tables et règles de sécurité
-- À exécuter UNE SEULE FOIS dans Supabase > SQL Editor (projet Journal-Familial)
-- Tout est gratuit : aucune extension payante, aucun add-on.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Schéma privé (non exposé par l'API) pour la fonction de contrôle
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------
-- 1. Liste des parents autorisés (les 2 comptes, rien d'autre)
-- ---------------------------------------------------------------------
create table public.parents (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

-- Ajoute automatiquement les 2 comptes existants (nom provisoire = début du courriel)
insert into public.parents (user_id, display_name)
select id, left(split_part(email, '@', 1), 40)
from auth.users;

-- Vrai seulement si la personne connectée est l'un des 2 parents
create or replace function private.is_parent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.parents where user_id = auth.uid());
$$;
revoke all on function private.is_parent() from public, anon;
grant execute on function private.is_parent() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Journées (couleur + « belle journée »)
-- ---------------------------------------------------------------------
create table public.days (
  date        date primary key check (date >= '2026-01-01'),
  rating      text check (rating in ('vert', 'jaune', 'orange', 'rouge')),
  belle       boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.parents (user_id),
  version     integer not null default 1
);

-- ---------------------------------------------------------------------
-- 3. Événements (une ligne par observation)
-- ---------------------------------------------------------------------
create table public.events (
  id              uuid primary key,            -- créé sur le téléphone (pas de doublon hors ligne)
  date            date not null check (date >= '2026-01-01'),
  time            time,
  type            text check (type in ('difficulte', 'crise', 'reussite', 'beau_moment', 'autre')),
  intensity       text check (intensity in ('vert', 'jaune', 'orange', 'rouge')),
  note            text check (char_length(note) <= 5000),
  duration_min    integer check (duration_min between 0 and 1440),
  place           text check (char_length(place) <= 100),
  people          text check (char_length(people) <= 300),
  state_before    text check (char_length(state_before) <= 1000),
  context         text check (char_length(context) <= 5000),
  description     text check (char_length(description) <= 5000),
  adult_reaction  text check (char_length(adult_reaction) <= 5000),
  intervention    text check (char_length(intervention) <= 5000),
  child_reaction  text check (char_length(child_reaction) <= 5000),
  calm_time_min   integer check (calm_time_min between 0 and 1440),
  helped          text check (char_length(helped) <= 5000),
  extra           text check (char_length(extra) <= 5000),
  marked_complete boolean not null default false,
  author_id       uuid not null default auth.uid() references public.parents (user_id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.parents (user_id),
  version         integer not null default 1,
  deleted_at      timestamptz,                 -- corbeille (30 jours)
  check (type is not null or intensity is not null or coalesce(note, '') <> '')
);
create index events_date_idx on public.events (date);

-- ---------------------------------------------------------------------
-- 4. Commentaires (ajoutés, jamais modifiés)
-- ---------------------------------------------------------------------
create table public.comments (
  id         uuid primary key,
  event_id   uuid not null references public.events (id) on delete cascade,
  text       text not null check (char_length(text) between 1 and 5000),
  author_id  uuid not null default auth.uid() references public.parents (user_id),
  created_at timestamptz not null default now()
);
create index comments_event_idx on public.comments (event_id);

-- ---------------------------------------------------------------------
-- 5. Le serveur remplit lui-même auteur, dates et numéro de version
--    (le téléphone ne peut pas les falsifier)
-- ---------------------------------------------------------------------
create or replace function private.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.version    := 1;
    if tg_table_name in ('events', 'comments') then
      new.author_id := auth.uid();
    end if;
  else
    new.created_at := old.created_at;
    new.version    := old.version + 1;
    if tg_table_name = 'events' then
      new.author_id := old.author_id;
    end if;
  end if;
  if tg_table_name in ('events', 'days') then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- comments n'a pas de colonne version : déclencheur dédié plus simple
create or replace function private.stamp_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.created_at := now();
  new.author_id  := auth.uid();
  return new;
end;
$$;

create trigger days_stamp   before insert or update on public.days   for each row execute function private.stamp_row();
create trigger events_stamp before insert or update on public.events for each row execute function private.stamp_row();
create trigger comments_stamp before insert on public.comments for each row execute function private.stamp_comment();

-- ---------------------------------------------------------------------
-- 6. Row Level Security : tout est refusé sauf aux 2 parents
-- ---------------------------------------------------------------------
alter table public.parents  enable row level security;
alter table public.days     enable row level security;
alter table public.events   enable row level security;
alter table public.comments enable row level security;

-- parents : lecture seulement (pour afficher les noms) ; aucune modification par l'app
create policy "parents_lecture" on public.parents
  for select to authenticated using ((select private.is_parent()));

-- days : lecture, ajout, modification (pas de suppression : on remet « non évaluée »)
create policy "days_lecture" on public.days
  for select to authenticated using ((select private.is_parent()));
create policy "days_ajout" on public.days
  for insert to authenticated with check ((select private.is_parent()));
create policy "days_modif" on public.days
  for update to authenticated using ((select private.is_parent())) with check ((select private.is_parent()));

-- events : lecture, ajout, modification ; suppression définitive seulement après 30 jours de corbeille
create policy "events_lecture" on public.events
  for select to authenticated using ((select private.is_parent()));
create policy "events_ajout" on public.events
  for insert to authenticated with check ((select private.is_parent()));
create policy "events_modif" on public.events
  for update to authenticated using ((select private.is_parent())) with check ((select private.is_parent()));
create policy "events_purge_corbeille" on public.events
  for delete to authenticated
  using ((select private.is_parent()) and deleted_at is not null and deleted_at < now() - interval '30 days');

-- comments : lecture et ajout seulement
create policy "comments_lecture" on public.comments
  for select to authenticated using ((select private.is_parent()));
create policy "comments_ajout" on public.comments
  for insert to authenticated with check ((select private.is_parent()));

-- ---------------------------------------------------------------------
-- 7. Accès API : rien pour les visiteurs anonymes, le strict nécessaire pour les comptes connectés
--    (nécessaire car « exposer automatiquement les nouvelles tables » est désactivé)
-- ---------------------------------------------------------------------
revoke all on public.parents, public.days, public.events, public.comments from anon, public;
grant select                         on public.parents  to authenticated;
grant select, insert, update         on public.days     to authenticated;
grant select, insert, update, delete on public.events   to authenticated;
grant select, insert                 on public.comments to authenticated;

commit;

-- =====================================================================
-- Fin. Résultat attendu : « Success. No rows returned »
-- =====================================================================
