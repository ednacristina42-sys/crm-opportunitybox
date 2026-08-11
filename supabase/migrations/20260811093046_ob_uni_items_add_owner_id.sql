
alter table public.ob_uni_items
  add column if not exists owner_id uuid references public.ob_profiles(id);

create index if not exists ob_uni_items_page_idx on public.ob_uni_items (page);
create index if not exists ob_uni_items_owner_id_idx on public.ob_uni_items (owner_id);
create index if not exists ob_uni_items_page_owner_id_idx on public.ob_uni_items (page, owner_id);
