-- ─────────────────────────────────────────────────────────────
-- GrãoCerto — alertas de preço + notificações (Fase 6)
--
-- Rode DEPOIS da 00_init.sql, no SQL Editor do projeto Supabase.
-- O cron (server/cron-alertas.mjs) roda com a SERVICE ROLE (bypassa
-- RLS) para ler alertas de todos os usuários e registrar notificações;
-- o app (anon key + sessão) só enxerga as linhas do próprio usuário.
-- ─────────────────────────────────────────────────────────────

-- ── Alertas de preço ("me avise quando chegar a R$ X") ───────
create table if not exists public.alertas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  cultura text not null check (cultura in ('soja', 'milho', 'trigo')),
  praca text,
  preco_alvo numeric not null check (preco_alvo > 0),
  tipo text not null check (tipo in ('maior_que', 'menor_que')),
  telefone text, -- WhatsApp em formato internacional (5511999998888)
  status text not null default 'pendente'
    check (status in ('pendente', 'disparado', 'cancelado')),
  criado_em timestamptz not null default now(),
  disparado_em timestamptz
);

create index if not exists alertas_pendentes
  on public.alertas (status)
  where status = 'pendente';

alter table public.alertas enable row level security;

create policy "alertas: ler os próprios"
  on public.alertas for select
  using (auth.uid() = user_id);

create policy "alertas: criar os próprios"
  on public.alertas for insert
  with check (auth.uid() = user_id);

create policy "alertas: atualizar os próprios"
  on public.alertas for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "alertas: excluir os próprios"
  on public.alertas for delete
  using (auth.uid() = user_id);

-- ── Notificações enviadas (auditoria do cron) ────────────────
-- Sem policy de INSERT para usuários: só a service role (cron) grava.
create table if not exists public.notificacoes (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid references public.alertas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  canal text not null default 'whatsapp',
  mensagem text not null,
  sucesso boolean not null,
  detalhe text, -- id da mensagem no provedor, ou o erro
  enviada_em timestamptz not null default now()
);

alter table public.notificacoes enable row level security;

create policy "notificacoes: ler as próprias"
  on public.notificacoes for select
  using (auth.uid() = user_id);
