# Design: Mapa_clientes_allcanci

Data: 2026-07-14
Status: Aprovado pelo usuário (Tarik) em entrevista de brainstorming.

## Objetivo

Mapa do Brasil interativo, responsivo e imprimível, publicado no GitHub Pages, mostrando
todos os clientes da Allcanci (efetivados e em fases de prospecção/negociação/contratação)
como ícones de caneta de quadro branco coloridos por etapa comercial, com tooltip do nome
do cliente ao passar o mouse. Clientes cancelados não aparecem.

## Decisões da entrevista

| Tema | Decisão |
| --- | --- |
| Etapas incluídas | 7 etapas do pipeline Comercial: Concluído (WON), Assinatura de Contrato (UC_Z5X73F), Licitação/Publicação (UC_U098BX), Fechamento (UC_EPO88F), Em Negociação (UC_59MDOM), A Visitar (UC_P9UM87), Contato Futuro (UC_Z53JVP). Excluídos: Dados Importados (NEW) e Cancelado (LOSE). |
| Atualização | Script manual local (`python scripts/atualizar_clientes.py`) + `git push`. Sem botão no site público (webhook nunca exposto). O site mostra "Atualizado em <data>". |
| Ícone | Caneta de quadro branco em SVG, colorida pela etapa. |
| Fundo do mapa | Mapa limpo: contorno do Brasil + divisas estaduais (IBGE), sem tiles de ruas. |
| Densidade | Sem clusters: todos os ícones sempre visíveis, tamanho escala com o zoom. |
| Motor | Leaflet, reaproveitando padrões do projeto `mapa_Allcanci_MG`. |
| Interação | Somente tooltip com nome do cliente no hover. Sem popup de clique. |
| Geocodificação | Precisão de cidade é suficiente. Bairro usado quando disponível. |

## Cores por etapa

| Etapa | Cor |
| --- | --- |
| Concluído (já cliente) | Verde `#2F9E44` |
| Assinatura de Contrato | Azul `#1C7ED6` |
| Licitação/Publicação | Vermelho `#E03131` |
| Fechamento | Roxo `#7B2CBF` |
| Em Negociação | Laranja `#F76707` |
| A Visitar | Ciano `#0C8599` |
| Contato Futuro | Cinza `#868E96` |

## Arquitetura

Subdiretório `Mapa_clientes_allcanci` em `D:\Projetos TI\Allcanci\API Bitrix`, repositório
git próprio publicado em `github.com/tarikdsm/Mapa_clientes_allcanci` (público) com GitHub
Pages servindo a branch `main` → `https://tarikdsm.github.io/Mapa_clientes_allcanci/`.

```
Mapa_clientes_allcanci/
  index.html            # shell da aplicação
  app.js                # mapa Leaflet, ícones, tooltips, legenda, impressão/captura
  styles.css            # layout responsivo + CSS de impressão
  vendor/               # Leaflet e plugin de captura salvos no repo (sem CDN)
  scripts/atualizar_clientes.py   # pipeline completo de atualização
  data/clientes.json    # "banco" local simples: nome, endereço p/ geocodificação, etapa
  data/clients.geojson  # pontos consumidos pelo site
  data/brasil-estados.geojson     # malha IBGE das 27 UFs (baixada 1x, versionada)
  data/build-report.json          # timestamp, contagens por etapa, ignorados
  data/source/geocode_cache.json  # cache Nominatim (chave: bairro|cidade|uf e cidade|uf)
  docs/                 # este spec e plano
```

## Pipeline de atualização (scripts/atualizar_clientes.py)

1. Lê o webhook de `../webhook.md` (diretório pai, FORA do repositório — nunca publicado).
   Regex: `https://[^\s]+/rest/\d+/[A-Za-z0-9_]+/`.
2. Busca `crm.deal.list` paginado, `CATEGORY_ID=0`, filtrando por cada uma das 7 etapas.
   Resolve empresas via `batch` de `crm.company.get` em lotes de 50.
3. Endereço com cadeias de fallback (físico → CNPJ → deal → padrão), reaproveitadas de
   `Planilhas_Clientes/generate_client_stage_workbook.py`.
4. UF: `UF_CRM_1721160103801` (Estado Físico, enum) → `UF_CRM_1725646961` (Estado CNPJ,
   enum) → `ADDRESS_PROVINCE`. Enums resolvidos via `crm.company.fields`. Sem UF → tenta
   geocodificar só por cidade no Brasil; a UF retornada pelo Nominatim é usada.
5. Deduplicação por `COMPANY_ID` (ou nome+cidade normalizados). Empresa com negócios em
   várias etapas fica na etapa mais avançada (Concluído > Assinatura > Licitação >
   Fechamento > Negociação > A Visitar > Contato Futuro).
6. Filtro mínimo: nome + cidade (precisão de cidade basta; não exige rua/bairro).
7. Geocodificação Nominatim (1,1 s entre chamadas, User-Agent próprio), cache versionado.
   Cache inicial herdado de `mapa_Allcanci_MG` (chaves convertidas para `…|mg`).
   Espalhamento determinístico (hash do nome) de ~±0,02° para clientes na mesma coordenada.
8. Correção de mojibake (latin1→utf-8) reaproveitada do pipeline MG.
9. Saídas: `data/clientes.json`, `data/clients.geojson`, `data/build-report.json`.
   `data/brasil-estados.geojson` baixado da API de malhas do IBGE
   (`/api/v3/malhas/paises/BR?intrarregiao=UF`) apenas se ausente.
10. Ao final imprime resumo e lembrete de `git add/commit/push`.

## Site

- Leaflet sem tile layer; fundo claro; camada GeoJSON dos estados com divisas bem visíveis;
  `fitBounds`/`maxBounds` no Brasil.
- Marcadores `L.divIcon` com SVG inline da caneta; tamanho por faixa de zoom
  (visão Brasil pequena → zoom próximo maior); `bindTooltip(nome)` no hover.
- Legenda fixa com cor, nome da etapa, contagem e checkbox liga/desliga por etapa
  (uma `L.layerGroup` por etapa).
- Cabeçalho: título + "Atualizado em <data do build-report>" + botões Imprimir e
  Capturar PNG.
- Impressão: `window.print()` + `@media print` (esconde controles, mantém mapa + legenda).
- Captura: plugin `leaflet-simple-map-screenshoter` vendorizado, download de PNG.
- Responsivo: layout flexível, legenda colapsável em telas pequenas.

## Erros e limites

- Nominatim ~1 req/s: primeira execução com muitas cidades novas pode demorar minutos;
  seguintes são rápidas (cache).
- Cliente sem cidade não aparece no mapa; entra no build-report com nome e motivo.
- Repositório público: nomes de clientes e cidades ficam públicos (mesmo modelo já usado
  no mapa MG).

## Validação

- Contagens do build-report conferidas com o Bitrix a cada execução.
- Validação local com `python -m http.server` antes do push (visual, tooltips, impressão,
  captura).
