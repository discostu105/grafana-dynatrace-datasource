package plugin

import (
	"bytes"
	"context"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"net/http"
	"net/http/httptest"
)

// pluginMetrics is the per-process Prometheus registry the plugin exposes
// via backend.CollectMetricsHandler. Counters and histograms are bumped
// from the query path; Grafana scrapes them at
// /api/datasources/uid/<uid>/health/metrics (and rolls them up into the
// datasources panel in the Plugins admin view).
var (
	queryRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "grafana_dql",
			Name:      "query_requests_total",
			Help:      "Total number of DQL queries executed, labelled by query type and status.",
		},
		[]string{"query_type", "status"},
	)
	queryDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "grafana_dql",
			Name:      "query_duration_seconds",
			Help:      "End-to-end DQL query duration, including Grail execute+poll and frame mapping.",
			Buckets:   prometheus.ExponentialBuckets(0.05, 2, 10), // 50ms .. ~25s
		},
		[]string{"query_type"},
	)
	autocompleteRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "grafana_dql",
			Name:      "autocomplete_requests_total",
			Help:      "Total number of /resources/autocomplete proxy calls, labelled by status.",
		},
		[]string{"status"},
	)
	pluginRegistry = prometheus.NewRegistry()
)

func init() {
	pluginRegistry.MustRegister(queryRequestsTotal, queryDurationSeconds, autocompleteRequestsTotal)
}

// CollectMetrics is what Grafana calls when scraping the plugin's metrics
// page. We hand off to the standard Prometheus HTTP handler against our
// own registry — bytes get embedded in the CollectMetricsResult.
func (d *Datasource) CollectMetrics(_ context.Context, _ *backend.CollectMetricsRequest) (*backend.CollectMetricsResult, error) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	promhttp.HandlerFor(pluginRegistry, promhttp.HandlerOpts{}).ServeHTTP(rec, req)
	body := bytes.TrimRight(rec.Body.Bytes(), "\n")
	return &backend.CollectMetricsResult{
		PrometheusMetrics: body,
	}, nil
}

// observeQuery records one query execution. status is one of "ok", "error",
// "bad_request"; queryType comes from the queryModel (logs / timeseries).
func observeQuery(queryType, status string, durationSeconds float64) {
	if queryType == "" {
		queryType = "timeseries"
	}
	queryRequestsTotal.WithLabelValues(queryType, status).Inc()
	queryDurationSeconds.WithLabelValues(queryType).Observe(durationSeconds)
}

// observeAutocomplete records one /resources/autocomplete proxy call.
func observeAutocomplete(status string) {
	autocompleteRequestsTotal.WithLabelValues(status).Inc()
}
