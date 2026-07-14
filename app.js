/* Mapa de Clientes Allcanci — estados IBGE texturizados + canvas único de alta
   performance para canetas, siglas de UF e capitais. */
(function () {
  "use strict";

  var STAGES = [
    { id: "concluido", label: "Concluído (cliente)", color: "#2F9E44" },
    { id: "assinatura", label: "Assinatura de Contrato", color: "#1C7ED6" },
    { id: "licitacao", label: "Licitação/Publicação", color: "#E03131" },
    { id: "fechamento", label: "Fechamento", color: "#7B2CBF" },
    { id: "negociacao", label: "Em Negociação", color: "#F76707" },
    { id: "a_visitar", label: "A Visitar", color: "#0C8599" },
    { id: "contato_futuro", label: "Contato Futuro", color: "#868E96" }
  ];

  var UF_BY_CODAREA = {
    "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP",
    "17": "TO", "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB",
    "26": "PE", "27": "AL", "28": "SE", "29": "BA", "31": "MG", "32": "ES",
    "33": "RJ", "35": "SP", "41": "PR", "42": "SC", "43": "RS", "50": "MS",
    "51": "MT", "52": "GO", "53": "DF"
  };

  var CAPITAIS = [
    { name: "Rio Branco", lat: -9.9747, lng: -67.81 },
    { name: "Maceió", lat: -9.6499, lng: -35.7089 },
    { name: "Macapá", lat: 0.0349, lng: -51.0694 },
    { name: "Manaus", lat: -3.119, lng: -60.0217 },
    { name: "Salvador", lat: -12.9714, lng: -38.5014 },
    { name: "Fortaleza", lat: -3.7319, lng: -38.5267 },
    { name: "Brasília", lat: -15.7939, lng: -47.8828 },
    { name: "Vitória", lat: -20.3155, lng: -40.3128 },
    { name: "Goiânia", lat: -16.6869, lng: -49.2648 },
    { name: "São Luís", lat: -2.5307, lng: -44.3068 },
    { name: "Cuiabá", lat: -15.6014, lng: -56.0979 },
    { name: "Campo Grande", lat: -20.4697, lng: -54.6201 },
    { name: "Belo Horizonte", lat: -19.9167, lng: -43.9345 },
    { name: "Belém", lat: -1.4558, lng: -48.4902 },
    { name: "João Pessoa", lat: -7.1195, lng: -34.845 },
    { name: "Curitiba", lat: -25.4284, lng: -49.2733 },
    { name: "Recife", lat: -8.0476, lng: -34.877 },
    { name: "Teresina", lat: -5.0892, lng: -42.8019 },
    { name: "Rio de Janeiro", lat: -22.9068, lng: -43.1729 },
    { name: "Natal", lat: -5.7945, lng: -35.211 },
    { name: "Porto Alegre", lat: -30.0346, lng: -51.2177 },
    { name: "Porto Velho", lat: -8.7612, lng: -63.9004 },
    { name: "Boa Vista", lat: 2.8235, lng: -60.6758 },
    { name: "Florianópolis", lat: -27.5954, lng: -48.548 },
    { name: "São Paulo", lat: -23.5505, lng: -46.6333 },
    { name: "Aracaju", lat: -10.9472, lng: -37.0731 },
    { name: "Palmas", lat: -10.1689, lng: -48.3317 }
  ];

  var BRAZIL_BOUNDS = L.latLngBounds([-36, -76], [8, -30]);
  var FONT_STACK = '"Segoe UI", system-ui, -apple-system, sans-serif';

  var map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
    minZoom: 4,
    maxZoom: 12,
    maxBounds: BRAZIL_BOUNDS.pad(0.15),
    maxBoundsViscosity: 0.8,
    zoomSnap: 0.5,
    zoomAnimation: false,
    fadeAnimation: false,
    markerZoomAnimation: false,
    preferCanvas: true
  });

  function penSizeForZoom(zoom) {
    if (zoom <= 4) return 10;
    if (zoom <= 5) return 13;
    if (zoom <= 6) return 17;
    if (zoom <= 7) return 22;
    return 28;
  }

  function ufFontForZoom(zoom) {
    if (zoom <= 4) return 11;
    if (zoom <= 5) return 13;
    if (zoom <= 6) return 15;
    return 17;
  }

  function capFontForZoom(zoom) {
    if (zoom <= 4) return 10;
    if (zoom <= 5) return 11;
    if (zoom <= 6) return 12.5;
    return 14;
  }

  // ------------------------------------------------------------------
  // Sprites das canetas (um bitmap por etapa, refeito quando o zoom muda)
  // ------------------------------------------------------------------
  var DPR = Math.min(window.devicePixelRatio || 1, 2);

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Clareia (f > 1, mistura com branco) ou escurece (f < 1) uma cor hex.
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f <= 1) { r *= f; g *= f; b *= f; }
    else { var m = f - 1; r += (255 - r) * m; g += (255 - g) * m; b += (255 - b) * m; }
    return "rgb(" + Math.round(r) + "," + Math.round(g) + "," + Math.round(b) + ")";
  }

  /* Marcador de quadro branco estilo BIC, desenhado em espaço 48x80:
     tampa abaulada com clipe, corpo cilíndrico com brilho, etiqueta branca,
     anel escuro, bico cônico marfim e ponta de feltro em bala.
     Âncora: ponta em (24, 80). */
  function makePenSprite(color, size) {
    var w = size;
    var h = (size * 40) / 24; // mesma proporção 3:5 usada no hit-test
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * DPR);
    canvas.height = Math.ceil(h * DPR);
    var ctx = canvas.getContext("2d");
    ctx.scale((w * DPR) / 48, (h * DPR) / 80);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    var outline = "rgba(30,41,59,0.85)";
    var OUT_W = 2;

    function cylinderGradient(x0, x1, base) {
      var grad = ctx.createLinearGradient(x0, 0, x1, 0);
      grad.addColorStop(0, shade(base, 0.78));
      grad.addColorStop(0.28, shade(base, 1.35));
      grad.addColorStop(0.55, base);
      grad.addColorStop(1, shade(base, 0.6));
      return grad;
    }

    // sombra de contato no ponto ancorado
    ctx.beginPath();
    ctx.ellipse(24, 78.6, 7, 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(15,23,42,0.16)";
    ctx.fill();

    // bico cônico (marfim, lados côncavos)
    ctx.beginPath();
    ctx.moveTo(15, 53);
    ctx.lineTo(33, 53);
    ctx.bezierCurveTo(31.2, 61, 28.6, 65.5, 27.6, 70);
    ctx.lineTo(20.4, 70);
    ctx.bezierCurveTo(19.4, 65.5, 16.8, 61, 15, 53);
    ctx.closePath();
    var cone = ctx.createLinearGradient(15, 0, 33, 0);
    cone.addColorStop(0, "#d9d3c2");
    cone.addColorStop(0.3, "#fffdf5");
    cone.addColorStop(0.65, "#f1ecdd");
    cone.addColorStop(1, "#c9c2ae");
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.lineWidth = OUT_W;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // ponta de feltro (bala arredondada)
    ctx.beginPath();
    ctx.moveTo(20.4, 70);
    ctx.lineTo(27.6, 70);
    ctx.bezierCurveTo(27.6, 74.8, 26.2, 78, 24, 78.8);
    ctx.bezierCurveTo(21.8, 78, 20.4, 74.8, 20.4, 70);
    ctx.closePath();
    ctx.fillStyle = (function () {
      var grad = ctx.createLinearGradient(20.4, 0, 27.6, 0);
      grad.addColorStop(0, shade(color, 0.55));
      grad.addColorStop(0.4, shade(color, 0.95));
      grad.addColorStop(1, shade(color, 0.45));
      return grad;
    })();
    ctx.fill();
    ctx.lineWidth = OUT_W * 0.9;
    ctx.stroke();

    // corpo cilíndrico (leve afunilamento por Bézier)
    ctx.beginPath();
    ctx.moveTo(14.5, 20);
    ctx.lineTo(33.5, 20);
    ctx.bezierCurveTo(34.1, 30, 34, 42, 33.2, 49);
    ctx.lineTo(14.8, 49);
    ctx.bezierCurveTo(14, 42, 13.9, 30, 14.5, 20);
    ctx.closePath();
    ctx.fillStyle = cylinderGradient(14, 34, color);
    ctx.fill();
    ctx.lineWidth = OUT_W;
    ctx.stroke();

    // anel/colar escuro entre corpo e bico
    ctx.beginPath();
    ctx.moveTo(14.8, 49);
    ctx.lineTo(33.2, 49);
    ctx.lineTo(33, 53);
    ctx.lineTo(15, 53);
    ctx.closePath();
    ctx.fillStyle = (function () {
      var grad = ctx.createLinearGradient(15, 0, 33, 0);
      grad.addColorStop(0, shade(color, 0.5));
      grad.addColorStop(0.35, shade(color, 0.85));
      grad.addColorStop(1, shade(color, 0.42));
      return grad;
    })();
    ctx.fill();
    ctx.lineWidth = OUT_W * 0.9;
    ctx.stroke();

    // etiqueta branca com linhas de "texto"
    roundRectPath(ctx, 17, 30.5, 14, 12.5, 2.5);
    ctx.fillStyle = "rgba(255,255,255,0.94)";
    ctx.fill();
    ctx.lineWidth = 0.9;
    ctx.strokeStyle = "rgba(100,92,70,0.35)";
    ctx.stroke();
    ctx.strokeStyle = "rgba(100,100,110,0.4)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(19.2, 34.5); ctx.lineTo(28.8, 34.5);
    ctx.moveTo(19.2, 37.5); ctx.lineTo(26.5, 37.5);
    ctx.stroke();

    // tampa abaulada com aba inferior
    ctx.beginPath();
    ctx.moveTo(13.2, 19.6);
    ctx.lineTo(13.2, 17.4);
    ctx.lineTo(14.8, 16.4);
    ctx.lineTo(14.8, 8);
    ctx.bezierCurveTo(14.8, 3.4, 18.2, 1.8, 24, 1.8);
    ctx.bezierCurveTo(29.8, 1.8, 33.2, 3.4, 33.2, 8);
    ctx.lineTo(33.2, 16.4);
    ctx.lineTo(34.8, 17.4);
    ctx.lineTo(34.8, 19.6);
    ctx.closePath();
    ctx.fillStyle = (function () {
      var grad = ctx.createLinearGradient(13.2, 0, 34.8, 0);
      grad.addColorStop(0, shade(color, 0.72));
      grad.addColorStop(0.28, shade(color, 1.28));
      grad.addColorStop(0.55, shade(color, 0.94));
      grad.addColorStop(1, shade(color, 0.55));
      return grad;
    })();
    ctx.fill();
    ctx.lineWidth = OUT_W;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // clipe da tampa (levemente saliente à direita)
    roundRectPath(ctx, 30.9, 5.4, 3.6, 13.4, 1.7);
    ctx.fillStyle = shade(color, 0.66);
    ctx.fill();
    ctx.lineWidth = OUT_W * 0.8;
    ctx.stroke();

    // brilho especular na tampa e no corpo
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(17.6, 5.6);
    ctx.bezierCurveTo(16.8, 8, 16.8, 12, 17.2, 14.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.moveTo(17.4, 22.5);
    ctx.bezierCurveTo(16.9, 28, 16.9, 42, 17.4, 47);
    ctx.stroke();

    return { canvas: canvas, w: w, h: h };
  }

  var sprites = {};
  var spriteSize = 0;
  function ensureSprites() {
    var size = penSizeForZoom(map.getZoom());
    if (size === spriteSize) return;
    spriteSize = size;
    STAGES.forEach(function (stage) {
      sprites[stage.id] = makePenSprite(stage.color, size);
    });
  }

  // ------------------------------------------------------------------
  // Canvas único sobre o mapa
  // ------------------------------------------------------------------
  var mapDiv = document.getElementById("map");
  var canvas = document.createElement("canvas");
  canvas.className = "pen-canvas";
  mapDiv.appendChild(canvas);
  var ctx = canvas.getContext("2d");

  var tooltip = document.createElement("div");
  tooltip.id = "hover-tip";
  tooltip.setAttribute("hidden", "");
  mapDiv.appendChild(tooltip);

  var clientPoints = []; // {latlng, name, stage, color, label}
  var ufLabels = [];     // {latlng, sigla}
  var stageVisible = {};
  STAGES.forEach(function (stage) { stageVisible[stage.id] = true; });

  var projected = []; // pontos visíveis projetados no frame atual (para hover)

  function resizeCanvas() {
    var rect = mapDiv.getBoundingClientRect();
    canvas.width = Math.ceil(rect.width * DPR);
    canvas.height = Math.ceil(rect.height * DPR);
    canvas.style.width = rect.width + "px";
    canvas.style.height = rect.height + "px";
  }

  function haloText(text, x, y, font, fill, align) {
    ctx.font = font;
    ctx.textAlign = align || "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "rgba(255,255,255,0.88)";
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  function redraw() {
    var rect = mapDiv.getBoundingClientRect();
    if (
      canvas.width !== Math.ceil(rect.width * DPR) ||
      canvas.height !== Math.ceil(rect.height * DPR)
    ) {
      resizeCanvas();
    }
    ensureSprites();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var zoom = map.getZoom();
    var w = canvas.width / DPR;
    var h = canvas.height / DPR;
    var margin = 40;

    // 1) canetas (ordenadas por y para sobreposição natural norte→sul)
    projected = [];
    clientPoints.forEach(function (point) {
      if (!stageVisible[point.stage]) return;
      var cp = map.latLngToContainerPoint(point.latlng);
      if (cp.x < -margin || cp.x > w + margin || cp.y < -margin || cp.y > h + margin) return;
      projected.push({ x: cp.x, y: cp.y, point: point });
    });
    projected.sort(function (a, b) { return a.y - b.y; });
    projected.forEach(function (item) {
      var sprite = sprites[item.point.stage];
      ctx.drawImage(
        sprite.canvas,
        item.x - sprite.w / 2,
        item.y - sprite.h,
        sprite.w,
        sprite.h
      );
    });

    // 2) siglas das UFs
    var ufFont = "700 " + ufFontForZoom(zoom) + "px " + FONT_STACK;
    ufLabels.forEach(function (label) {
      var cp = map.latLngToContainerPoint(label.latlng);
      if (cp.x < -margin || cp.x > w + margin || cp.y < -margin || cp.y > h + margin) return;
      haloText(label.sigla, cp.x, cp.y, ufFont, "rgba(92,82,59,0.9)");
    });

    // 3) capitais (símbolo + nome)
    var capFont = "600 " + capFontForZoom(zoom) + "px " + FONT_STACK;
    var r = zoom <= 4 ? 3.5 : zoom <= 5 ? 4 : 5;
    CAPITAIS.forEach(function (capital) {
      var cp = map.latLngToContainerPoint(L.latLng(capital.lat, capital.lng));
      if (cp.x < -margin || cp.x > w + margin || cp.y < -margin || cp.y > h + margin) return;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#4a4130";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = "#4a4130";
      ctx.fill();
      haloText(capital.name, cp.x + r + 4, cp.y, capFont, "#3d3527", "left");
    });
  }

  var frameQueued = false;
  function scheduleRedraw() {
    if (frameQueued) return;
    frameQueued = true;
    requestAnimationFrame(function () {
      frameQueued = false;
      redraw();
    });
  }

  map.on("move zoom viewreset", scheduleRedraw);
  map.on("resize", function () { resizeCanvas(); scheduleRedraw(); });

  // ------------------------------------------------------------------
  // Hover: hit-test no canvas
  // ------------------------------------------------------------------
  function findPenAt(containerPoint) {
    var best = null;
    var bestDist = Infinity;
    var w = spriteSize;
    var h = (spriteSize * 40) / 24;
    for (var i = projected.length - 1; i >= 0; i--) {
      var item = projected[i];
      var dx = containerPoint.x - item.x;
      var dy = containerPoint.y - item.y;
      if (dx < -w / 2 - 2 || dx > w / 2 + 2 || dy < -h - 2 || dy > 2) continue;
      var dist = dx * dx + (dy + h / 2) * (dy + h / 2);
      if (dist < bestDist) {
        bestDist = dist;
        best = item;
      }
    }
    return best;
  }

  function showTooltip(item) {
    tooltip.innerHTML =
      '<strong>' + escapeHtml(item.point.name) + "</strong>" +
      '<span class="tip-stage"><span class="tip-dot" style="background:' +
      item.point.color + '"></span>' + escapeHtml(item.point.label) + "</span>";
    tooltip.style.left = item.x + "px";
    tooltip.style.top = (item.y - (spriteSize * 40) / 24 - 6) + "px";
    tooltip.removeAttribute("hidden");
  }

  function hideTooltip() {
    tooltip.setAttribute("hidden", "");
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  var dragging = false;
  map.on("dragstart", function () { dragging = true; });
  map.on("dragend", function () { dragging = false; });

  map.on("mousemove", function (event) {
    if (dragging) return;
    var item = findPenAt(event.containerPoint);
    if (item) {
      showTooltip(item);
      mapDiv.style.cursor = "pointer";
    } else {
      hideTooltip();
      mapDiv.style.cursor = "";
    }
  });
  map.on("mouseout movestart zoomstart", hideTooltip);
  map.on("click", function (event) { // toque em celular
    var item = findPenAt(event.containerPoint);
    if (item) showTooltip(item); else hideTooltip();
  });

  // ------------------------------------------------------------------
  // Centroide (maior anel) para posicionar a sigla da UF
  // ------------------------------------------------------------------
  function ringAreaCentroid(ring) {
    var area = 0, cx = 0, cy = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      var cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      area += cross;
      cx += (ring[i][0] + ring[i + 1][0]) * cross;
      cy += (ring[i][1] + ring[i + 1][1]) * cross;
    }
    area /= 2;
    if (Math.abs(area) < 1e-9) return null;
    return { area: Math.abs(area), lng: cx / (6 * area), lat: cy / (6 * area) };
  }

  function featureLabelPoint(geometry) {
    var rings = [];
    if (geometry.type === "Polygon") rings = [geometry.coordinates[0]];
    else if (geometry.type === "MultiPolygon") {
      rings = geometry.coordinates.map(function (poly) { return poly[0]; });
    }
    var best = null;
    rings.forEach(function (ring) {
      var c = ringAreaCentroid(ring);
      if (c && (!best || c.area > best.area)) best = c;
    });
    return best ? L.latLng(best.lat, best.lng) : null;
  }

  // ------------------------------------------------------------------
  // Textura de papel bege no continente (pattern SVG injetado no Leaflet)
  // ------------------------------------------------------------------
  function applyLandTexture(statesLayer) {
    var svg = map.getPane("overlayPane").querySelector("svg");
    if (!svg) return;
    var svgNS = "http://www.w3.org/2000/svg";
    var defs = document.createElementNS(svgNS, "defs");
    defs.innerHTML =
      '<pattern id="landtex" width="14" height="14" patternUnits="userSpaceOnUse">' +
      '<rect width="14" height="14" fill="#efe7d3"/>' +
      '<circle cx="3" cy="4" r="0.9" fill="rgba(140,118,78,0.07)"/>' +
      '<circle cx="10" cy="10" r="0.7" fill="rgba(140,118,78,0.055)"/>' +
      '<circle cx="7" cy="1.5" r="0.55" fill="rgba(255,255,255,0.35)"/>' +
      '<path d="M0 7 L14 7" stroke="rgba(140,118,78,0.028)" stroke-width="1"/>' +
      "</pattern>";
    svg.insertBefore(defs, svg.firstChild);
    statesLayer.eachLayer(function (layer) {
      if (layer._path) layer._path.setAttribute("fill", "url(#landtex)");
    });
  }

  // ------------------------------------------------------------------
  // Estado da visão na URL (#zoom/lat/lng) — permite compartilhar enquadramento
  // ------------------------------------------------------------------
  function applyHashView() {
    var match = /^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/.exec(location.hash);
    if (!match) return false;
    map.setView([parseFloat(match[2]), parseFloat(match[3])], parseFloat(match[1]));
    return true;
  }

  map.on("moveend", function () {
    var center = map.getCenter();
    var hash = "#" + map.getZoom() + "/" + center.lat.toFixed(4) + "/" + center.lng.toFixed(4);
    history.replaceState(null, "", hash);
  });

  // ------------------------------------------------------------------
  // Carga dos dados
  // ------------------------------------------------------------------
  function fetchJson(path) {
    return fetch(path).then(function (response) {
      if (!response.ok) throw new Error(path + " -> HTTP " + response.status);
      return response.json();
    });
  }

  Promise.all([
    fetchJson("data/brasil-estados.geojson"),
    fetchJson("data/clients.geojson"),
    fetchJson("data/build-report.json")
  ])
    .then(function (results) {
      var estados = results[0];
      var clients = results[1];
      var report = results[2];

      var statesLayer = L.geoJSON(estados, {
        interactive: false,
        style: {
          color: "#b3a687",
          weight: 1,
          fillColor: "#efe7d3",
          fillOpacity: 1
        }
      }).addTo(map);
      applyLandTexture(statesLayer);

      estados.features.forEach(function (feature) {
        var sigla = UF_BY_CODAREA[feature.properties.codarea];
        var latlng = featureLabelPoint(feature.geometry);
        if (sigla && latlng) ufLabels.push({ sigla: sigla, latlng: latlng });
      });

      var counts = {};
      STAGES.forEach(function (stage) { counts[stage.id] = 0; });
      var stageById = {};
      STAGES.forEach(function (stage) { stageById[stage.id] = stage; });

      clients.features.forEach(function (feature) {
        var stage = stageById[feature.properties.stage];
        if (!stage) return;
        counts[stage.id] += 1;
        var coords = feature.geometry.coordinates;
        clientPoints.push({
          latlng: L.latLng(coords[1], coords[0]),
          name: feature.properties.name,
          stage: stage.id,
          label: stage.label,
          color: stage.color
        });
      });

      if (!applyHashView()) {
        map.fitBounds(statesLayer.getBounds(), { padding: [10, 10] });
      }
      redraw(); // desenho inicial síncrono (headless/print não dependem de rAF)

      var legendList = document.getElementById("legend-items");
      STAGES.forEach(function (stage) {
        var item = document.createElement("li");
        var label = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.addEventListener("change", function () {
          stageVisible[stage.id] = checkbox.checked;
          scheduleRedraw();
        });

        var swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.backgroundImage =
          "url(" + makePenSprite(stage.color, 14).canvas.toDataURL() + ")";

        var text = document.createElement("span");
        text.textContent = stage.label;

        var count = document.createElement("span");
        count.className = "count";
        count.textContent = counts[stage.id].toLocaleString("pt-BR");

        label.appendChild(checkbox);
        label.appendChild(swatch);
        label.appendChild(text);
        label.appendChild(count);
        item.appendChild(label);
        legendList.appendChild(item);
      });

      var updatedAt = document.getElementById("updated-at");
      updatedAt.textContent =
        clients.features.length.toLocaleString("pt-BR") +
        " clientes no mapa — atualizado em " + formatDate(report.generated_at);
    })
    .catch(function (error) {
      document.getElementById("updated-at").textContent =
        "Erro ao carregar dados: " + error.message;
    });

  function formatDate(isoText) {
    var date = new Date(isoText);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  // ------------------------------------------------------------------
  // Impressão e captura
  // ------------------------------------------------------------------
  document.getElementById("btn-print").addEventListener("click", function () {
    window.print();
  });

  var screenshoter = L.simpleMapScreenshoter({ hidden: true }).addTo(map);
  document.getElementById("btn-shot").addEventListener("click", function () {
    screenshoter
      .takeScreen("blob")
      .then(function (blob) {
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "mapa-clientes-allcanci.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(link.href);
      })
      .catch(function (error) {
        alert("Falha ao capturar imagem: " + error);
      });
  });
})();
