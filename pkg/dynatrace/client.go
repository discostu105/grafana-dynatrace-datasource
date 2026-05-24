// Package dynatrace wraps the dtctl SDK with the narrow surface this plugin
// needs: env-var-based construction and a single DQL execution call.
package dynatrace

import (
	"context"
	"fmt"
	"os"

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

// ExecuteDQL runs a DQL query via execute+poll and returns the raw records.
// Callers control the deadline via ctx.
func (c *Client) ExecuteDQL(ctx context.Context, dql string) ([]map[string]interface{}, error) {
	resp, err := c.handler.ExecuteAndPoll(ctx, query.ExecuteRequest{Query: dql}, nil)
	if err != nil {
		return nil, err
	}
	return resp.GetRecords(), nil
}
