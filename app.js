/* Mapa de Clientes Allcanci — Leaflet sem tiles, estados IBGE, canetas por etapa. */
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

  var BRAZIL_BOUNDS = L.latLngBounds([-36, -76], [8, -30]);

  var map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
    minZoom: 4,
    maxZoom: 12,
    maxBounds: BRAZIL_BOUNDS.pad(0.15),
    maxBoundsViscosity: 0.8,
    zoomSnap: 0.5
  });

  function penSvg(color) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 40">' +
      '<rect x="6" y="8" width="12" height="22" rx="2" fill="' + color + '" stroke="#1e293b" stroke-width="1.5"/>' +
      '<rect x="7" y="1" width="10" height="7" rx="2" fill="#e2e8f0" stroke="#1e293b" stroke-width="1.5"/>' +
      '<polygon points="9,30 15,30 13,38 11,38" fill="#334155"/>' +
      "</svg>"
    );
  }

  var iconByStage = {};
  STAGES.forEach(function (stage) {
    iconByStage[stage.id] = L.divIcon({
      className: "pen-icon",
      html: penSvg(stage.color),
      iconSize: [0, 0]
    });
  });

  function penSizeForZoom(zoom) {
    if (zoom <= 4) return 12;
    if (zoom <= 5) return 16;
    if (zoom <= 6) return 20;
    if (zoom <= 7) return 24;
    return 30;
  }

  function applyPenSize() {
    var size = penSizeForZoom(map.getZoom());
    map.getContainer().style.setProperty("--pen-size", size + "px");
  }
  map.on("zoomend", applyPenSize);

  function formatDate(isoText) {
    var date = new Date(isoText);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

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
        style: {
          color: "#475569",
          weight: 1.1,
          fillColor: "#f8fafc",
          fillOpacity: 1
        }
      }).addTo(map);

      map.fitBounds(statesLayer.getBounds(), { padding: [10, 10] });
      applyPenSize();

      var groups = {};
      var counts = {};
      STAGES.forEach(function (stage) {
        groups[stage.id] = L.layerGroup().addTo(map);
        counts[stage.id] = 0;
      });

      clients.features.forEach(function (feature) {
        var stageId = feature.properties.stage;
        var group = groups[stageId];
        if (!group) return;
        counts[stageId] += 1;
        var coords = feature.geometry.coordinates;
        L.marker([coords[1], coords[0]], {
          icon: iconByStage[stageId],
          keyboard: false
        })
          .bindTooltip(feature.properties.name, {
            className: "client-tooltip",
            direction: "top",
            offset: [0, -26]
          })
          .addTo(group);
      });

      var legendList = document.getElementById("legend-items");
      STAGES.forEach(function (stage) {
        var item = document.createElement("li");
        var label = document.createElement("label");
        var checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = true;
        checkbox.addEventListener("change", function () {
          if (checkbox.checked) {
            map.addLayer(groups[stage.id]);
          } else {
            map.removeLayer(groups[stage.id]);
          }
        });

        var swatch = document.createElement("span");
        swatch.className = "swatch";
        swatch.style.background = stage.color;

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
      var total = clients.features.length;
      updatedAt.textContent =
        total.toLocaleString("pt-BR") + " clientes no mapa — atualizado em " +
        formatDate(report.generated_at);
    })
    .catch(function (error) {
      document.getElementById("updated-at").textContent =
        "Erro ao carregar dados: " + error.message;
    });

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
