// Package dynatrace wraps the dtctl SDK with the narrow surface this plugin
// needs: client construction from explicit credentials, DQL execution
// (with retry + concurrency limiting), and Grail's autocomplete endpoint.
package dynatrace

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dynatrace-oss/dtctl/sdk/api/query"
	"github.com/dynatrace-oss/dtctl/sdk/httpclient"
)

// DefaultConcurrency caps how many Grail calls one Client makes in
// parallel. Grafana can fire many panel queries in parallel on a busy
// dashboard; without a cap we'd hammer Grail's query budget and start
// taking 429s for fixable reasons.
const DefaultConcurrency = 8

type Client struct {
	handler   *query.Handler
	tenantURL string
	token     string
	http      *http.Client
	sem       chan struct{} // buffered, len == concurrency limit
}

// Options tunes a Client at construction time.
type Options struct {
	Concurrency int           // max in-flight Grail calls per client; 0 → DefaultConcurrency
	HTTPTimeout time.Duration // outbound HTTP timeout for non-SDK calls (Autocomplete); 0 → 15s
}

// New constructs an authenticated DQL client from a tenant URL and platform
// token.
func New(tenantURL, token string) (*Client, error) {
	return NewWith(tenantURL, token, Options{})
}

// NewWith is New() with overridable Options.
func NewWith(tenantURL, token string, opts Options) (*Client, error) {
	if tenantURL == "" {
		return nil, fmt.Errorf("tenant URL is empty")
	}
	if token == "" {
		return nil, fmt.Errorf("API token is empty")
	}

	httpClient, err := httpclient.New(tenantURL, httpclient.WithToken(token))
	if err != nil {
		return nil, fmt.Errorf("constructing http client: %w", err)
	}

	conc := opts.Concurrency
	if conc <= 0 {
		conc = DefaultConcurrency
	}
	timeout := opts.HTTPTimeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	return &Client{
		handler:   query.NewHandler(httpClient),
		tenantURL: strings.TrimRight(tenantURL, "/"),
		token:     token,
		http:      &http.Client{Timeout: timeout},
		sem:       make(chan struct{}, conc),
	}, nil
}

// acquire blocks until a concurrency slot is free or ctx is cancelled.
// Returns a release func; release is a no-op on cancelled acquire.
func (c *Client) acquire(ctx context.Context) (func(), error) {
	select {
	case c.sem <- struct{}{}:
		return func() { <-c.sem }, nil
	case <-ctx.Done():
		return func() {}, ctx.Err()
	}
}

// Query runs a DQL query via execute+poll, with retry on transient errors
// (429 + 5xx + transport hiccups). Zero from/to means "let Grail use its
// defaults" (used by CheckHealth's `data record` probe).
func (c *Client) Query(ctx context.Context, dql string, from, to time.Time) (*query.Response, error) {
	release, err := c.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	req := query.ExecuteRequest{Query: dql}
	if !from.IsZero() {
		req.DefaultTimeframeStart = from.UTC().Format(time.RFC3339)
	}
	if !to.IsZero() {
		req.DefaultTimeframeEnd = to.UTC().Format(time.RFC3339)
	}
	return doWithRetry(ctx, DefaultRetryPolicy, func(int) (*query.Response, error) {
		return c.handler.ExecuteAndPoll(ctx, req, nil)
	})
}

// Autocomplete proxies Grail's autocomplete endpoint at
// /platform/storage/query/v1/query:autocomplete with retry + concurrency
// limiting matching Query(). body is the raw JSON payload (e.g.
// `{"query":"fetch ","position":6}`); the response body is streamed back
// verbatim.
func (c *Client) Autocomplete(ctx context.Context, body []byte) ([]byte, error) {
	release, err := c.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	endpoint := c.tenantURL + "/platform/storage/query/v1/query:autocomplete"

	return doWithRetry(ctx, DefaultRetryPolicy, func(int) ([]byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.http.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		out, rerr := io.ReadAll(resp.Body)
		if rerr != nil {
			return nil, rerr
		}
		if resp.StatusCode >= 400 {
			return nil, &retryAfterError{
				StatusCode: resp.StatusCode,
				Body:       string(out),
				RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After")),
			}
		}
		return out, nil
	})
}

// parseRetryAfter accepts the Retry-After header in either delay-seconds
// or HTTP-date format; returns 0 on unparseable input.
func parseRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if n, err := strconv.Atoi(v); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		d := time.Until(t)
		if d > 0 {
			return d
		}
	}
	return 0
}
