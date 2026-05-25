// Package dynatrace wraps the dtctl SDK with the narrow surface this plugin
// needs: tenant URL + token validation, client construction, DQL execution
// (with retry + concurrency limiting), DQL verification, and Grail's
// autocomplete endpoint.
package dynatrace

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dynatrace-oss/dtctl/sdk/api/query"
	"github.com/dynatrace-oss/dtctl/sdk/auth"
	"github.com/dynatrace-oss/dtctl/sdk/httpclient"
	dturls "github.com/dynatrace-oss/dtctl/sdk/urls"
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
	Concurrency int               // max in-flight Grail calls per client; 0 → DefaultConcurrency
	HTTPTimeout time.Duration     // outbound HTTP timeout for non-SDK calls (Autocomplete); 0 → 15s
	UserAgent   string            // User-Agent header for outbound requests; "" → SDK default
	Logger      httpclient.Logger // forwards HTTP client debug output (retries, connection setup); nil → silent
}

// New constructs an authenticated DQL client from a tenant URL and platform
// token, using default Options.
func New(tenantURL, token string) (*Client, error) {
	return NewWith(tenantURL, token, Options{})
}

// NewWith is New() with overridable Options.
func NewWith(tenantURL, token string, opts Options) (*Client, error) {
	if tenantURL == "" {
		return nil, errors.New("tenant URL is empty")
	}
	if token == "" {
		return nil, errors.New("API token is empty")
	}

	httpOpts := []httpclient.Option{httpclient.WithToken(token)}
	if opts.UserAgent != "" {
		httpOpts = append(httpOpts, httpclient.WithUserAgent(opts.UserAgent))
	}
	if opts.Logger != nil {
		httpOpts = append(httpOpts, httpclient.WithLogger(opts.Logger))
	}

	httpClient, err := httpclient.New(tenantURL, httpOpts...)
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
// defaults" (used by CheckHealth's lightweight probes). Non-zero values
// are passed as DefaultTimeframeStart/End and only apply when the DQL itself
// does not specify a from:/to: clause.
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
		defer func() { _ = resp.Body.Close() }()
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

// Verify validates DQL syntax without executing the query. Used by
// CheckHealth as a cheap auth+connectivity probe (no Grail scan budget
// consumed) and available for future editor integrations to surface inline
// syntax errors with line/column positions.
func (c *Client) Verify(ctx context.Context, dql string) (*query.VerifyResponse, error) {
	return c.handler.Verify(ctx, query.VerifyRequest{Query: dql})
}

// ValidateTenantURL checks that the URL parses, uses HTTPS, and points at a
// Dynatrace Platform endpoint. Wrong-domain mistakes (.live.dynatrace.com,
// bare .dynatrace.com, dev/sprint without .apps., Managed /e/<envid>) get
// human-readable "did you mean" suggestions from dtctl's urls package.
func ValidateTenantURL(raw string) error {
	if raw == "" {
		return errors.New("tenant URL is empty — set it in the data source config page")
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return fmt.Errorf("tenant URL must look like https://<env>.apps.dynatrace.com, got %q", raw)
	}
	if suggestions := dturls.Suggestions(raw); len(suggestions) > 0 {
		return errors.New(strings.Join(suggestions, "; "))
	}
	if !strings.Contains(strings.ToLower(u.Host), "dynatrace") {
		return fmt.Errorf("tenant URL host %q does not look like a Dynatrace endpoint", u.Host)
	}
	return nil
}

// ValidateToken checks the token has a recognised Dynatrace shape so users
// see a clear up-front error instead of a 401 from Grail at query time. API
// tokens (dt0c01.*) and platform tokens (dt0s16.*) are accepted directly;
// JWT-shaped tokens (three dot-separated segments) are accepted as OAuth
// bearers. Anything else is rejected.
func ValidateToken(token string) error {
	if token == "" {
		return errors.New("API token is empty — set it in the data source config page")
	}
	switch auth.Classify(token) {
	case auth.TokenTypeAPIToken, auth.TokenTypePlatform:
		return nil
	}
	if strings.Count(token, ".") == 2 {
		return nil
	}
	return errors.New("API token has an unrecognised shape; expected a platform token (dt0s16.*), API token (dt0c01.*), or OAuth JWT bearer")
}
