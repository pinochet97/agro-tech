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
- Projeto **Vite + React** estruturado, rodando com `npm run dev` (porta 5173) e
  buildando com `npm run build`. Node 24 LTS.
  - `index.html` + `src/main.jsx` fazem o bootstrap; o componente principal é
    `src/decisao-armazenar-vender.jsx` (mantido single-file, estilos inline, visual e
    modelo de cálculo intactos). Culturas: soja, milho, trigo.
- **Serviço de cotações** (`src/services/cotacoes.js`): preenche o "preço hoje"
  automaticamente para soja e milho **ao vivo** (CEPEA/ESALQ), com fallback manual.
  Arquitetura em camadas (providers), da mais "ao vivo" para a mais estática:
  1. `VITE_COTACOES_ENDPOINT` → **backend leve** `server/cotacoes-proxy.mjs` (ver abaixo).
     Em dev, `.env.development` já aponta para `/api/cotacoes`, encaminhado pelo proxy do
     Vite (`/api` → porta 8787). Suba tudo junto com `npm run dev:all`.
  2. `public/cotacoes.json` → snapshot de referência versionado (mesma origem). Fallback
     quando o backend está fora. **Manter atualizado.** Trigo fica sempre manual.
  3. Edição manual do produtor (o campo continua editável; badge mostra fonte/data e
     avisa quando o valor é "referência" ou "ajustado por você").
- **Backend leve** (`server/cotacoes-proxy.mjs`): servidor Node (porta 8787; única
  dependência: `@anthropic-ai/sdk`). Busca os indicadores no **endpoint do widget de embed do CEPEA**
  (`widgetproduto.js.php?id_indicador[]=92&id_indicador[]=77`; 92=Soja Paranaguá,
  77=Milho), faz o parse da tabela HTML e devolve JSON normalizado em `/api/cotacoes`,
  com cache de 30 min e fallback para o último sucesso.
  - **Truque que viabiliza o "ao vivo":** as páginas de indicador do CEPEA ficam atrás de
    Cloudflare (403 + desafio de bot para fetch server-side), mas o endpoint do *widget*
    é liberado para requisições com **cabeçalhos de navegador** (User-Agent + Referer) —
    inclusive do Node. O proxy só funciona se mandar esses headers. A API oficial do CEPEA
    é paga (~R$ 10,5 mil); esta rota do widget é gratuita.
  - Dados CEPEA/ESALQ: **CC BY-NC 4.0** (atribuição obrigatória, uso não-comercial) — a
    atribuição está no campo `fonte` e visível na interface.
- **Chat com memória** (Fase 3 "IA Conversacional Real"): botão flutuante 💬 disponível
  em todas as abas abre um chat (texto, voz e foto). O histórico INTEIRO vai ao backend
  (`{mensagens: [{papel: "produtor"|"graocerto", texto}], lote}`), então "e se eu vender
  só metade?" resolve contra a quantidade discutida antes (validado: 10.000 → 5.000;
  "um terço de 6.000" → 2.000). Os campos que o produtor muda são aplicados ao lote em
  foco (seletor "Falando sobre" no chat; "novo lote" cria um) e o APP recalcula — uma
  mensagem 📊 com veredito/vantagem/empate calculados localmente entra no chat. A voz
  (Web Speech) preenche o campo para o produtor conferir e enviar; a foto de romaneio/NF
  vira mensagem no chat com os campos aplicados. Sem IA/backend: regras locais na última
  mensagem, sem memória, com aviso. O painel antigo de frase única + card de confirmação
  foi SUBSTITUÍDO pelo chat (a aplicação é direta porque a mensagem é uma instrução
  explícita do produtor; a mensagem 📊 dá a visibilidade do que mudou).
  - **Armadilhas de API que custaram debug (jul/2026):** com structured outputs +
    adaptive thinking a resposta pode vir com blocos intercalados (thinking, text,
    thinking, text) e o campo de TEXTO LIVRE do JSON sai corrompido/embaralhado — 
    (1) sempre pegar o ÚLTIMO bloco de texto (`textoFinal()` no nucleo), e (2) no chat
    o thinking fica DESLIGADO (omitido). Além disso, mensagem corrompida que entra no
    histórico contamina as respostas seguintes (o modelo imita o próprio lixo) — a
    conversa é em memória, recarregar zera.
  - Backend: `POST /api/interpretar` aceita três formas — `{texto}` (extrai),
    `{texto, lote}` (extrai + gera a frase) e `{lote}` (só a frase). E
    `POST /api/interpretar-imagem` (foto de
    romaneio de balança / nota fiscal) no backend leve. Extração via **API do Claude**
    (SDK oficial, `claude-opus-4-8` com structured outputs) quando `ANTHROPIC_API_KEY`
    está no `.env`; **sem chave**, frases caem no extrator local de regras pt-BR
    (`src/services/extrator.js`, compartilhado front/servidor — testado com 8 frases
    reais) e foto devolve erro claro. Sem backend nenhum, o front roda o mesmo extrator
    no navegador — a feature nunca fica indisponível, só degrada com aviso.
  - **Caminho IA validado com chamadas reais** (jul/2026): frases coloquiais extraem
    certinho, incluindo "300 toneladas" → 5000 sacas e "até dezembro" → meses. Detalhes
    que custaram debug: (1) o schema de structured outputs NÃO aceita enum com tipo
    união `["string","null"]` — usar `anyOf` com `{type:"null"}`; (2) a data de hoje
    vai na mensagem do usuário (não no system, p/ não invalidar cache) — sem ela o
    modelo não converte "até dezembro" em meses. A chave fica no `.env` (gitignorado);
    `.env.development` é versionado e NUNCA deve ter segredo.
  - **Leitura de foto validada com documentos reais de teste** (jul/2026, visão do
    Claude Opus): romaneio de balança → cultura, peso líquido ÷ 60 = sacas exatas
    (42.000 kg → 700) e `dataDocumento`; nota fiscal → idem + `precoHoje` do valor
    unitário (R$ 64,50/saca). Fluxo completo validado pela interface: foto no input →
    redimensionamento (canvas, 1568 px) → endpoint → card de confirmação → aplicar.
    `dataDocumento` é informativo (aparece no card, não entra no cálculo). Os testes
    usaram documentos SINTÉTICOS desenhados em canvas (layout realista de balança/NF);
    vale re-validar com fotos reais de produtor nas entrevistas (amassado, sombra,
    caligrafia).
  - **A IA só extrai parâmetros — nunca calcula nem recomenda** (princípio do
    documento-norte: o modelo chama/alimenta o serviço de cálculo, não chuta contas).
  - Voz: Web Speech API do navegador (pt-BR, grátis; Chrome/Edge sim, Firefox não —
    o botão só aparece quando suportado). Orquestração: `src/services/conversa.js`.
- **Histórico de simulações** (`src/services/simulacoes.js`, localStorage
  `graocerto.simulacoes.v1`): cada "Salvar simulação" guarda um retrato completo
  (entradas + custos + resultado) com ID e timestamp. Painel "Simulações salvas" na
  coluna de resultado lista as últimas 5 (a mais antiga sai), com **Abrir** (restaura
  todos os campos; preço vira "ajustado por você" p/ a cotação não sobrescrever),
  **Excluir** e **Comparar** (tabela lado a lado com scroll horizontal — mobile-first).
  Atenção: localStorage é por origem (host:porta) — perfil/histórico de
  localhost:5173 não aparecem em outra porta do dev server.
- **Perfil persistente do produtor** (`src/services/perfil.js`, localStorage
  `graocerto.perfil.v1`): na primeira visita um formulário coleta região, cultura
  principal, custos e capacidade de armazenagem; depois tudo nasce pré-preenchido e o
  produtor só ajusta o que mudou. Trocar a região sugere custos regionais de referência
  (tabela `REGIOES`, sempre editáveis). O botão "Salvar simulação" atualiza o perfil
  (cultura, sacas, meses, custos + resumo da última simulação); "Editar perfil" reabre o
  formulário. Se as sacas passam da capacidade, a interface avisa. Sem backend/contas
  ainda — quando existirem, este módulo vira a camada de sincronização.
- Este projeto nasceu de um protótipo em artifact do Claude.ai.

- **Contas + banco (Supabase)** — Fase 4, código pronto AGUARDANDO o projeto Supabase:
  arquitetura **local-first com sincronização**. Sem `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`,
  o cliente (`src/services/supabase.js`) fica null e tudo segue no localStorage (zero
  regressão — validado). Com as vars: login por **magic link** na aba Conta (sem senha,
  que é atrito pro produtor; app continua usável SEM login — decisão deliberada p/ as
  entrevistas), e perfil/simulações sincronizam nas tabelas `perfis`/`simulacoes`
  (JSONB + RLS por usuário — `supabase/migrations/00_init.sql`, ainda NÃO executada).
  Regras de sync: escrita local é síncrona + upsert fire-and-forget na nuvem; ao logar,
  a nuvem vence; nuvem vazia ← dados locais sobem. **Para ativar:** criar projeto no
  supabase.com → rodar a migração no SQL Editor → configurar as 2 vars no .env local e
  na Vercel → redeploy. O caminho de nuvem NÃO foi testado ainda (sem projeto).
- **Dashboard de 4 abas** — Fase 2 "Dashboard Real": tab bar fixa no rodapé
  (mobile-first), estado `abaAtiva` no App. **Home** = sacas totais, valor hoje,
  cotação do dia, "Recomendação do dia" (veredito consolidado) e alertas derivados do
  estado real (cotação fora, capacidade excedida, lote em zona de empate). **Operação** =
  conversa + lotes + salvar. **Inteligência** = placeholder da curva B3 (roteiro item 3)
  + histórico/comparação; "Abrir" uma simulação leva à Operação. **Conta** = FormPerfil;
  salvar ali atualiza o perfil **sem resetar os lotes em edição** (decisão deliberada —
  os custos novos valem como sugestão para os próximos lotes). Onboarding de primeira
  visita continua em tela cheia, sem abas.
- **Múltiplos lotes** (`src/services/lotes.js`) — Fase 1 "Fundação Real": a safra é um
  array de LOTES independentes `{id, cultura, sacas, precoHoje, precoEsperado, meses,
  custos, precoEditado}`. Cada lote tem cultura, preços, horizonte **e custos próprios**
  (o produtor pode ter parte em silo próprio e parte em terceiro) e é calculado
  separadamente — é assim que se simula "vendo 30% agora, seguro 70%". A interface
  permite adicionar (herda cultura/custos do último), editar e excluir (mínimo 1 lote).
  Com 2+ lotes aparece o painel "Safra inteira" com a soma; ele **não** tem preço de
  empate consolidado de propósito (lotes podem ter culturas e preços diferentes).
  O modelo de cálculo saiu do componente para `calcularLote()` **sem nenhuma alteração
  de fórmula**.
- **Frase de recomendação** (`frase_recomendacao`): abaixo do veredito de cada lote, uma
  orientação em linguagem de produtor ("Venda agora: segurar 10.000 sacas por 6 meses
  consome R$ 172.227 e a saca só empata a R$ 164,19…").
  - **O app calcula, a IA só veste.** Todos os números vão prontos para o modelo
    (`retratoParaIA()`), com instrução explícita de nunca calcular nem inventar valor —
    assim nenhum número exibido pode ser alucinado. Isso é o que concilia a frase com a
    convenção "nunca apresentar como recomendação de investimento": ela explica a conta
    de custo do próprio app, e o aviso legal segue na tela.
  - Gerada **sob demanda** (botão "Explicar decisão"), não a cada tecla — cada frase é
    uma chamada de IA. Ao mudar qualquer entrada do lote, a frase é marcada como
    desatualizada (comparação de assinatura) e o botão vira "Atualizar orientação".
  - Sem IA/backend: `fraseLocalRecomendacao()` monta a frase por template a partir dos
    mesmos números (3 variantes: vender, armazenar, zona cinzenta).

## Modelo de cálculo (núcleo do produto — não alterar sem discutir)
- Receita hoje = preço_hoje × sacas
- Perda técnica composta: perdaTotal = 1 − (1 − perdaMes)^meses
- Custo de armazenagem = custo_por_saca_mês × meses × sacas
- Custo do capital = receita_hoje × ((1 + juros_mês)^meses − 1)
- Receita futura líquida = preço_esperado × sacas_finais − armazenagem − capital
- Preço de empate = (receita_hoje + armazenagem + capital) / sacas_finais
- Zona cinzenta: |vantagem| < R$ 2/saca → alertar o usuário, não dar veredito forte.

## Próximos passos técnicos (nesta ordem)
1. ~~Estruturar como projeto Vite + React, componente integrado, rodando com `npm run dev`.~~ ✅ Feito.
2. ~~Serviço de cotações: indicadores diários CEPEA/Esalq (soja Paranaguá, milho ESALQ/BM&F)
   para substituir o preço manual, com fallback manual.~~ ✅ Feito — inclui o backend leve
   `server/cotacoes-proxy.mjs` puxando o dado **ao vivo** do CEPEA. Pendências menores:
   - Ao **deploy** (passo 5), o proxy precisa virar função serverless (ex.: `/api` na Vercel)
     e apontar `VITE_COTACOES_ENDPOINT` para ela em produção; hoje o dado ao vivo só roda
     em dev (`dev:all`). Sem isso, produção usa o snapshot. O mesmo vale para
     `/api/interpretar*` (entrada conversacional), com `ANTHROPIC_API_KEY` como env da função.
   - Considerar respeitar mais o CEPEA: cache compartilhado/mais longo, e um cron diário que
     também atualiza `public/cotacoes.json` (mantém o fallback fresco).
3. ~~Curva de futuros B3 para sugerir o preço esperado por vencimento.~~ ✅ Feito (Fase 5):
   - **Fonte (descoberta empírica, jul/2026):** Boletim Diário da B3
     (`arquivos.b3.com.br/bdi/table/ConsolidatedTradesDerivativesAfter/{dia}/{dia}/1/1000`,
     POST com corpo `{}`) — a tabela "não regular" é MINÚSCULA (~44 linhas) e tem
     justamente os futuros de grão: **CCM** (milho, R$/saca) e **SJC** (soja Chicago,
     **USD/saca** — converter com câmbio; usamos AwesomeAPI USD-BRL). A tabela principal
     (7.800 linhas) NÃO tem os futuros puros de grão, só as opções. Server-side funciona
     com cabeçalhos de navegador. O backend volta até 7 dias procurando o último pregão
     publicado com grãos; cache 30 min + stale.
   - `obterFuturosB3()` no nucleo, `GET /api/futuros` (dev + serverless),
     `src/services/futuros.js` no front (`buscarFuturos` + `precoSugerido`).
   - **Operação**: o preço esperado do lote é sugerido pelo contrato com vencimento mais
     próximo do horizonte (selo "Sugerido pelo contrato B3 SJCF27 (Jan/27)"); mexeu no
     slider → `precoEsperadoEditado` e vira "ajustado por você" com botão "Usar contrato".
     Sem curva (B3 fora/sem backend) → palpite manual de sempre, com aviso.
   - **Inteligência**: gráficos Recharts das duas curvas com o spot CEPEA como ponto
     "Hoje". (Recharts pesou o bundle: ~200 KB gzip total; se doer no 3G, lazy-load.)
   *(o item 5, deploy, foi adiantado — ver abaixo)*
4. ~~Persistência simples das simulações do produtor (começar com backend leve ou local).~~
   ✅ Feito em localStorage: perfil persistente (região, cultura, custos, capacidade,
   defaults regionais) + histórico das últimas 5 simulações com revisitar/comparar.
   Fica para depois: contas + sincronização via backend (quando houver login).
5. ~~Preparar deploy (Vercel) para enviar link nas entrevistas de validação com produtores.~~
   ✅ Publicado (jul/2026) no projeto **graocerto** do time Vercel `vortex-pay`, via deploy
   direto de arquivos (conector claude.ai; ainda sem git conectado):
   **https://graocerto-vortex-pay.vercel.app**
   - Front estático (Vite) + funções serverless `api/*.mjs` sobre `server/nucleo.mjs`.
   - Pendências manuais no painel da Vercel (Settings do projeto):
     1. **Deployment Protection → Vercel Authentication → Disabled** — vem LIGADA por
        padrão e bloqueia o site/APIs para visitantes (o link só abre pro dono logado).
     2. **Environment Variables → ANTHROPIC_API_KEY** — sem ela, texto cai nas regras
        e foto de romaneio/NF fica indisponível em produção (degradação já tratada).
     3. **Git → Connect** ao repositório GitHub quando criado (aí todo push publica).
   - Deploys futuros: conectar o GitHub (acima) ou repetir o deploy direto.

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
