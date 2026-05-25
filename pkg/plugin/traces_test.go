package plugin

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Real span record captured from Dynatrace via dtctl. Used as the golden
// input for the trace mapper.
func sampleSpan() map[string]interface{} {
	return map[string]interface{}{
		"trace.id":                       "2d164bf9b509d114e3f9363b10665722",
		"span.id":                        "8cf4cece244946bf",
		"span.parent_id":                 "f5a68bc583fef0bd",
		"span.name":                      "okey-dokey-0",
		"service.name":                   "homelab-telemetrygen",
		"start_time":                     "2026-05-25T11:58:20.128911521Z",
		"end_time":                       "2026-05-25T11:58:20.129034521Z",
		"duration":                       "123000",
		"dt.failure_detection.verdict":   "success",
		"deployment.environment":         "homelab",
		"endpoint.name":                  "okey-dokey-0",
		"host.name":                      "latitude",
		"otel.scope.name":                "telemetrygen",
		"span.kind":                      "server",
		"request.is_failed":              false,
	}
}

func TestRecordsToTraceFrame_Shape(t *testing.T) {
	frames, err := recordsToTraceFrame("A", []map[string]interface{}{sampleSpan()})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("want 1 frame, got %d", len(frames))
	}
	f := frames[0]
	if f.Meta == nil || f.Meta.PreferredVisualization != data.VisTypeTrace {
		t.Errorf("frame missing traces vis hint")
	}
	names := make([]string, 0, len(f.Fields))
	for _, fld := range f.Fields {
		names = append(names, fld.Name)
	}
	expected := []string{"traceID", "spanID", "parentSpanID", "operationName", "serviceName", "startTime", "duration", "tags", "statusCode"}
	if strings.Join(names, ",") != strings.Join(expected, ",") {
		t.Errorf("field names = %v, want %v", names, expected)
	}
}

func TestRecordsToTraceFrame_DurationInMilliseconds(t *testing.T) {
	frames, _ := recordsToTraceFrame("A", []map[string]interface{}{sampleSpan()})
	dur := frames[0].Fields[6].At(0).(float64)
	// Span is 123000 ns → 0.123 ms.
	if dur < 0.122 || dur > 0.124 {
		t.Errorf("duration = %v, want ~0.123 ms", dur)
	}
}

func TestRecordsToTraceFrame_StatusFromVerdict(t *testing.T) {
	good := sampleSpan()
	bad := sampleSpan()
	bad["dt.failure_detection.verdict"] = "failure"

	frames, _ := recordsToTraceFrame("A", []map[string]interface{}{good, bad})
	status := frames[0].Fields[8]
	if status.At(0) != "ok" {
		t.Errorf("good verdict → ok, got %v", status.At(0))
	}
	if status.At(1) != "error" {
		t.Errorf("failure verdict → error, got %v", status.At(1))
	}
}

func TestRecordsToTraceFrame_TagsJSON(t *testing.T) {
	frames, _ := recordsToTraceFrame("A", []map[string]interface{}{sampleSpan()})
	tagsRaw := frames[0].Fields[7].At(0).(string)

	var tags []map[string]interface{}
	if err := json.Unmarshal([]byte(tagsRaw), &tags); err != nil {
		t.Fatalf("tags must parse as JSON: %v\nraw=%s", err, tagsRaw)
	}
	if len(tags) == 0 {
		t.Errorf("tags should not be empty")
	}
	// Reserved keys (trace.id, span.id, …) should NOT appear in tags.
	seen := map[string]bool{}
	for _, t := range tags {
		seen[t["key"].(string)] = true
	}
	for k := range traceReservedKeys {
		if seen[k] {
			t.Errorf("reserved key %q leaked into tags", k)
		}
	}
	// One of the actual attributes should appear.
	if !seen["host.name"] {
		t.Errorf("expected host.name in tags, got %v", seen)
	}
}

func TestRecordsToTraceFrame_Empty(t *testing.T) {
	frames, err := recordsToTraceFrame("A", nil)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("expected one empty frame, got %d", len(frames))
	}
	if frames[0].Meta == nil || frames[0].Meta.PreferredVisualization != data.VisTypeTrace {
		t.Errorf("empty traces frame should still carry the traces vis hint")
	}
}

func TestIsTraceDetailShape(t *testing.T) {
	if !isTraceDetailShape([]map[string]interface{}{sampleSpan()}) {
		t.Errorf("a record with span.id should be trace-detail shape")
	}
	rollup := []map[string]interface{}{{"trace.id": "abc", "cnt": 42.0}}
	if isTraceDetailShape(rollup) {
		t.Errorf("rollup-shape (no span.id) should NOT be trace-detail")
	}
	if isTraceDetailShape(nil) {
		t.Errorf("empty records is not trace-detail")
	}
}

func TestRecordsToTraceFrame_DurationFromTimestampsWhenStringUnparseable(t *testing.T) {
	rec := sampleSpan()
	rec["duration"] = "not a number"
	frames, _ := recordsToTraceFrame("A", []map[string]interface{}{rec})
	dur := frames[0].Fields[6].At(0).(float64)
	if dur < 0.122 || dur > 0.124 {
		t.Errorf("duration fallback from timestamps wrong: %v", dur)
	}
}
