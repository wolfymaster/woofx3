package v1

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWithServiceTokenAttachesTheHeader(t *testing.T) {
	var mu sync.Mutex
	var got string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		got = r.Header.Get("Authorization")
		mu.Unlock()
		w.Header().Set("Content-Type", "application/protobuf")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	httpClient, err := WithServiceToken(nil, " service-token ")
	if err != nil {
		t.Fatalf("WithServiceToken: %v", err)
	}
	client := NewDbProxyClient(server.URL, httpClient)
	if _, err := client.Common.Ping(context.Background(), &PingRequest{}); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if got != "Bearer service-token" {
		t.Fatalf("Authorization = %q, want %q", got, "Bearer service-token")
	}
}

func TestWithServiceTokenKeepsTheBaseClient(t *testing.T) {
	base := &http.Client{Timeout: 7 * time.Second}
	client, err := WithServiceToken(base, "service-token")
	if err != nil {
		t.Fatalf("WithServiceToken: %v", err)
	}
	if client == base {
		t.Fatal("WithServiceToken returned the base client instead of a copy")
	}
	if base.Transport != nil {
		t.Fatal("WithServiceToken modified the base client's transport")
	}
	if client.Timeout != base.Timeout {
		t.Fatalf("Timeout = %v, want %v", client.Timeout, base.Timeout)
	}
}

func TestWithServiceTokenRefusesABlankToken(t *testing.T) {
	for _, token := range []string{"", "   "} {
		if _, err := WithServiceToken(nil, token); err == nil {
			t.Fatalf("WithServiceToken(%q) succeeded, want an error", token)
		}
	}
}
