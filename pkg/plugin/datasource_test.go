package plugin

import (
	"context"
	"errors"
	"fmt"
	"testing"

	dtquery "github.com/dynatrace-oss/dtctl/sdk/api/query"
	"github.com/dynatrace-oss/dtctl/sdk/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func TestQueryData(t *testing.T) {
	ds := Datasource{}

	resp, err := ds.QueryData(
		context.Background(),
		&backend.QueryDataRequest{
			Queries: []backend.DataQuery{
				{RefID: "A"},
			},
		},
	)
	if err != nil {
		t.Error(err)
	}

	if len(resp.Responses) != 1 {
		t.Fatal("QueryData must return a response")
	}
}

func TestNoticeSeverity(t *testing.T) {
	tests := []struct {
		in   string
		want data.NoticeSeverity
	}{
		{"WARNING", data.NoticeSeverityWarning},
		{"warn", data.NoticeSeverityWarning},
		{"ERROR", data.NoticeSeverityError},
		{"SEVERE", data.NoticeSeverityError},
		{"INFO", data.NoticeSeverityInfo},
		{"", data.NoticeSeverityInfo},
		{"unknown", data.NoticeSeverityInfo},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := noticeSeverity(tt.in); got != tt.want {
				t.Errorf("noticeSeverity(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
}

func TestAttachNotifications(t *testing.T) {
	t.Run("attaches to first frame only", func(t *testing.T) {
		frames := []*data.Frame{data.NewFrame("a"), data.NewFrame("b")}
		notifs := []dtquery.Notification{
			{Severity: "WARNING", Message: "sampling applied"},
			{Severity: "INFO", Message: "query completed"},
		}
		attachNotifications(frames, notifs)
		if frames[0].Meta == nil || len(frames[0].Meta.Notices) != 2 {
			t.Fatalf("expected 2 notices on first frame, got %+v", frames[0].Meta)
		}
		if frames[0].Meta.Notices[0].Severity != data.NoticeSeverityWarning {
			t.Errorf("first notice severity = %v, want warning", frames[0].Meta.Notices[0].Severity)
		}
		if frames[1].Meta != nil && len(frames[1].Meta.Notices) > 0 {
			t.Errorf("second frame should have no notices, got %+v", frames[1].Meta.Notices)
		}
	})

	t.Run("skips empty messages", func(t *testing.T) {
		frames := []*data.Frame{data.NewFrame("a")}
		attachNotifications(frames, []dtquery.Notification{{Severity: "INFO", Message: ""}})
		if frames[0].Meta != nil && len(frames[0].Meta.Notices) > 0 {
			t.Errorf("empty messages should be skipped, got %+v", frames[0].Meta.Notices)
		}
	})

	t.Run("noop on empty inputs", func(t *testing.T) {
		attachNotifications(nil, []dtquery.Notification{{Message: "x"}})
		attachNotifications([]*data.Frame{data.NewFrame("a")}, nil)
	})
}

func TestClassifyHealthError(t *testing.T) {
	tests := []struct {
		name   string
		err    error
		host   string
		expect string
	}{
		{
			name:   "401 via APIError sentinel",
			err:    httpclient.NewAPIError(401, "Unauthorized", ""),
			host:   "abc.apps.dynatrace.com",
			expect: "Authentication rejected by abc.apps.dynatrace.com",
		},
		{
			name:   "403 via APIError sentinel",
			err:    httpclient.NewAPIError(403, "Forbidden", ""),
			host:   "abc.apps.dynatrace.com",
			expect: "Token lacks required scopes",
		},
		{
			name:   "429 via APIError sentinel",
			err:    httpclient.NewAPIError(429, "Too Many Requests", ""),
			host:   "abc.apps.dynatrace.com",
			expect: "Rate limited",
		},
		{
			name:   "DNS failure",
			err:    errors.New("Get https://x/: dial tcp: lookup x: no such host"),
			host:   "x",
			expect: "Cannot reach",
		},
		{
			name:   "TLS failure",
			err:    errors.New("x509: certificate signed by unknown authority"),
			host:   "abc.apps.dynatrace.com",
			expect: "TLS error",
		},
		{
			name:   "wrapped 401 still detected",
			err:    fmt.Errorf("query verification failed: %w", httpclient.NewAPIError(401, "Unauthorized", "")),
			host:   "abc.apps.dynatrace.com",
			expect: "Authentication rejected",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyHealthError(tt.host, tt.err)
			if !contains(got, tt.expect) {
				t.Errorf("classifyHealthError = %q, want substring %q", got, tt.expect)
			}
		})
	}
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
