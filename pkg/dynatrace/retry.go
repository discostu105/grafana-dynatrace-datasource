package dynatrace

import (
	"context"
	"errors"
	"math/rand/v2"
	"strconv"
	"strings"
	"time"
)

// RetryPolicy controls how Do() retries a transient failure.
type RetryPolicy struct {
	MaxAttempts int           // total attempts including the first; 0 → no retry (single attempt)
	BaseDelay   time.Duration // first backoff step (e.g. 250ms)
	MaxDelay    time.Duration // cap (e.g. 5s)
}

// DefaultRetryPolicy is the policy used by Query() and Autocomplete() when
// the caller hasn't overridden one. 3 attempts ≈ ~1.75s of waiting worst
// case, which keeps panel render latency tolerable.
var DefaultRetryPolicy = RetryPolicy{
	MaxAttempts: 3,
	BaseDelay:   250 * time.Millisecond,
	MaxDelay:    5 * time.Second,
}

// doWithRetry runs op until it returns nil or until the policy gives up.
// retryAfter is consulted between attempts: if the previous error exposed
// a Retry-After hint (via a *retryAfterError), it's preferred over the
// computed backoff.
//
//nolint:unparam // generic helper; tests use multiple return types
func doWithRetry[T any](ctx context.Context, p RetryPolicy, op func(attempt int) (T, error)) (T, error) {
	var zero T
	attempts := p.MaxAttempts
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		v, err := op(attempt)
		if err == nil {
			return v, nil
		}
		lastErr = err
		if !isRetryable(err) || attempt == attempts {
			return zero, err
		}
		wait := backoff(p, attempt)
		var ra *retryAfterError
		if errors.As(err, &ra) && ra.RetryAfter > 0 {
			if ra.RetryAfter < p.MaxDelay {
				wait = ra.RetryAfter
			} else {
				wait = p.MaxDelay
			}
		}
		select {
		case <-ctx.Done():
			return zero, ctx.Err()
		case <-time.After(wait):
		}
	}
	return zero, lastErr
}

// retryAfterError is produced by Autocomplete when the response carries a
// `Retry-After` header on a retryable status.
type retryAfterError struct {
	StatusCode int
	Body       string
	RetryAfter time.Duration
}

func (e *retryAfterError) Error() string {
	return "HTTP " + strconv.Itoa(e.StatusCode) + ": " + e.Body
}

// isRetryable returns true if the error looks like a transient backend
// hiccup (429 rate-limit or 5xx). Context cancellations and 4xx other than
// 429 are non-retryable.
func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var ra *retryAfterError
	if errors.As(err, &ra) {
		return ra.StatusCode == 429 || (ra.StatusCode >= 500 && ra.StatusCode < 600)
	}
	// dtctl SDK errors come through as opaque strings. Heuristic: match
	// HTTP status hints embedded in the message.
	s := err.Error()
	for _, marker := range []string{
		"429", "Too Many Requests",
		"500", "502", "503", "504",
		"Internal Server Error", "Bad Gateway", "Service Unavailable", "Gateway Timeout",
		"connection reset", "EOF", "i/o timeout",
	} {
		if strings.Contains(s, marker) {
			return true
		}
	}
	return false
}

// backoff computes the wait before the (attempt+1)-th call.
// attempt is 1-indexed.
func backoff(p RetryPolicy, attempt int) time.Duration {
	d := p.BaseDelay << (attempt - 1)
	if d > p.MaxDelay {
		d = p.MaxDelay
	}
	// ±20% jitter to avoid thundering-herd retries from concurrent panels.
	jitter := time.Duration(float64(d) * (rand.Float64()*0.4 - 0.2))
	return d + jitter
}
