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
    "pieChart": "piechart",
}

# DQL keywords that suggest the result is a percentage (0..100) — used to
# decide whether to seed gauge min/max.
PCT_HINTS = ("storage", "Percent", "percent", "soc", "humidity", "Luftfeuchte", "selfConsumption")

DS_TEMPLATE = {"type": "discostu105-dynatracegrail-datasource", "uid": "P6C323D126547F71F"}


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
            # No color: thresholds-driven coloring is wrong for everything
            # except deliberate gauges; just show the value.
            "colorMode": "none",
            "graphMode": "area",
        }
    elif grafana_type == "gauge":
        panel["options"] = {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "orientation": "auto",
            "showThresholdLabels": False,
            "showThresholdMarkers": False,
        }
        # Only seed 0..100 if the query looks like a percentage; otherwise
        # let Grafana auto-scale.
        if any(h in dql for h in PCT_HINTS):
            panel["fieldConfig"]["defaults"]["min"] = 0
            panel["fieldConfig"]["defaults"]["max"] = 100
            panel["fieldConfig"]["defaults"]["unit"] = "percent"
    elif grafana_type == "barchart":
        panel["options"] = {"orientation": "auto", "showValue": "auto"}
    elif grafana_type == "piechart":
        panel["options"] = {
            "reduceOptions": {"calcs": ["lastNotNull"], "fields": "", "values": False},
            "pieType": "donut",
            "legend": {"displayMode": "list", "placement": "right"},
        }
    elif grafana_type == "table":
        # No transformations: the original DynaLox tile already projects the
        # columns it wants via `| fields ...`. A blanket reduce turns the
        # multi-column result into a single Field/Last keypair list, which
        # is strictly worse for the panels that have an explicit projection.
        panel["options"] = {"showHeader": True}
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

    # An optional query-typed variable populated from DQL. Each dashboard
    # gets a "$control" variable backed by `summarize by:{control.name}` —
    # proves metricFindQuery end-to-end and lets the user filter the panel
    # set from the dashboard top bar.
    # The datasource is referenced directly by its provisioned UID — see
    # DS_TEMPLATE above. The dashboards are not authored to be portable
    # across installations (the upstream DynaLox docs aren't either), so we
    # skip the DS_X template variable indirection and the brittle resolution
    # it requires.
    variables = [
        {
            "name": "control",
            "type": "query",
            "label": "Control",
            "datasource": DS_TEMPLATE,
            # Variable query is a DQL string. Grafana (scenes engine) calls
            # `query.trim()` on it and then passes it to the data source's
            # metricFindQuery(dql, …) — see src/datasource.ts.
            "query": 'fetch metric.series | filter contains(metric.key, "loxone.control") | summarize count(), by:{control.name} | fields control.name | sort control.name asc',
            "refresh": 1,
            "regex": "",
            "multi": True,
            "includeAll": True,
            "allValue": ".*",
            "current": {"text": ["All"], "value": ["$__all"], "selected": True},
        },
    ]

    # Annotation source — Davis events pinned on every panel's timeline.
    # The tenant returns empty for now (no Davis events ingested), but
    # the source is wired so they appear automatically once events show
    # up. This also exercises the annotation contract end-to-end (R2.2).
    annotations = {
        "list": [
            {
                "name": "Davis events",
                "datasource": DS_TEMPLATE,
                "enable": True,
                "iconColor": "red",
                "target": {
                    "refId": "Anno",
                    "dqlQuery": (
                        'fetch dt.davis.events | filter $__timeFilter(start_time) '
                        '| fields timestamp = start_time, title = event.name, text = description, tags = event.kind'
                    ),
                },
            }
        ]
    }

    dashboard = {
        "title": title,
        "uid": Path(out_path).stem,
        "schemaVersion": 39,
        "version": 1,
        "tags": ["dql", "dynalox"],
        "timezone": "browser",
        "time": {"from": "now-24h", "to": "now"},
        "refresh": "1m",
        "annotations": annotations,
        "templating": {"list": variables},
        "panels": panels,
    }

    Path(out_path).write_text(json.dumps(dashboard, indent=2))
    print(f"wrote {out_path} ({len(panels)} panels)")


if __name__ == "__main__":
    main()
