package plugin

import (
	"math"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func TestInferMinMax_SetsConfigFromObservedRange(t *testing.T) {
	v := []*float64{p(10), p(15), p(20)}
	frame := data.NewFrame("A",
		data.NewField("time", nil, []float64{1, 2, 3}),
		data.NewField("val", nil, v),
	)
	inferMinMax([]*data.Frame{frame})

	cfg := frame.Fields[1].Config
	if cfg == nil || cfg.Min == nil || cfg.Max == nil {
		t.Fatalf("min/max not set: %+v", cfg)
	}
	span := 20.0 - 10.0
	pad := span * 0.1
	wantLo := 10.0 - pad
	wantHi := 20.0 + pad
	if math.Abs(float64(*cfg.Min)-wantLo) > 1e-9 || math.Abs(float64(*cfg.Max)-wantHi) > 1e-9 {
		t.Errorf("min/max = %v/%v, want %v/%v", *cfg.Min, *cfg.Max, wantLo, wantHi)
	}
}

func TestInferMinMax_TimeFieldSkipped(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []float64{1, 2, 3}),
	)
	inferMinMax([]*data.Frame{frame})
	if frame.Fields[0].Config != nil && (frame.Fields[0].Config.Min != nil || frame.Fields[0].Config.Max != nil) {
		t.Errorf("time field should not get min/max")
	}
}

func TestInferMinMax_DegenerateRangeSkipped(t *testing.T) {
	v := []*float64{p(5), p(5), p(5)}
	frame := data.NewFrame("A", data.NewField("val", nil, v))
	inferMinMax([]*data.Frame{frame})
	if frame.Fields[0].Config != nil && (frame.Fields[0].Config.Min != nil || frame.Fields[0].Config.Max != nil) {
		t.Errorf("constant series should not pin min/max")
	}
}

func TestInferMinMax_PercentClamped(t *testing.T) {
	v := []*float64{p(95), p(99), p(100)}
	frame := data.NewFrame("A", data.NewField("val", nil, v))
	frame.Fields[0].Config = &data.FieldConfig{Unit: "percent"}
	inferMinMax([]*data.Frame{frame})
	cfg := frame.Fields[0].Config
	if cfg.Min == nil || cfg.Max == nil {
		t.Fatalf("expected min/max set: %+v", cfg)
	}
	// Pad would push max past 100; clamp to 100.
	if *cfg.Max != 100 {
		t.Errorf("max = %v, want clamped to 100", *cfg.Max)
	}
	// Pad would push min below 95 but stays >= 0 for percent.
	if *cfg.Min < 0 {
		t.Errorf("min = %v, want >= 0", *cfg.Min)
	}
}

func TestInferMinMax_RespectsExistingConfig(t *testing.T) {
	v := []*float64{p(10), p(20)}
	frame := data.NewFrame("A", data.NewField("val", nil, v))
	preset := data.ConfFloat64(0)
	frame.Fields[0].Config = &data.FieldConfig{Min: &preset}
	inferMinMax([]*data.Frame{frame})
	if frame.Fields[0].Config.Min == nil || *frame.Fields[0].Config.Min != 0 {
		t.Errorf("existing Min should not be overwritten, got %v", frame.Fields[0].Config.Min)
	}
	// Max wasn't preset, so it should be inferred.
	if frame.Fields[0].Config.Max == nil {
		t.Errorf("Max should be inferred when not preset")
	}
}

func p(f float64) *float64 { return &f }
