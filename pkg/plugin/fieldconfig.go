package plugin

import (
	"math"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// applyLegendFormat sets Field.Config.DisplayName on every non-time value
// field. The template is taken verbatim from the queryModel; Grafana
// resolves ${__field.labels.<x>} and `{{ x }}` style placeholders itself.
//
// We deliberately leave DisplayNameFromDS (set in units.go from the
// preferred label) alone — DisplayName wins, but the from-DS fallback is
// still useful when no template is provided.
func applyLegendFormat(frames []*data.Frame, format string) {
	if format == "" {
		return
	}
	for _, f := range frames {
		for _, fld := range f.Fields {
			if fld.Name == "time" {
				continue
			}
			if fld.Config == nil {
				fld.Config = &data.FieldConfig{}
			}
			fld.Config.DisplayName = format
		}
	}
}

// inferDecimals picks a sensible Field.Config.Decimals from the observed
// magnitude of the value series. Heuristic (matches what most operators
// hand-tune anyway):
//
//	|max abs val| < 1       → 4 decimals
//	|max abs val| < 100     → 3 decimals
//	|max abs val| < 10000   → 2 decimals
//	|max abs val| ≥ 10000   → 0 decimals
//
// Fields with Config.Decimals already set (e.g. via an override) are not
// touched. Fields with a unit hint like 'percent' get 1 by default.
func inferDecimals(frames []*data.Frame) {
	for _, f := range frames {
		for _, fld := range f.Fields {
			if fld.Name == "time" {
				continue
			}
			if fld.Config == nil {
				fld.Config = &data.FieldConfig{}
			}
			if fld.Config.Decimals != nil {
				continue
			}
			d := decimalsFor(fld)
			if d < 0 {
				continue
			}
			u16 := uint16(d) //nolint:gosec // decimalsFor returns 0-4
			fld.Config.Decimals = &u16
		}
	}
}

func decimalsFor(fld *data.Field) int {
	switch fld.Config.Unit {
	case "percent":
		return 1
	}
	stats := numericStats(fld)
	if !stats.any {
		return -1
	}
	max := math.Max(math.Abs(stats.min), math.Abs(stats.max))
	switch {
	case max == 0:
		return -1
	case max < 1:
		return 4
	case max < 100:
		return 3
	case max < 10000:
		return 2
	default:
		return 0
	}
}

// inferMinMax computes per-field Field.Config.Min / Max from the observed
// range of the value series. Driven by R3.6: gauges, bar gauges, and any
// visualisation that auto-scales picks these up. Skip when the user has
// already pinned a bound or when the range is degenerate (no points / all
// same value / non-numeric field).
//
// We widen the observed range by ~10% on each side so the visual range
// doesn't pin to extreme values — matches Grafana's own thresholds-default
// widening.
func inferMinMax(frames []*data.Frame) {
	for _, f := range frames {
		for _, fld := range f.Fields {
			if fld.Name == "time" {
				continue
			}
			if fld.Config == nil {
				fld.Config = &data.FieldConfig{}
			}
			stats := numericStats(fld)
			if !stats.any || stats.max == stats.min {
				continue
			}
			span := stats.max - stats.min
			pad := math.Max(span*0.1, math.Abs(stats.max)*0.01)
			if fld.Config.Min == nil {
				lo := data.ConfFloat64(stats.min - pad)
				// For percent / ratio data we never want negative bounds.
				if fld.Config.Unit == "percent" && lo < 0 {
					lo = 0
				}
				fld.Config.Min = &lo
			}
			if fld.Config.Max == nil {
				hi := data.ConfFloat64(stats.max + pad)
				if fld.Config.Unit == "percent" && hi > 100 {
					hi = 100
				}
				fld.Config.Max = &hi
			}
		}
	}
}

type fieldStats struct {
	any      bool
	min, max float64
}

// numericStats scans the field's values once and returns observed min/max
// across float64 / *float64. NaNs and nils are skipped. Callers should
// check `any` before reading min/max.
func numericStats(fld *data.Field) fieldStats {
	s := fieldStats{min: math.Inf(1), max: math.Inf(-1)}
	for i := 0; i < fld.Len(); i++ {
		v := fld.At(i)
		var f float64
		switch x := v.(type) {
		case float64:
			f = x
		case *float64:
			if x == nil {
				continue
			}
			f = *x
		default:
			continue
		}
		if math.IsNaN(f) {
			continue
		}
		s.any = true
		if f < s.min {
			s.min = f
		}
		if f > s.max {
			s.max = f
		}
	}
	return s
}
