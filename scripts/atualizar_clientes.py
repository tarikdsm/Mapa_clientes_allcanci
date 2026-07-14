"""Pipeline de atualizacao do Mapa de Clientes Allcanci.

Uso:
    python scripts/atualizar_clientes.py

Le o webhook Bitrix de ../webhook.md (fora do repositorio), busca os negocios
do pipeline Comercial nas 7 etapas ativas, monta o banco local simples de
clientes (nome + endereco para geolocalizacao + etapa), geocodifica por
cidade/bairro com cache Nominatim e gera os arquivos consumidos pelo site.
"""
from __future__ import annotations

import datetime as dt
import gzip
import hashlib
import json
import math
import re
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = REPO_ROOT / "data"
SOURCE_DIR = DATA_DIR / "source"
WEBHOOK_FILE = REPO_ROOT.parent / "webhook.md"
CACHE_FILE = SOURCE_DIR / "geocode_cache.json"
CLIENTES_JSON = DATA_DIR / "clientes.json"
CLIENTS_GEOJSON = DATA_DIR / "clients.geojson"
ESTADOS_GEOJSON = DATA_DIR / "brasil-estados.geojson"
REPORT_JSON = DATA_DIR / "build-report.json"

WEBHOOK_PATTERN = re.compile(r"https://[^\s]+/rest/\d+/[A-Za-z0-9_]+/")
MOJIBAKE_MARKERS = ("Ã", "â", "�")

IBGE_ESTADOS_URL = (
    "https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR"
    "?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF"
)
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "mapa-clientes-allcanci/1.0 (github pages build)"
REQUEST_DELAY_SECONDS = 1.1

COMMERCIAL_CATEGORY_ID = 0

# Prioridade 1 = etapa mais avancada. Empresa presente em varias etapas fica
# na mais avancada.
STAGES = [
    {"id": "concluido", "stage_id": "WON", "label": "Concluído (cliente)", "color": "#2F9E44", "priority": 1},
    {"id": "assinatura", "stage_id": "UC_Z5X73F", "label": "Assinatura de Contrato", "color": "#1C7ED6", "priority": 2},
    {"id": "licitacao", "stage_id": "UC_U098BX", "label": "Licitação/Publicação", "color": "#E03131", "priority": 3},
    {"id": "fechamento", "stage_id": "UC_EPO88F", "label": "Fechamento", "color": "#7B2CBF", "priority": 4},
    {"id": "negociacao", "stage_id": "UC_59MDOM", "label": "Em Negociação", "color": "#F76707", "priority": 5},
    {"id": "a_visitar", "stage_id": "UC_P9UM87", "label": "A Visitar", "color": "#0C8599", "priority": 6},
    {"id": "contato_futuro", "stage_id": "UC_Z53JVP", "label": "Contato Futuro", "color": "#868E96", "priority": 7},
]
STAGE_BY_STAGE_ID = {stage["stage_id"]: stage for stage in STAGES}

COMPANY_FIELDS = {
    "street_physical": "UF_CRM_1721160042326",
    "number_physical": "UF_CRM_1721160053841",
    "neighborhood_physical": "UF_CRM_1721160072753",
    "city_physical": "UF_CRM_1721160090521",
    "state_physical": "UF_CRM_1721160103801",
    "street_cnpj": "UF_CRM_1725646584",
    "number_cnpj": "UF_CRM_1725646641",
    "neighborhood_cnpj": "UF_CRM_1725646734",
    "city_cnpj": "UF_CRM_1725646790",
    "state_cnpj": "UF_CRM_1725646961",
    "address": "ADDRESS",
    "city_std": "ADDRESS_CITY",
    "state_std": "ADDRESS_PROVINCE",
}

DEAL_FIELDS = {
    "street_cnpj": "UF_CRM_6690561E4D4B8",
    "number_cnpj": "UF_CRM_6690561E68C8C",
    "neighborhood_cnpj": "UF_CRM_6690561E774AE",
    "city_cnpj": "UF_CRM_6690561E8539D",
    "street_physical": "UF_CRM_1739193772",
    "number_physical": "UF_CRM_1739193784",
    "neighborhood_physical": "UF_CRM_1739193760",
    "city_physical": "UF_CRM_1739193746",
}

BRAND_SUFFIX_RE = re.compile(r"\s*[-–]\s*(allcanci|theik[oó]s)\s*$", re.IGNORECASE)

UF_CODES = {
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
    "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
    "SP", "SE", "TO",
}

STATE_NAME_TO_UF = {
    "acre": "AC", "alagoas": "AL", "amapa": "AP", "amazonas": "AM",
    "bahia": "BA", "ceara": "CE", "distrito federal": "DF",
    "espirito santo": "ES", "goias": "GO", "maranhao": "MA",
    "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG",
    "para": "PA", "paraiba": "PB", "parana": "PR", "pernambuco": "PE",
    "piaui": "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN",
    "rio grande do sul": "RS", "rondonia": "RO", "roraima": "RR",
    "santa catarina": "SC", "sao paulo": "SP", "sergipe": "SE",
    "tocantins": "TO",
}
UF_TO_STATE_NAME = {
    "AC": "Acre", "AL": "Alagoas", "AP": "Amapá", "AM": "Amazonas",
    "BA": "Bahia", "CE": "Ceará", "DF": "Distrito Federal",
    "ES": "Espírito Santo", "GO": "Goiás", "MA": "Maranhão",
    "MT": "Mato Grosso", "MS": "Mato Grosso do Sul", "MG": "Minas Gerais",
    "PA": "Pará", "PB": "Paraíba", "PR": "Paraná", "PE": "Pernambuco",
    "PI": "Piauí", "RJ": "Rio de Janeiro", "RN": "Rio Grande do Norte",
    "RS": "Rio Grande do Sul", "RO": "Rondônia", "RR": "Roraima",
    "SC": "Santa Catarina", "SP": "São Paulo", "SE": "Sergipe",
    "TO": "Tocantins",
}


# ---------------------------------------------------------------------------
# Funcoes puras (cobertas por scripts/test_atualizar_clientes.py)
# ---------------------------------------------------------------------------

def clean_text(value: Any) -> str:
    return " ".join(str(value or "").strip().split())


def strip_accents(value: str) -> str:
    return "".join(
        char for char in unicodedata.normalize("NFD", value)
        if unicodedata.category(char) != "Mn"
    )


def fix_mojibake(text: str) -> str:
    if not any(marker in text for marker in MOJIBAKE_MARKERS):
        return text
    try:
        return text.encode("latin1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return text


def normalize_uf(value: str) -> str:
    cleaned = strip_accents(clean_text(value)).lower()
    if not cleaned:
        return ""
    if cleaned.upper() in UF_CODES:
        return cleaned.upper()
    return STATE_NAME_TO_UF.get(cleaned, "")


def cache_key(neighborhood: str, city: str, uf: str) -> str:
    return "|".join(
        clean_text(part).lower() for part in (neighborhood, city, uf)
    )


def pick_best_stage(stage_ids: list[str]) -> dict[str, Any]:
    stages = [STAGE_BY_STAGE_ID[sid] for sid in stage_ids if sid in STAGE_BY_STAGE_ID]
    if not stages:
        raise ValueError(f"Nenhuma etapa conhecida em {stage_ids}")
    return min(stages, key=lambda stage: stage["priority"])


def jitter(lat: float, lng: float, name: str, index: int) -> tuple[float, float]:
    """Espalhamento deterministico em espiral para clientes na mesma cidade."""
    digest = hashlib.md5(f"{name}|{index}".encode("utf-8")).hexdigest()
    angle = (int(digest[:8], 16) / 0xFFFFFFFF) * 2 * math.pi
    radius = 0.004 + (index % 20) / 20 * 0.016  # <= 0.02 graus (~2 km)
    return (
        round(lat + radius * math.sin(angle), 5),
        round(lng + radius * math.cos(angle), 5),
    )


def strip_brand_suffix(name: str) -> str:
    return BRAND_SUFFIX_RE.sub("", name).strip()


def first_non_empty(*values: Any) -> str:
    for value in values:
        text = clean_text(value)
        if text and text not in {"None", "null"}:
            return text
    return ""


def combine_street_number(street: Any, number: Any) -> str:
    street_text = clean_text(street)
    number_text = clean_text(number)
    if street_text and number_text:
        return f"{street_text}, {number_text}"
    return street_text or number_text


# ---------------------------------------------------------------------------
# Bitrix
# ---------------------------------------------------------------------------

def read_webhook_url() -> str:
    text = WEBHOOK_FILE.read_text(encoding="utf-8")
    match = WEBHOOK_PATTERN.search(text)
    if not match:
        raise RuntimeError(f"Webhook nao encontrado em {WEBHOOK_FILE}")
    return match.group(0)


def call_bitrix(webhook_url: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    url = f"{webhook_url}{method}.json"
    if params:
        url += "?" + urlencode(params, doseq=True)
    request = Request(url, headers={"User-Agent": USER_AGENT})
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urlopen(request, timeout=90) as response:
                return json.load(response)
        except Exception as error:  # noqa: BLE001 - rede/limite de taxa
            last_error = error
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Falha ao chamar {method}: {last_error}")


def batch_bitrix(webhook_url: str, commands: dict[str, str]) -> dict[str, Any]:
    params: dict[str, Any] = {"halt": 0}
    for key, command in commands.items():
        params[f"cmd[{key}]"] = command
    return call_bitrix(webhook_url, "batch", params=params)


def batched(items: list[Any], size: int) -> list[list[Any]]:
    return [items[index:index + size] for index in range(0, len(items), size)]


def fetch_state_enum_maps(webhook_url: str) -> dict[str, dict[str, str]]:
    """Mapeia ID do item de enumeracao -> valor, para os campos de Estado."""
    payload = call_bitrix(webhook_url, "crm.company.fields")
    fields = payload.get("result") or {}
    maps: dict[str, dict[str, str]] = {}
    for field_key in (COMPANY_FIELDS["state_physical"], COMPANY_FIELDS["state_cnpj"]):
        items = (fields.get(field_key) or {}).get("items") or []
        maps[field_key] = {str(item["ID"]): str(item["VALUE"]) for item in items}
    return maps


def fetch_deals_by_stage(webhook_url: str, stage_id: str) -> list[dict[str, Any]]:
    deals: list[dict[str, Any]] = []
    select_fields = ["ID", "TITLE", "COMPANY_ID", "STAGE_ID", *DEAL_FIELDS.values()]
    params: dict[str, Any] = {
        "filter[CATEGORY_ID]": COMMERCIAL_CATEGORY_ID,
        "filter[STAGE_ID]": stage_id,
    }
    for index, field_name in enumerate(select_fields):
        params[f"select[{index}]"] = field_name

    start = 0
    while True:
        payload = call_bitrix(webhook_url, "crm.deal.list", params | {"start": start})
        deals.extend(payload.get("result") or [])
        if "next" not in payload:
            break
        start = int(payload["next"])
    return deals


def fetch_companies(webhook_url: str, company_ids: list[int]) -> dict[int, dict[str, Any]]:
    companies: dict[int, dict[str, Any]] = {}
    chunks = batched(company_ids, 50)
    for number, chunk in enumerate(chunks, start=1):
        commands = {f"c{cid}": f"crm.company.get?id={cid}" for cid in chunk}
        payload = batch_bitrix(webhook_url, commands)
        batch_result = (payload.get("result") or {}).get("result") or {}
        for cid in chunk:
            company = batch_result.get(f"c{cid}")
            if company:
                companies[cid] = company
        print(f"  empresas: lote {number}/{len(chunks)}")
    return companies


# ---------------------------------------------------------------------------
# Montagem dos clientes
# ---------------------------------------------------------------------------

def build_client(
    deal: dict[str, Any],
    company: dict[str, Any] | None,
    enum_maps: dict[str, dict[str, str]],
) -> dict[str, Any]:
    raw_name = clean_text(company.get("TITLE") if company else "") or strip_brand_suffix(
        clean_text(deal.get("TITLE"))
    )
    name = re.sub(r"^[\s\-–]+", "", fix_mojibake(raw_name))

    def comp(key: str) -> Any:
        return company.get(COMPANY_FIELDS[key]) if company else ""

    street = first_non_empty(
        combine_street_number(comp("street_physical"), comp("number_physical")),
        combine_street_number(comp("street_cnpj"), comp("number_cnpj")),
        combine_street_number(
            deal.get(DEAL_FIELDS["street_physical"]), deal.get(DEAL_FIELDS["number_physical"])
        ),
        combine_street_number(
            deal.get(DEAL_FIELDS["street_cnpj"]), deal.get(DEAL_FIELDS["number_cnpj"])
        ),
        comp("address"),
    )

    neighborhood = first_non_empty(
        comp("neighborhood_physical"),
        comp("neighborhood_cnpj"),
        deal.get(DEAL_FIELDS["neighborhood_physical"]),
        deal.get(DEAL_FIELDS["neighborhood_cnpj"]),
    )

    city = first_non_empty(
        comp("city_physical"),
        comp("city_cnpj"),
        comp("city_std"),
        deal.get(DEAL_FIELDS["city_physical"]),
        deal.get(DEAL_FIELDS["city_cnpj"]),
    )

    state_physical_raw = clean_text(comp("state_physical"))
    state_cnpj_raw = clean_text(comp("state_cnpj"))
    state_physical = enum_maps.get(COMPANY_FIELDS["state_physical"], {}).get(
        state_physical_raw, state_physical_raw
    )
    state_cnpj = enum_maps.get(COMPANY_FIELDS["state_cnpj"], {}).get(
        state_cnpj_raw, state_cnpj_raw
    )
    uf = (
        normalize_uf(state_physical)
        or normalize_uf(state_cnpj)
        or normalize_uf(clean_text(comp("state_std")))
    )

    return {
        "name": name,
        "street": fix_mojibake(street),
        "neighborhood": fix_mojibake(neighborhood),
        "city": fix_mojibake(city),
        "uf": uf,
    }


def collect_clients(
    deals_by_stage: dict[str, list[dict[str, Any]]],
    company_map: dict[int, dict[str, Any]],
    enum_maps: dict[str, dict[str, str]],
) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}

    for stage in STAGES:
        for deal in deals_by_stage.get(stage["stage_id"], []):
            company_id_text = clean_text(deal.get("COMPANY_ID"))
            company_id = (
                int(company_id_text)
                if company_id_text.isdigit() and company_id_text != "0"
                else None
            )
            company = company_map.get(company_id) if company_id else None
            client = build_client(deal, company, enum_maps)
            if not client["name"]:
                continue

            key = (
                f"company:{company_id}"
                if company_id
                else f"free:{client['name'].lower()}|{client['city'].lower()}"
            )
            entry = merged.setdefault(
                key,
                {
                    **client,
                    "company_id": company_id,
                    "deal_ids": [],
                    "stage_ids": [],
                },
            )
            entry["deal_ids"].append(int(deal["ID"]))
            entry["stage_ids"].append(clean_text(deal.get("STAGE_ID")))
            # Completa endereco vazio com dados de outro negocio da empresa.
            for field in ("street", "neighborhood", "city", "uf"):
                if not entry[field] and client[field]:
                    entry[field] = client[field]

    clients = []
    for entry in merged.values():
        best = pick_best_stage(entry.pop("stage_ids"))
        entry["stage_id"] = best["id"]
        entry["stage_label"] = best["label"]
        clients.append(entry)

    clients.sort(key=lambda item: (item["name"].lower(), item["city"].lower()))
    return clients


# ---------------------------------------------------------------------------
# Geocodificacao
# ---------------------------------------------------------------------------

def load_cache() -> dict[str, Any]:
    if CACHE_FILE.exists():
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    return {}


def save_cache(cache: dict[str, Any]) -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(
        json.dumps(cache, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )


def nominatim_search(query: str) -> dict[str, Any] | None:
    params = {
        "q": query,
        "format": "jsonv2",
        "limit": 1,
        "countrycodes": "br",
        "addressdetails": 1,
    }
    url = f"{NOMINATIM_URL}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT})
    time.sleep(REQUEST_DELAY_SECONDS)
    try:
        with urlopen(request, timeout=60) as response:
            results = json.load(response)
    except Exception as error:  # noqa: BLE001
        print(f"  aviso: falha Nominatim para '{query}': {error}")
        return None
    return results[0] if results else None


def geocode_client(client: dict[str, Any], cache: dict[str, Any]) -> dict[str, Any] | None:
    """Retorna {lat, lng, uf} ou None. Alimenta o cache em memoria."""
    city = client["city"]
    uf = client["uf"]
    neighborhood = client["neighborhood"]

    attempts: list[tuple[str, str, str]] = []  # (cache_key, query, source)
    if neighborhood and uf:
        attempts.append(
            (
                cache_key(neighborhood, city, uf),
                f"{neighborhood}, {city}, {UF_TO_STATE_NAME[uf]}, Brasil",
                "neighborhood",
            )
        )
    if uf:
        attempts.append(
            (cache_key("", city, uf), f"{city}, {UF_TO_STATE_NAME[uf]}, Brasil", "city")
        )
    attempts.append((cache_key("", city, ""), f"{city}, Brasil", "city_br"))

    for key, query, source in attempts:
        entry = cache.get(key)
        if entry is None:
            result = nominatim_search(query)
            if result is None:
                entry = {"status": "miss", "query": query}
            else:
                address = result.get("address") or {}
                found_uf = normalize_uf(address.get("state") or "")
                entry = {
                    "status": "ok",
                    "lat": float(result["lat"]),
                    "lng": float(result["lon"]),
                    "source": source,
                    "query": query,
                    "display_name": result.get("display_name", ""),
                    "uf": found_uf,
                }
            cache[key] = entry
        if entry.get("status") == "ok":
            return {
                "lat": float(entry["lat"]),
                "lng": float(entry["lng"]),
                "uf": entry.get("uf") or uf,
            }
    return None


# ---------------------------------------------------------------------------
# Saidas
# ---------------------------------------------------------------------------

def ensure_estados_geojson() -> None:
    if ESTADOS_GEOJSON.exists():
        return
    print("Baixando malha estadual do IBGE...")
    request = Request(IBGE_ESTADOS_URL, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=240) as response:
        raw = response.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    payload = json.loads(raw.decode("utf-8"))
    ESTADOS_GEOJSON.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"  gravado {ESTADOS_GEOJSON.name}")


def build_outputs(clients: list[dict[str, Any]], cache: dict[str, Any]) -> None:
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    published_features: list[dict[str, Any]] = []
    ignored: list[dict[str, str]] = []
    counts: dict[str, int] = {stage["label"]: 0 for stage in STAGES}
    coord_usage: dict[str, int] = {}

    for processed, client in enumerate(clients, start=1):
        if processed % 200 == 0:
            save_cache(cache)  # protege o progresso da geocodificacao
            print(f"  geocodificacao: {processed}/{len(clients)} clientes")
        if not client["city"]:
            ignored.append({"name": client["name"], "reason": "sem cidade"})
            continue
        located = geocode_client(client, cache)
        if located is None:
            ignored.append(
                {"name": client["name"], "reason": f"geocodificacao falhou ({client['city']}/{client['uf'] or '?'})"}
            )
            continue

        client["uf"] = client["uf"] or located["uf"]
        coord_id = f"{round(located['lat'], 4)}|{round(located['lng'], 4)}"
        occurrence = coord_usage.get(coord_id, 0)
        coord_usage[coord_id] = occurrence + 1
        lat, lng = located["lat"], located["lng"]
        if occurrence > 0:
            lat, lng = jitter(lat, lng, client["name"], occurrence)

        stage = next(s for s in STAGES if s["id"] == client["stage_id"])
        counts[stage["label"]] += 1
        published_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [round(lng, 5), round(lat, 5)]},
                "properties": {
                    "name": client["name"],
                    "stage": stage["id"],
                    "label": stage["label"],
                    "color": stage["color"],
                },
            }
        )

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CLIENTES_JSON.write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "clients": [
                    {key: value for key, value in client.items()}
                    for client in clients
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    CLIENTS_GEOJSON.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": published_features},
            ensure_ascii=False,
            separators=(",", ":"),
        ),
        encoding="utf-8",
    )
    REPORT_JSON.write_text(
        json.dumps(
            {
                "generated_at": generated_at,
                "total_clients": len(clients),
                "published": len(published_features),
                "ignored_count": len(ignored),
                "counts_por_etapa": counts,
                "ignored": ignored,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print()
    print(f"Clientes no banco local: {len(clients)}")
    print(f"Publicados no mapa: {len(published_features)}")
    print(f"Ignorados: {len(ignored)}")
    for label, count in counts.items():
        print(f"  {label}: {count}")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    webhook_url = read_webhook_url()
    print("Webhook carregado (fora do repositorio).")

    ensure_estados_geojson()

    print("Resolvendo enumeracoes de Estado...")
    enum_maps = fetch_state_enum_maps(webhook_url)

    deals_by_stage: dict[str, list[dict[str, Any]]] = {}
    company_ids: set[int] = set()
    for stage in STAGES:
        deals = fetch_deals_by_stage(webhook_url, stage["stage_id"])
        deals_by_stage[stage["stage_id"]] = deals
        print(f"Etapa {stage['label']}: {len(deals)} negocios")
        for deal in deals:
            cid = clean_text(deal.get("COMPANY_ID"))
            if cid.isdigit() and cid != "0":
                company_ids.add(int(cid))

    print(f"Buscando {len(company_ids)} empresas...")
    company_map = fetch_companies(webhook_url, sorted(company_ids))

    clients = collect_clients(deals_by_stage, company_map, enum_maps)
    print(f"Clientes unicos apos deduplicacao: {len(clients)}")

    cache = load_cache()
    try:
        build_outputs(clients, cache)
    finally:
        save_cache(cache)

    print()
    print("Pronto! Para publicar no site:")
    print('  git add data && git commit -m "data: atualiza clientes" && git push')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
