# Mapa_clientes_allcanci Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mapa do Brasil no GitHub Pages com clientes Allcanci como canetas de quadro branco coloridas por etapa comercial, atualizado por script local + push.

**Architecture:** Site estático (Leaflet, sem tiles) lendo GeoJSONs versionados; pipeline Python único (`scripts/atualizar_clientes.py`) que busca 7 etapas do pipeline Comercial no Bitrix via webhook local, geocodifica por cidade/bairro com cache Nominatim e gera os arquivos de dados.

**Tech Stack:** Python 3.11 (stdlib apenas), Leaflet 1.9.4 vendorizado, leaflet-simple-map-screenshoter vendorizado, GitHub Pages (branch main), API IBGE malhas, Nominatim/OSM.

## Global Constraints

- Webhook lido de `../webhook.md` (fora do repo); NUNCA commitar o webhook.
- Etapas: WON, UC_Z5X73F, UC_U098BX, UC_EPO88F, UC_59MDOM, UC_P9UM87, UC_Z53JVP (CATEGORY_ID=0). NEW e LOSE excluídos.
- Cores: Concluído #2F9E44, Assinatura #1C7ED6, Licitação #E03131, Fechamento #7B2CBF, Negociação #F76707, A Visitar #0C8599, Contato Futuro #868E96.
- Nominatim: 1,1 s entre requisições, User-Agent "mapa-clientes-allcanci/1.0 (github pages build)".
- Sem CDN no site: Leaflet e plugin de captura vendorizados em `vendor/`.
- Interação: apenas tooltip (nome do cliente) no hover; sem popup.
- Python stdlib somente (urllib, json, hashlib, unicodedata, time, pathlib, math).

---

### Task 1: Pipeline `scripts/atualizar_clientes.py` + testes das funções puras

**Files:**
- Create: `scripts/atualizar_clientes.py`
- Create: `scripts/test_atualizar_clientes.py`
- Create: `.gitignore` (conteúdo: `__pycache__/`)

**Interfaces (Produces):**
- `STAGES: list[dict]` — cada item: `{"id","stage_id","label","color","priority"}`, priority 1=Concluído … 7=Contato Futuro (menor = mais avançada).
- `normalize_uf(value: str) -> str` — "Minas Gerais"/"MG"/"mg " → "MG"; desconhecido → "".
- `cache_key(neighborhood: str, city: str, uf: str) -> str` — minúsculas, espaços colapsados: `"bairro|cidade|uf"` (bairro/uf podem ser vazios).
- `pick_best_stage(stage_ids: list[str]) -> dict` — retorna o STAGE de menor priority presente.
- `jitter(lat, lng, name, index) -> (lat, lng)` — espiral determinística (hash MD5 do nome + índice), raio ≤ 0.02°.
- `fix_mojibake(text: str) -> str` — latin1→utf-8 se marcadores "Ã|â|�".
- CLI `python scripts/atualizar_clientes.py` gera `data/clientes.json`, `data/clients.geojson`, `data/build-report.json` e baixa `data/brasil-estados.geojson` se ausente.
- Formato `data/clientes.json`: `{"generated_at", "clients": [{"name","street","neighborhood","city","uf","stage_id","stage_label","company_id","deal_ids"}]}`.
- Formato `clients.geojson`: FeatureCollection; feature.properties = `{"name","stage","label","color"}`; geometry Point [lng, lat].
- Formato `build-report.json`: `{"generated_at","total_clients","published","ignored_count","counts_por_etapa":{label:int},"ignored":[{"name","reason"}]}`.

**Steps:**

- [ ] **Step 1:** Escrever `scripts/test_atualizar_clientes.py` com testes unittest para `normalize_uf` ("Minas Gerais"→"MG", "SP"→"SP", ""→""), `cache_key` ("CENTRO ", "Joaíma", "MG" → "centro|joaíma|mg"), `pick_best_stage` (["UC_P9UM87","WON"]→id "concluido"), `jitter` (determinístico: mesma entrada → mesma saída; distância ≤ 0.03°; entradas distintas → saídas distintas), `fix_mojibake` ("JoÃ£o"→"João").
- [ ] **Step 2:** Rodar `python -m unittest scripts/test_atualizar_clientes.py -v` → FAIL (módulo sem funções).
- [ ] **Step 3:** Implementar o script completo: leitura do webhook (regex do projeto Planilhas), `call_bitrix`/`batch_bitrix` (urllib), fetch das 7 etapas paginado com select dos campos de endereço (DEAL_FIELDS/COMPANY_FIELDS do script Planilhas + `UF_CRM_1721160103801`, `UF_CRM_1725646961`, `ADDRESS_PROVINCE`, `ADDRESS_CITY`), resolução dos enums de Estado via `crm.company.fields`, montagem de cliente com fallbacks (físico→CNPJ→deal→padrão), dedupe por company_id/nome+cidade com `pick_best_stage`, filtro nome+cidade, geocodificação com cache (`data/source/geocode_cache.json`, tenta bairro+cidade+UF → cidade+UF → cidade+Brasil; extrai UF do display_name quando faltar), jitter em coordenadas duplicadas, escrita dos 3 arquivos + download IBGE `https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF` se `data/brasil-estados.geojson` ausente, resumo final com lembrete de push.
- [ ] **Step 4:** Rodar testes → PASS.
- [ ] **Step 5:** Commit `feat: pipeline de atualização de clientes via Bitrix`.

### Task 2: Semear cache de geocodificação a partir do mapa MG

**Files:**
- Create: `data/source/geocode_cache.json` (gerado por comando único)

**Interfaces:**
- Consumes: `cache_key` (Task 1). Chave MG `"bairro|cidade"` vira `"bairro|cidade|mg"`; entradas com `source=="city"` também geram `"|cidade|mg"`.

**Steps:**

- [ ] **Step 1:** Script inline (heredoc) que lê `../mapa_Allcanci_MG/data/source/neighborhood_geocode_cache.json`, converte chaves e grava `data/source/geocode_cache.json` mantendo `{status,lat,lng,source,query,display_name}`.
- [ ] **Step 2:** Validar: `python -c` contando entradas convertidas (> 200 esperado).
- [ ] **Step 3:** Commit `feat: cache de geocodificação herdado do mapa MG`.

### Task 3: Rodar o pipeline real (Bitrix + geocodificação + IBGE)

**Steps:**

- [ ] **Step 1:** `python scripts/atualizar_clientes.py` (rodar em background; pode levar minutos na 1ª execução).
- [ ] **Step 2:** Conferir `data/build-report.json`: contagens por etapa plausíveis vs Bitrix (~Concluído 592, Negociação 1911, A Visitar 929…); `ignored` inspecionado.
- [ ] **Step 3:** Validar GeoJSONs: `python -c` carregando os dois arquivos, checando type=FeatureCollection, todas as coords dentro do bounding box do Brasil (lat -34..6, lng -74..-32).
- [ ] **Step 4:** Commit `data: primeira carga de clientes do Bitrix`.

### Task 4: Vendorizar Leaflet e plugin de captura

**Files:**
- Create: `vendor/leaflet/leaflet.js`, `vendor/leaflet/leaflet.css` (1.9.4, unpkg)
- Create: `vendor/leaflet-simple-map-screenshoter.js` (unpkg dist)

**Steps:**

- [ ] **Step 1:** Baixar com Invoke-WebRequest; conferir tamanhos (>100 KB leaflet.js).
- [ ] **Step 2:** Commit `chore: vendor Leaflet 1.9.4 e screenshoter`.

### Task 5: Site (index.html, styles.css, app.js)

**Files:**
- Create: `index.html`, `styles.css`, `app.js`, `.nojekyll`, `README.md`

**Interfaces:**
- Consumes: `data/clients.geojson` (properties name/stage/label/color), `data/brasil-estados.geojson`, `data/build-report.json` (generated_at, counts_por_etapa), STAGES/cores do Global Constraints.
- Produces: `window.print()` via botão `#btn-print`; captura PNG via `#btn-shot` (SimpleMapScreenshoter); legenda `#legend` com checkbox por etapa (uma `L.layerGroup` por etapa); ícone = `L.divIcon` classe `pen-icon` com SVG inline de caneta de quadro branco (corpo na cor da etapa, ponta escura, tampa clara), âncora na ponta; tamanho controlado por CSS var `--pen-size` atualizada em `zoomend` (zoom ≤4: 12px, 5: 16px, 6: 20px, 7: 24px, ≥8: 30px).

**Steps:**

- [ ] **Step 1:** `index.html` — header (título, "Atualizado em", botões Imprimir/Capturar), `#map`, `#legend`; sem nenhum recurso externo (só vendor/ e data/).
- [ ] **Step 2:** `styles.css` — layout flex responsivo (legenda vira painel colapsável < 720px), fundo do mapa `#dbe9f4` (mar), estados `#f8f9fa` com divisas `#5c677d`, `@media print` (esconde botões/zoom, mapa + legenda em página paisagem).
- [ ] **Step 3:** `app.js` — carga dos 3 JSONs, mapa sem tiles com `maxBounds` Brasil, camada estados, grupos por etapa com divIcons + tooltips, legenda com contagens, redimensionamento por zoom, botões.
- [ ] **Step 4:** `README.md` — o que é, como atualizar (script + push), links produção.
- [ ] **Step 5:** Commit `feat: site do mapa de clientes`.

### Task 6: Verificação local

**Steps:**

- [ ] **Step 1:** `python -m http.server 8123` em background na pasta do projeto.
- [ ] **Step 2:** `Invoke-WebRequest` em `/`, `/app.js`, `/data/clients.geojson` → 200.
- [ ] **Step 3:** Screenshot headless: `msedge --headless=new --screenshot --window-size=1500,950 http://127.0.0.1:8123/` e inspecionar a imagem (mapa renderizado, ícones coloridos, legenda, sem erros visíveis).
- [ ] **Step 4:** Corrigir o que a inspeção visual revelar; re-screenshot até OK.

### Task 7: Publicar no GitHub Pages

**Steps:**

- [ ] **Step 1:** `gh auth status` (fallback: instruir criação manual se gh indisponível).
- [ ] **Step 2:** `gh repo create Mapa_clientes_allcanci --public --source . --push`.
- [ ] **Step 3:** Habilitar Pages: `gh api -X POST repos/tarikdsm/Mapa_clientes_allcanci/pages -f "source[branch]=main" -f "source[path]=/"`.
- [ ] **Step 4:** Aguardar build e validar `https://tarikdsm.github.io/Mapa_clientes_allcanci/` → 200 + screenshot headless da URL de produção.

## Self-Review

- Spec coverage: 7 etapas/cores (T1/T5), banco local simples (T1), cache herdado (T2), carga real (T3), mapa limpo IBGE + canetas + tooltip + legenda + impressão + captura + responsivo (T4/T5), validação (T6), repo público + Pages (T7). Botão de atualização no site: fora do escopo por decisão do usuário (script manual). OK.
- Placeholders: nenhum "TBD"; código dos testes definido no Task 1 Step 1; arquivos grandes especificados por interface exata. OK.
- Consistência de tipos: propriedades GeoJSON (name/stage/label/color) iguais em T1 e T5; `--pen-size`/`pen-icon` consistentes. OK.
