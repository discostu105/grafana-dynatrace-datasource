// Package dynatrace wraps the dtctl SDK with the narrow surface this plugin
// needs: env-var-based construction and DQL execution.
package dynatrace

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/dynatrace-oss/dtctl/sdk/api/query"
	"github.com/dynatrace-oss/dtctl/sdk/httpclient"
)

const (
	EnvTenantURL = "DT_TENANT_URL"
	EnvToken     = "DT_TOKEN"
)

type Client struct {
	handler *query.Handler
}

// NewFromEnv reads DT_TENANT_URL and DT_TOKEN from the process environment
// and constructs an authenticated DQL client.
func NewFromEnv() (*Client, error) {
	tenantURL := os.Getenv(EnvTenantURL)
	token := os.Getenv(EnvToken)
	if tenantURL == "" {
		return nil, fmt.Errorf("%s is not set", EnvTenantURL)
	}
	if token == "" {
		return nil, fmt.Errorf("%s is not set", EnvToken)
	}

	httpClient, err := httpclient.New(tenantURL, httpclient.WithToken(token))
	if err != nil {
		return nil, fmt.Errorf("constructing http client: %w", err)
	}

	return &Client{handler: query.NewHandler(httpClient)}, nil
}

// Query runs a DQL query via execute+poll. Zero from/to means "let Grail use
// its defaults" (used by CheckHealth's `data record` probe). Non-zero values
// are passed as DefaultTimeframeStart/End and only apply when the DQL itself
// does not specify a from:/to: clause.
func (c *Client) Query(ctx context.Context, dql string, from, to time.Time) (*query.Response, error) {
	req := query.ExecuteRequest{Query: dql}
	if !from.IsZero() {
		req.DefaultTimeframeStart = from.UTC().Format(time.RFC3339)
	}
	if !to.IsZero() {
		req.DefaultTimeframeEnd = to.UTC().Format(time.RFC3339)
	}
	return c.handler.ExecuteAndPoll(ctx, req, nil)
}
