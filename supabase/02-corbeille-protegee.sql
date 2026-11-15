-- =====================================================================
-- Journal familial — Étape 2 : corbeille protégée
-- Le serveur fixe lui-même la date de mise à la corbeille. Ainsi, personne ne peut
-- « antidater » une suppression pour effacer définitivement une fiche avant 30 jours.
-- À exécuter dans Supabase > SQL Editor, après l'étape 1. Peut être relancé sans risque
-- (il remplace seulement la fonction ; aucune donnée n'est touchée).
-- =====================================================================

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
    -- (deux « if » imbriqués : la table days n'a pas de colonne deleted_at,
    --  et PL/pgSQL évaluerait new.deleted_at même si la première condition est fausse)
    if tg_table_name = 'events' then
      if new.deleted_at is not null then
        new.deleted_at := now();
      end if;
    end if;
  else
    new.created_at := old.created_at;
    new.version    := old.version + 1;
    if tg_table_name = 'events' then
      new.author_id := old.author_id;
      if new.deleted_at is not null then
        -- mise à la corbeille : date du serveur ; déjà à la corbeille : date inchangée
        new.deleted_at := coalesce(old.deleted_at, now());
      end if;
    end if;
  end if;
  if tg_table_name in ('events', 'days') then
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- Résultat attendu : « Success. No rows returned »
