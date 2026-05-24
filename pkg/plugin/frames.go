package plugin

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// recordsToFrames maps a Dynatrace DQL `timeseries` result (a slice of records,
// one per series) into Grafana data frames (one frame per series).
//
// Expected per-record shape:
//   - exactly one "timestamp array" column: []interface{} of RFC3339 strings
//     (the SDK delivers JSON arrays as []interface{} of float64/string)
//   - one or more "value array" columns: []interface{} of numbers, same length
//     as the timestamp array
//   - zero or more scalar columns: dimension labels (e.g. dt.entity.host)
//
// Anything that doesn't fit this shape causes the record to be skipped with an
// error returned; callers can log it and continue.
func recordsToFrames(refID string, records []map[string]interface{}) ([]*data.Frame, error) {
	if len(records) == 0 {
		return nil, nil
	}

	frames := make([]*data.Frame, 0, len(records))
	for i, rec := range records {
		frame, err := recordToFrame(refID, rec)
		if err != nil {
			return frames, fmt.Errorf("record %d: %w", i, err)
		}
		frames = append(frames, frame)
	}
	return frames, nil
}

func recordToFrame(refID string, rec map[string]interface{}) (*data.Frame, error) {
	tsKey, times, err := extractTimestamps(rec)
	if err != nil {
		return nil, err
	}

	// Partition remaining keys: arrays of the right length -> value columns,
	// other arrays -> ignored, scalars -> dimension labels.
	keys := sortedKeys(rec, tsKey)
	labels := data.Labels{}
	valueKeys := make([]string, 0)
	valueArrs := make(map[string][]interface{}, 0)
	for _, k := range keys {
		switch v := rec[k].(type) {
		case []interface{}:
			if len(v) == len(times) {
				valueKeys = append(valueKeys, k)
				valueArrs[k] = v
			}
		case string:
			labels[k] = v
		case bool:
			labels[k] = fmt.Sprintf("%t", v)
		case float64:
			labels[k] = formatFloatLabel(v)
		case nil:
			// skip
		default:
			// objects/maps left out of labels; they're not series identifiers
		}
	}

	frame := data.NewFrame(refID,
		data.NewField("time", nil, times),
	)
	for _, k := range valueKeys {
		vals := toFloat64Slice(valueArrs[k])
		frame.Fields = append(frame.Fields, data.NewField(k, labels, vals))
	}
	return frame, nil
}

// extractTimestamps finds the column holding the per-bucket timestamps.
// Strategy: prefer a key literally named "timestamp"; otherwise pick the
// first []interface{} whose elements parse as RFC3339 strings.
func extractTimestamps(rec map[string]interface{}) (string, []time.Time, error) {
	if raw, ok := rec["timestamp"]; ok {
		if arr, ok := raw.([]interface{}); ok {
			if ts, err := parseTimestampArray(arr); err == nil {
				return "timestamp", ts, nil
			}
		}
	}
	for _, k := range sortedKeys(rec, "") {
		raw, ok := rec[k].([]interface{})
		if !ok || len(raw) == 0 {
			continue
		}
		if _, ok := raw[0].(string); !ok {
			continue
		}
		if ts, err := parseTimestampArray(raw); err == nil {
			return k, ts, nil
		}
	}
	return "", nil, fmt.Errorf("no timestamp array column found in record")
}

func parseTimestampArray(arr []interface{}) ([]time.Time, error) {
	out := make([]time.Time, len(arr))
	for i, v := range arr {
		s, ok := v.(string)
		if !ok {
			return nil, fmt.Errorf("element %d is %T, want string", i, v)
		}
		t, err := time.Parse(time.RFC3339Nano, s)
		if err != nil {
			t, err = time.Parse(time.RFC3339, s)
			if err != nil {
				return nil, fmt.Errorf("element %d: %w", i, err)
			}
		}
		out[i] = t
	}
	return out, nil
}

// toFloat64Slice converts a []interface{} of JSON numbers (and nils) into a
// dense []*float64. nils become a nil pointer; numbers wrap into a pointer so
// Grafana can render gaps correctly.
func toFloat64Slice(arr []interface{}) []*float64 {
	out := make([]*float64, len(arr))
	for i, v := range arr {
		switch n := v.(type) {
		case float64:
			f := n
			out[i] = &f
		case nil:
			out[i] = nil
		default:
			nan := math.NaN()
			out[i] = &nan
		}
	}
	return out
}

func sortedKeys(rec map[string]interface{}, exclude string) []string {
	keys := make([]string, 0, len(rec))
	for k := range rec {
		if k == exclude {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func formatFloatLabel(f float64) string {
	if f == float64(int64(f)) {
		return fmt.Sprintf("%d", int64(f))
	}
	return fmt.Sprintf("%g", f)
}
