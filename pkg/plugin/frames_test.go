package plugin

import (
	"testing"
	"time"
)

func TestRecordsToFrames_Empty(t *testing.T) {
	frames, err := recordsToFrames("A", nil)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(frames) != 0 {
		t.Errorf("want 0 frames, got %d", len(frames))
	}
}

func TestRecordsToFrames_Timeseries(t *testing.T) {
	rec := map[string]interface{}{
		"timestamp": []interface{}{
			"2026-05-24T10:00:00Z",
			"2026-05-24T10:01:00Z",
			"2026-05-24T10:02:00Z",
		},
		"val":          []interface{}{1.0, 2.0, 3.0},
		"control.name": "Speicher",
		"unit":         "Kilowatt",
	}
	frames, err := recordsToFrames("A", []map[string]interface{}{rec})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("want 1 frame, got %d", len(frames))
	}
	f := frames[0]
	if len(f.Fields) != 2 {
		t.Fatalf("want 2 fields (time, val), got %d", len(f.Fields))
	}
	if f.Fields[0].Name != "time" {
		t.Errorf("first field should be 'time', got %q", f.Fields[0].Name)
	}
	val := f.Fields[1]
	if val.Name != "val" {
		t.Errorf("second field should be 'val', got %q", val.Name)
	}
	if val.Labels["control.name"] != "Speicher" {
		t.Errorf("missing control.name label: %v", val.Labels)
	}
	if val.Config == nil || val.Config.Unit != "kwatt" {
		t.Errorf("want unit=kwatt, got %#v", val.Config)
	}
	if val.Config.DisplayNameFromDS != "Speicher" {
		t.Errorf("want display name 'Speicher', got %q", val.Config.DisplayNameFromDS)
	}
}

func TestRecordsToFrames_TimeseriesMultipleDimensions(t *testing.T) {
	records := []map[string]interface{}{
		{
			"timestamp":    []interface{}{"2026-05-24T10:00:00Z", "2026-05-24T10:01:00Z"},
			"val":          []interface{}{1.0, 1.5},
			"control.name": "Heizung",
		},
		{
			"timestamp":    []interface{}{"2026-05-24T10:00:00Z", "2026-05-24T10:01:00Z"},
			"val":          []interface{}{0.5, 0.7},
			"control.name": "Speicher",
		},
	}
	frames, err := recordsToFrames("A", records)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 2 {
		t.Fatalf("want 2 frames (one per dimension), got %d", len(frames))
	}
}

func TestRecordsToFrames_TableShape(t *testing.T) {
	records := []map[string]interface{}{
		{"host.name": "h1", "cpu_percent": 75.0, "ok": true},
		{"host.name": "h2", "cpu_percent": 12.0, "ok": false},
		{"host.name": "h3", "cpu_percent": nil, "ok": true},
	}
	frames, err := recordsToFrames("A", records)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("want 1 table frame, got %d", len(frames))
	}
	f := frames[0]
	if len(f.Fields) != 3 {
		names := make([]string, 0, len(f.Fields))
		for _, fld := range f.Fields {
			names = append(names, fld.Name)
		}
		t.Fatalf("want 3 columns, got %d: %v", len(f.Fields), names)
	}
}

func TestRecordsToFrames_TableWithObjectColumn(t *testing.T) {
	// JSON object in a scalar slot should be stringified, not dropped.
	records := []map[string]interface{}{
		{"id": "abc", "meta": map[string]interface{}{"k": "v"}},
	}
	frames, err := recordsToFrames("A", records)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	f := frames[0]
	if len(f.Fields) != 2 {
		t.Fatalf("want 2 columns, got %d", len(f.Fields))
	}
}

func TestRecordsToFrames_GrailTimeframeShape(t *testing.T) {
	// Reproduces the shape dtctl returns for a real `timeseries` query.
	rec := map[string]interface{}{
		"interval": "60000000000", // 60s in nanoseconds as string
		"timeframe": map[string]interface{}{
			"start": "2026-05-24T19:00:00Z",
			"end":   "2026-05-24T19:03:00Z",
		},
		"val": []interface{}{1.0, 2.0, 3.0},
	}
	frames, err := recordsToFrames("A", []map[string]interface{}{rec})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 {
		t.Fatalf("want 1 frame, got %d", len(frames))
	}
	f := frames[0]
	if len(f.Fields) != 2 {
		t.Fatalf("want 2 fields (time, val), got %d", len(f.Fields))
	}
	if f.Fields[0].Name != "time" {
		t.Errorf("first field should be time, got %q", f.Fields[0].Name)
	}
	if f.Fields[0].Len() != 3 {
		t.Errorf("expected 3 timestamps, got %d", f.Fields[0].Len())
	}
	// Sanity: timestamps were reconstructed from start + i*interval
	first := f.Fields[0].At(0).(time.Time)
	want := time.Date(2026, 5, 24, 19, 0, 0, 0, time.UTC)
	if !first.Equal(want) {
		t.Errorf("first ts = %v, want %v", first, want)
	}
	second := f.Fields[0].At(1).(time.Time)
	if got := second.Sub(first); got != time.Minute {
		t.Errorf("step = %v, want 1m", got)
	}
}

func TestRecordsToFrames_TimestampStringColumn(t *testing.T) {
	// Column named "ts" with RFC3339 strings should be picked up as the
	// timestamp column even though it's not literally "timestamp".
	rec := map[string]interface{}{
		"ts":  []interface{}{"2026-05-24T10:00:00Z", "2026-05-24T10:01:00Z"},
		"val": []interface{}{1.0, 2.0},
	}
	frames, err := recordsToFrames("A", []map[string]interface{}{rec})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if frames[0].Fields[0].Name != "time" {
		t.Errorf("expected time field, got %q", frames[0].Fields[0].Name)
	}
}

func TestRecordsToFrames_AllScalars_Table(t *testing.T) {
	// One record, all scalars → table with one row.
	rec := map[string]interface{}{"x": 42.0, "label": "answer"}
	frames, err := recordsToFrames("A", []map[string]interface{}{rec})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(frames) != 1 || len(frames[0].Fields) != 2 {
		t.Fatalf("unexpected frames: %#v", frames)
	}
}

func TestGrafanaUnit(t *testing.T) {
	cases := map[string]string{
		"Kilowatt":      "kwatt",
		"Percent":       "percent",
		"Byte":          "bytes",
		"DegreeCelsius": "celsius",
		"kW":            "kwatt",
		"kWh":           "kwatth",
		"%":             "percent",
		"unknown":       "",
	}
	for in, want := range cases {
		if got := grafanaUnit(in); got != want {
			t.Errorf("grafanaUnit(%q) = %q, want %q", in, got, want)
		}
	}
}
