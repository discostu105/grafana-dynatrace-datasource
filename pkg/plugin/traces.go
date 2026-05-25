package plugin

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// isTraceDetailShape returns true if the records look like per-span rows
// (each carries a span.id). False means it's a roll-up — let the regular
// table mapper handle it.
func isTraceDetailShape(records []map[string]interface{}) bool {
	if len(records) == 0 {
		return false
	}
	_, ok := records[0]["span.id"].(string)
	return ok
}

// recordsToTraceFrame maps DQL `fetch spans` records onto Grafana's
// OpenTelemetry-compatible traces frame (Meta.PreferredVisualisation =
// VisTypeTrace).
//
// Field set is fixed by Grafana's traces visualisation contract:
//
//	traceID         (string)         the trace this span belongs to
//	spanID          (string)         the span's own id
//	parentSpanID    (string)         parent span id, "" for the root
//	operationName   (string)         span name
//	serviceName     (string)         emitting service
//	startTime       (float64)        ms since epoch
//	duration        (float64)        ms
//	tags            (json string)    [{ key, value }, …] — all remaining attrs
//	statusCode      (string opt)     "ok" / "error" / ""
//
// The DQL spec uses column names `trace.id`, `span.id`, `span.parent_id`,
// `span.name`, `service.name`, `start_time`, `end_time`, `duration` (ns).
// Anything else becomes a tag in the JSON-encoded tags column.
func recordsToTraceFrame(refID string, records []map[string]interface{}) ([]*data.Frame, error) {
	if len(records) == 0 {
		f := data.NewFrame(refID)
		setTraceVis(f)
		return []*data.Frame{f}, nil
	}

	n := len(records)
	traceIDs := make([]string, n)
	spanIDs := make([]string, n)
	parentSpanIDs := make([]string, n)
	operationNames := make([]string, n)
	serviceNames := make([]string, n)
	startTimes := make([]float64, n)
	durations := make([]float64, n)
	tags := make([]string, n)
	serviceTags := make([]string, n)
	logsField := make([]string, n)
	referencesField := make([]string, n)
	kinds := make([]string, n)
	statusCodes := make([]int64, n)
	statusMessages := make([]string, n)

	for i, rec := range records {
		traceIDs[i] = stringField(rec, "trace.id")
		spanIDs[i] = stringField(rec, "span.id")
		parentSpanIDs[i] = stringField(rec, "span.parent_id")
		// operationName: prefer span.name, fall back to endpoint.name
		// (Dynatrace's request-routing detection sometimes leaves span.name
		// empty but populates endpoint.name from URL pattern matching).
		operationNames[i] = firstNonEmpty(stringField(rec, "span.name"), stringField(rec, "endpoint.name"))
		serviceNames[i] = firstNonEmpty(stringField(rec, "service.name"), stringField(rec, "dt.service.name"))
		startTimes[i] = parseSpanTimeMs(rec, "start_time")
		durations[i] = computeDurationMs(rec)
		tags[i] = encodeTraceTags(rec)
		// Grafana's traces panel expects these as parallel arrays even when
		// empty — undefined columns make the span-detail view explode on
		// JSON.parse / .toLowerCase / .reduce calls.
		serviceTags[i] = "[]"
		logsField[i] = "[]"
		referencesField[i] = "[]"
		kinds[i] = normaliseSpanKind(stringField(rec, "span.kind"))
		statusCodes[i] = mapStatusCode(
			stringField(rec, "dt.failure_detection.verdict"),
			stringField(rec, "status.code"),
			boolField(rec, "request.is_failed"),
		)
		statusMessages[i] = ""
	}

	frame := data.NewFrame(refID,
		data.NewField("traceID", nil, traceIDs),
		data.NewField("spanID", nil, spanIDs),
		data.NewField("parentSpanID", nil, parentSpanIDs),
		data.NewField("operationName", nil, operationNames),
		data.NewField("serviceName", nil, serviceNames),
		data.NewField("kind", nil, kinds),
		data.NewField("statusCode", nil, statusCodes),
		data.NewField("statusMessage", nil, statusMessages),
		data.NewField("startTime", nil, startTimes),
		data.NewField("duration", nil, durations),
		data.NewField("serviceTags", nil, serviceTags),
		data.NewField("tags", nil, tags),
		data.NewField("logs", nil, logsField),
		data.NewField("references", nil, referencesField),
	)
	setTraceVis(frame)
	return []*data.Frame{frame}, nil
}

// normaliseSpanKind maps DQL span.kind values onto the lowercase enum
// Grafana's traces panel calls .toLowerCase() on. Empty input becomes
// "unspecified" — never undefined — so the icon lookup is always safe.
func normaliseSpanKind(s string) string {
	if s == "" {
		return "unspecified"
	}
	return strings.ToLower(s)
}

// mapStatusCode follows the OTel numeric status code convention:
//
//	0 = unset (default; rendered as no status in the panel)
//	1 = ok
//	2 = error
//
// Grafana's traces panel treats this as a number, not a string. Three
// signals are consulted in priority order:
//
//  1. dt.failure_detection.verdict (Dynatrace native, most reliable)
//  2. status.code (OTel-native if the SDK populates it)
//  3. request.is_failed (boolean flag Dynatrace sets when failure
//     detection rules fire — backstop for spans without a verdict yet)
func mapStatusCode(dtVerdict, otelStatus string, requestIsFailed bool) int64 {
	switch strings.ToLower(dtVerdict) {
	case "success", "ok":
		return 1
	case "failure", "error", "failed":
		return 2
	}
	switch strings.ToLower(otelStatus) {
	case "ok", "1":
		return 1
	case "error", "2":
		return 2
	}
	if requestIsFailed {
		return 2
	}
	return 0
}

// boolField pulls a boolean column out of the record. Accepts native
// bool plus the lowercase-string variants Dynatrace sometimes emits
// for serialised booleans.
func boolField(rec map[string]interface{}, key string) bool {
	v := rec[key]
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return strings.EqualFold(x, "true")
	}
	return false
}

func setTraceVis(f *data.Frame) {
	if f.Meta == nil {
		f.Meta = &data.FrameMeta{}
	}
	f.Meta.PreferredVisualization = data.VisTypeTrace
}

// computeDurationMs converts the span's duration column into milliseconds.
// Dynatrace emits `duration` as nanoseconds in a string ("123000"). When
// that's unparseable, falls back to end_time - start_time.
func computeDurationMs(rec map[string]interface{}) float64 {
	if raw, ok := rec["duration"]; ok {
		switch x := raw.(type) {
		case float64:
			return x / 1e6
		case string:
			if n, err := strconv.ParseFloat(x, 64); err == nil {
				return n / 1e6
			}
		}
	}
	// Fallback: derive from start/end timestamps.
	st := parseTimeNanos(rec, "start_time")
	en := parseTimeNanos(rec, "end_time")
	if !st.IsZero() && !en.IsZero() && en.After(st) {
		return float64(en.Sub(st)) / float64(time.Millisecond)
	}
	return 0
}

// parseSpanTimeMs parses a timestamp column to ms since epoch.
func parseSpanTimeMs(rec map[string]interface{}, key string) float64 {
	t := parseTimeNanos(rec, key)
	if t.IsZero() {
		return 0
	}
	return float64(t.UnixNano()) / float64(time.Millisecond)
}

func parseTimeNanos(rec map[string]interface{}, key string) time.Time {
	v := rec[key]
	s, ok := v.(string)
	if !ok || s == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, s); err == nil {
		return t
	}
	return time.Time{}
}

// encodeTraceTags collects all record fields that aren't already mapped to
// dedicated columns, JSON-encodes them as [{key, value}, …], and returns
// the resulting string for the `tags` column. The OTel traces panel
// parses this and renders the table of attributes per span.
func encodeTraceTags(rec map[string]interface{}) string {
	reserved := traceReservedKeys
	type kv struct {
		Key   string      `json:"key"`
		Value interface{} `json:"value"`
	}
	out := make([]kv, 0, len(rec))
	for k, v := range rec {
		if _, ok := reserved[k]; ok {
			continue
		}
		if v == nil {
			continue
		}
		out = append(out, kv{Key: k, Value: stringifyTraceValue(v)})
	}
	b, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(b)
}

var traceReservedKeys = map[string]struct{}{
	"trace.id":                       {},
	"span.id":                        {},
	"span.parent_id":                 {},
	"span.name":                      {},
	"service.name":                   {},
	"dt.service.name":                {},
	"start_time":                     {},
	"end_time":                       {},
	"duration":                       {},
	"status.code":                    {},
	"dt.failure_detection.verdict":   {},
	"dt.failure_detection.ruleset_id": {},
}

func stringifyTraceValue(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return formatFloatLabel(x)
	case bool:
		return fmt.Sprintf("%t", x)
	case nil:
		return ""
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return fmt.Sprintf("%v", v)
		}
		return string(b)
	}
}

func firstNonEmpty(s ...string) string {
	for _, v := range s {
		if v != "" {
			return v
		}
	}
	return ""
}
