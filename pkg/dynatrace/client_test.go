package dynatrace

import (
	"strings"
	"testing"
)

func TestValidateTenantURL(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr string // substring; "" means expect nil error
	}{
		{"empty", "", "empty"},
		{"not https", "http://abc.apps.dynatrace.com", "https"},
		{"missing host", "https://", "https"},
		{"wrong domain", "https://example.com", "does not look like a Dynatrace endpoint"},
		{"classic live SaaS", "https://abc12345.live.dynatrace.com", "apps.dynatrace.com"},
		{"bare dynatrace.com", "https://abc12345.dynatrace.com", "apps.dynatrace.com"},
		{"dev without apps", "https://abc.dev.dynatracelabs.com", "dev.apps.dynatracelabs.com"},
		{"managed /e/ pattern", "https://activegate.example.com/e/abc12345", "Managed"},
		{"good apps URL", "https://abc12345.apps.dynatrace.com", ""},
		{"good dev apps URL", "https://abc.dev.apps.dynatracelabs.com", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTenantURL(tt.input)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("expected nil error, got %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestValidateToken(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
	}{
		{"empty", "", true},
		{"api token", "dt0c01.ABCDEFGHIJ.XXXXXXXXXXXXXXXXXXXXXXXXXX", false},
		{"platform token", "dt0s16.ABCDEFGHIJ.XXXXXXXXXXXXXXXXXXXXXXXXXX", false},
		{"jwt-like", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.fakesig", false},
		{"opaque", "totally-not-a-token", true},
		{"one dot", "foo.bar", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateToken(tt.input)
			if tt.wantErr && err == nil {
				t.Fatalf("expected error, got nil")
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("expected nil error, got %v", err)
			}
		})
	}
}
