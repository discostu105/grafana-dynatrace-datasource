#!/usr/bin/env python3
"""Convert a DynaLox (Dynatrace document) dashboard yaml into a Grafana
dashboard JSON. Best-effort: matches title+query pairs and lays panels
out in a 2-column grid. Visualization is inferred from the Dynatrace
hint (singleValue -> stat, gauge -> gauge, honeycomb/table -> table,
otherwise -> timeseries).

Usage:  convert_dynalox.py <input.yaml> <output.json> <dashboard-title>
"""
import json
import sys
from pathlib import Path

import yaml


VIS_MAP = {
    "singleValue": "stat",
    "gauge": "gauge",
    "honeycomb": "table",
    "table": "table",
    "lineChart": "timeseries",
    "areaChart": "timeseries",
    "barChart": "barchart",
    "categoricalBarChart": "barchart",
}

DS_TEMPLATE = {"type": "discostu105-dynatracegrail-datasource", "uid": "${DS_DYNATRACEGRAIL}"}


def make_panel(idx, title, dql, vis):
    grafana_type = VIS_MAP.get(vis, "timeseries")
    col = idx % 2
    row = idx // 2
    h = 4 if grafana_type in ("stat", "gauge") else 8
    panel = {
        "id": idx + 1,
        "type": grafana_type,
        "title": title,
        "datasource": DS_TEMPLATE,
        "gridPos": {"x": col * 12, "y": row * h, "w": 12, "h": h},
        "targets": [
            {"refId": "A", "datasource": DS_TEMPLATE, "dqlQuery": dql.strip()}
        ],
        "fieldConfig": {"defaults": {}, "overrides": []},
        "options": {},
    }
    if grafana_type == "stat":
        panel["options"] = {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "textMode": "auto",
            "colorMode": "value",
            "graphMode": "area",
        }
    elif grafana_type == "gauge":
        panel["options"] = {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "showThresholdLabels": False,
            "showThresholdMarkers": True,
        }
        panel["fieldConfig"]["defaults"]["min"] = 0
        panel["fieldConfig"]["defaults"]["max"] = 100
    elif grafana_type == "barchart":
        panel["options"] = {"orientation": "auto", "showValue": "auto"}
    elif grafana_type == "table":
        panel["options"] = {"showHeader": True}
        panel["transformations"] = [
            {"id": "reduce", "options": {"reducers": ["lastNotNull"]}}
        ]
    else:  # timeseries
        panel["options"] = {
            "legend": {"displayMode": "list", "placement": "bottom", "showLegend": True},
            "tooltip": {"mode": "multi", "sort": "none"},
        }
        panel["fieldConfig"]["defaults"] = {
            "custom": {
                "drawStyle": "line",
                "lineInterpolation": "linear",
                "lineWidth": 1,
                "fillOpacity": 10,
                "showPoints": "never",
            }
        }
    return panel


def walk_tiles(content):
    tiles = content.get("tiles") or {}
    if isinstance(tiles, dict):
        for key in tiles:
            yield key, tiles[key]
    elif isinstance(tiles, list):
        for i, t in enumerate(tiles):
            yield str(i), t


def main():
    in_path, out_path, title = sys.argv[1], sys.argv[2], sys.argv[3]
    raw = Path(in_path).read_text()
    # PyYAML rejects bare "=" and "= *value*" used by Dynatrace inside
    # coloring rules. Quote the whole value — we don't read this field.
    import re
    raw = re.sub(r"(comparator:\s*)(.+)$", r'\1"\2"', raw, flags=re.MULTILINE)
    doc = yaml.safe_load(raw)
    content = doc.get("content") or doc

    panels = []
    idx = 0
    for tile_id, tile in walk_tiles(content):
        if not isinstance(tile, dict):
            continue
        dql = tile.get("query")
        if not dql or not str(dql).strip():
            continue
        vis = tile.get("visualization") or ""
        ptitle = tile.get("title") or tile_id
        panels.append(make_panel(idx, ptitle, str(dql), vis))
        idx += 1

    dashboard = {
        "title": title,
        "uid": Path(out_path).stem,
        "schemaVersion": 39,
        "version": 1,
        "tags": ["dql", "dynalox"],
        "timezone": "browser",
        "time": {"from": "now-24h", "to": "now"},
        "refresh": "1m",
        "templating": {
            "list": [
                {
                    "name": "DS_DYNATRACEGRAIL",
                    "type": "datasource",
                    "label": "Dynatrace",
                    "query": "discostu105-dynatracegrail-datasource",
                    "current": {"text": "Dynatrace", "value": "Dynatrace"},
                    "hide": 0,
                }
            ]
        },
        "panels": panels,
    }

    Path(out_path).write_text(json.dumps(dashboard, indent=2))
    print(f"wrote {out_path} ({len(panels)} panels)")


if __name__ == "__main__":
    main()
