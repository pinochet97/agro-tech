-- ─────────────────────────────────────────────────────────────
-- GrãoCerto — resultado real das vendas (Fase 7)
--
-- Rode DEPOIS da 00_init.sql e da 01_alertas.sql, no SQL Editor.
-- Cada linha é um lote FECHADO: o produtor registrou a data e o preço
-- reais da venda ("Vendi este lote"). Os campos-chave da comparação
-- ficam em colunas próprias (consultáveis p/ métricas agregadas);
-- o retrato completo — custos, preço de empate, baseline — vai em
-- `dados` (JSONB), como nas outras tabelas do app.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.lotes_fechados (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  cultura text not null check (cultura in ('soja', 'milho', 'trigo')),
  sacas numeric not null check (sacas > 0),
  preco_simulacao numeric not null,
  data_simulacao timestamptz not null,
  recomendacao text not null check (recomendacao in ('vender', 'armazenar')),
  preco_venda_real numeric not null check (preco_venda_real > 0),
  data_venda_real date not null,
  decisao_tomada text not null check (decisao_tomada in ('vendeu', 'segurou')),
  dados jsonb not null,
  criado_em timestamptz not null default now(),
  primary key (id, user_id)
);

alter table public.lotes_fechados enable row level security;

create policy "lotes_fechados: ler os próprios"
  on public.lotes_fechados for select
  using (auth.uid() = user_id);

create policy "lotes_fechados: criar os próprios"
  on public.lotes_fechados for insert
  with check (auth.uid() = user_id);

create policy "lotes_fechados: atualizar os próprios"
  on public.lotes_fechados for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "lotes_fechados: excluir os próprios"
  on public.lotes_fechados for delete
  using (auth.uid() = user_id);
