# Mapa de Clientes — Allcanci

Mapa do Brasil interativo publicado no GitHub Pages com todos os clientes da Allcanci
(efetivados e em fases de prospecção/negociação/contratação), como ícones de caneta de
quadro branco coloridos por etapa comercial. Clientes cancelados não aparecem.

## Links

- Produção: <https://tarikdsm.github.io/Mapa_clientes_allcanci/>
- Repositório: <https://github.com/tarikdsm/Mapa_clientes_allcanci>

## Etapas e cores

| Etapa | Cor |
| --- | --- |
| Concluído (já cliente) | 🟢 Verde `#2F9E44` |
| Assinatura de Contrato | 🔵 Azul `#1C7ED6` |
| Licitação/Publicação | 🔴 Vermelho `#E03131` |
| Fechamento | 🟣 Roxo `#7B2CBF` |
| Em Negociação | 🟠 Laranja `#F76707` |
| A Visitar | Ciano `#0C8599` |
| Contato Futuro | ⚪ Cinza `#868E96` |

## Como atualizar os clientes

O GitHub Pages é estático: a atualização é feita localmente e publicada com um push.

Pré-requisito: o arquivo `webhook.md` com o webhook do Bitrix deve existir no diretório
**pai** deste repositório (ele nunca é publicado).

```powershell
python -X utf8 scripts\atualizar_clientes.py
git add data
git commit -m "data: atualiza clientes"
git push
```

O script:

1. Busca no Bitrix os negócios do pipeline Comercial nas 7 etapas ativas
   (exclui "Dados Importados" e "Cancelado").
2. Gera `data/clientes.json` — banco local simples (nome, endereço para geolocalização, etapa).
3. Geocodifica cidade/bairro via Nominatim com cache em `data/source/geocode_cache.json`
   (precisão em nível de cidade; execuções seguintes são rápidas).
4. Gera `data/clients.geojson` (pontos do mapa) e `data/build-report.json`
   (data, contagens por etapa, ignorados).

## Executar localmente

```powershell
python -m http.server 8123
# abrir http://127.0.0.1:8123/
```

## Estrutura

- `index.html`, `app.js`, `styles.css` — site estático (Leaflet vendorizado, sem CDN)
- `scripts/atualizar_clientes.py` — pipeline de atualização
- `scripts/test_atualizar_clientes.py` — testes (`python -m unittest`) das funções puras
- `data/` — dados versionados consumidos pelo site
- `vendor/` — Leaflet 1.9.4 e plugin de captura PNG
- `docs/superpowers/` — spec de design e plano de implementação

## Recursos do site

- Tooltip com o nome do cliente ao passar o mouse no ícone
- Legenda com contagem e liga/desliga por etapa
- Botão Imprimir (CSS de impressão dedicado, A4 paisagem)
- Botão Capturar PNG (download da imagem do mapa)
- Responsivo (desktop, tablet e celular)
