# GrãoCerto — Contexto do Projeto

## O que é
SaaS de decisão de comercialização de grãos para o médio produtor rural brasileiro (200–2.000 ha).
Produto inicial: ferramenta "Armazenar ou Vender" — compara vender a safra hoje vs. armazenar
por N meses, considerando custo de armazenagem, custo do capital e perda técnica.

Visão de longo prazo (não implementar ainda, só para contexto):
1. Fase 1 (ATUAL): MVP da ferramenta de decisão, web, preços manuais → depois cotações reais.
2. Fase 2: marketplace de capacidade ociosa de silos (parceria em negociação com MF Rural).
3. Fase 3: predição de qualidade/deterioração de grãos com IA (dados de termometria de silos).
4. Fase 4: monetização de dados para bancos (score de crédito) e seguradoras.

## Estado atual
- `decisao-armazenar-vender.jsx`: protótipo funcional único (React, single-file, estilos inline).
  Culturas: soja, milho, trigo. Entradas manuais. Sem backend, sem persistência.
- Nada mais foi construído. Este arquivo veio de um protótipo em artifact do Claude.ai.

## Modelo de cálculo (núcleo do produto — não alterar sem discutir)
- Receita hoje = preço_hoje × sacas
- Perda técnica composta: perdaTotal = 1 − (1 − perdaMes)^meses
- Custo de armazenagem = custo_por_saca_mês × meses × sacas
- Custo do capital = receita_hoje × ((1 + juros_mês)^meses − 1)
- Receita futura líquida = preço_esperado × sacas_finais − armazenagem − capital
- Preço de empate = (receita_hoje + armazenagem + capital) / sacas_finais
- Zona cinzenta: |vantagem| < R$ 2/saca → alertar o usuário, não dar veredito forte.

## Próximos passos técnicos (nesta ordem)
1. Estruturar como projeto Vite + React, componente integrado, rodando com `npm run dev`.
2. Serviço de cotações: indicadores diários CEPEA/Esalq (soja Paranaguá, milho ESALQ/BM&F)
   para substituir o preço manual. Manter fallback manual quando a fonte falhar.
3. Curva de futuros B3 para sugerir o preço esperado por vencimento (em vez de chute do usuário).
4. Persistência simples das simulações do produtor (começar com backend leve ou local).
5. Preparar deploy (Vercel) para enviar link nas entrevistas de validação com produtores.

## Convenções
- Toda a interface em português do Brasil, linguagem simples de produtor (sacas, R$/saca, entressafra).
- Números no padrão pt-BR (vírgula decimal, ponto de milhar).
- Mobile-first: o produtor vai abrir isso no celular, no campo.
- Nunca apresentar o resultado como recomendação de investimento; sempre manter o aviso.
- Identidade visual: fundo #F2F4EF, tinta #1E2A22, dourado milho #C99B2F, verde soja #3E6B4F,
  alerta #A4432E. Display: Archivo. Números: IBM Plex Mono.

## Contexto de mercado (resumo)
- Déficit de armazenagem no Brasil em 2026: capacidade para só ~61,7% da safra (CNA/Conab).
- Concorrência de software puro nesse nicho é baixa no Brasil; referências internacionais:
  Bushel e Indigo Market+ (EUA), SiloReal (Argentina).
- Canal de distribuição pretendido: MF Rural (maior marketplace agro do país) + rede de
  consultores agronômicos.
