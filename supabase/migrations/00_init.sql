-- ─────────────────────────────────────────────────────────────
-- GrãoCerto — migração inicial (Fase 4: Autenticação e Banco)
--
-- Rode no SQL Editor do projeto Supabase (ou via CLI: supabase db push).
-- Os dados ficam em JSONB porque o formato do perfil e da simulação
-- ainda evolui a cada fase do MVP — o contrato é do app, não do banco.
-- Segurança: RLS ligado nas duas tabelas; cada usuário só enxerga e
-- mexe nas PRÓPRIAS linhas (auth.uid() = user_id).
-- ─────────────────────────────────────────────────────────────

-- ── Perfil do produtor (1 linha por usuário) ─────────────────
create table if not exists public.perfis (
  user_id uuid primary key references auth.users (id) on delete cascade,
  dados jsonb not null,
  atualizado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

create policy "perfil: ler o próprio"
  on public.perfis for select
  using (auth.uid() = user_id);

create policy "perfil: criar o próprio"
  on public.perfis for insert
  with check (auth.uid() = user_id);

create policy "perfil: atualizar o próprio"
  on public.perfis for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "perfil: excluir o próprio"
  on public.perfis for delete
  using (auth.uid() = user_id);

-- ── Simulações salvas (até 5 por usuário, controlado no app) ─
-- id vem do cliente (formato "sim_<timestamp>_<rand>") para casar com
-- o cache local; a unicidade global é garantida pela PK composta com
-- a política de RLS (um usuário não alcança linhas de outro).
create table if not exists public.simulacoes (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  dados jsonb not null,
  criada_em timestamptz not null default now(),
  primary key (id, user_id)
);

create index if not exists simulacoes_user_data
  on public.simulacoes (user_id, criada_em desc);

alter table public.simulacoes enable row level security;

create policy "simulacoes: ler as próprias"
  on public.simulacoes for select
  using (auth.uid() = user_id);

create policy "simulacoes: criar as próprias"
  on public.simulacoes for insert
  with check (auth.uid() = user_id);

create policy "simulacoes: atualizar as próprias"
  on public.simulacoes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "simulacoes: excluir as próprias"
  on public.simulacoes for delete
  using (auth.uid() = user_id);
