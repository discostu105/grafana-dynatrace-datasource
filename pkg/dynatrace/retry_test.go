package dynatrace

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestDoWithRetry_Success(t *testing.T) {
	calls := 0
	got, err := doWithRetry(context.Background(), DefaultRetryPolicy, func(int) (string, error) {
		calls++
		return "ok", nil
	})
	if err != nil || got != "ok" || calls != 1 {
		t.Fatalf("calls=%d got=%q err=%v", calls, got, err)
	}
}

func TestDoWithRetry_RetryableThenSuccess(t *testing.T) {
	calls := 0
	got, err := doWithRetry(context.Background(), RetryPolicy{MaxAttempts: 3, BaseDelay: time.Millisecond, MaxDelay: 10 * time.Millisecond}, func(attempt int) (int, error) {
		calls++
		if attempt < 2 {
			return 0, errors.New("HTTP 502 Bad Gateway")
		}
		return 42, nil
	})
	if err != nil || got != 42 || calls != 2 {
		t.Fatalf("calls=%d got=%d err=%v", calls, got, err)
	}
}

func TestDoWithRetry_NonRetryableImmediateReturn(t *testing.T) {
	calls := 0
	_, err := doWithRetry(context.Background(), DefaultRetryPolicy, func(int) (string, error) {
		calls++
		return "", errors.New("HTTP 400 invalid DQL")
	})
	if err == nil || calls != 1 {
		t.Fatalf("400 should not retry; calls=%d err=%v", calls, err)
	}
}

func TestDoWithRetry_GivesUpAfterMaxAttempts(t *testing.T) {
	calls := 0
	_, err := doWithRetry(context.Background(), RetryPolicy{MaxAttempts: 3, BaseDelay: time.Microsecond, MaxDelay: time.Millisecond}, func(int) (int, error) {
		calls++
		return 0, errors.New("HTTP 503")
	})
	if err == nil || calls != 3 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}

func TestDoWithRetry_RetryAfterHeader(t *testing.T) {
	calls := 0
	start := time.Now()
	_, err := doWithRetry(context.Background(), RetryPolicy{MaxAttempts: 2, BaseDelay: 10 * time.Second, MaxDelay: 30 * time.Second}, func(int) (int, error) {
		calls++
		return 0, &retryAfterError{StatusCode: 429, Body: "rate limited", RetryAfter: 25 * time.Millisecond}
	})
	elapsed := time.Since(start)
	if err == nil || calls != 2 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
	// 25ms Retry-After should have been used instead of the 10s BaseDelay.
	if elapsed > 500*time.Millisecond {
		t.Errorf("Retry-After ignored: elapsed=%v", elapsed)
	}
}

func TestDoWithRetry_RespectsContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()
	_, err := doWithRetry(ctx, RetryPolicy{MaxAttempts: 5, BaseDelay: 100 * time.Millisecond, MaxDelay: time.Second}, func(int) (int, error) {
		calls++
		return 0, errors.New("HTTP 503")
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context.Canceled, got %v", err)
	}
}

func TestIsRetryable(t *testing.T) {
	cases := []struct {
		err  error
		want bool
	}{
		{errors.New("HTTP 429 Too Many Requests"), true},
		{errors.New("HTTP 502 Bad Gateway"), true},
		{errors.New("EOF"), true},
		{errors.New("connection reset"), true},
		{errors.New("HTTP 400 invalid DQL"), false},
		{errors.New("HTTP 401 Unauthorized"), false},
		{context.Canceled, false},
		{context.DeadlineExceeded, false},
		{&retryAfterError{StatusCode: 429}, true},
		{&retryAfterError{StatusCode: 503}, true},
		{&retryAfterError{StatusCode: 404}, false},
	}
	for _, c := range cases {
		if got := isRetryable(c.err); got != c.want {
			t.Errorf("isRetryable(%v) = %v, want %v", c.err, got, c.want)
		}
	}
}
