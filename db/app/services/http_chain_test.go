package services

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/twitchtv/twirp"

	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/config"
)

const chainTestToken = "0123456789abcdef0123456789abcdef"

type pingOnly struct{}

func (pingOnly) Ping(context.Context, *client.PingRequest) (*client.PingResponse, error) {
	return &client.PingResponse{}, nil
}

func (pingOnly) MigrationStatus(context.Context, *client.MigrationStatusRequest) (*client.MigrationStatusResponse, error) {
	return &client.MigrationStatusResponse{}, nil
}

// newChainServer serves the HTTP service's full request chain with only the
// common service routed, the way db-proxy serves it once routes are set up.
func newChainServer(t *testing.T, serverConfig config.HTTPServerConfig) *httptest.Server {
	t.Helper()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	auth, err := middleware.NewServiceAuth(chainTestToken, nil, logger)
	if err != nil {
		t.Fatalf("NewServiceAuth: %v", err)
	}
	svc, err := NewHTTPServerService(nil, "127.0.0.1", "0", serverConfig, auth, logger, nil)
	if err != nil {
		t.Fatalf("NewHTTPServerService: %v", err)
	}
	svc.mux = http.NewServeMux()
	common := client.NewCommonServiceServer(pingOnly{})
	svc.mux.Handle(common.PathPrefix(), common)
	server := httptest.NewServer(svc.handler())
	t.Cleanup(server.Close)
	return server
}

func TestHTTPChainServiceAuth(t *testing.T) {
	server := newChainServer(t, config.DefaultHTTPServerConfig())

	cases := []struct {
		name     string
		token    string
		wantCode twirp.ErrorCode
	}{
		{name: "no token", wantCode: twirp.Unauthenticated},
		{name: "wrong token", token: "fedcba9876543210fedcba9876543210", wantCode: twirp.Unauthenticated},
		{name: "correct token", token: chainTestToken},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			httpClient := server.Client()
			if tc.token != "" {
				var err error
				httpClient, err = client.WithServiceToken(httpClient, tc.token)
				if err != nil {
					t.Fatalf("WithServiceToken: %v", err)
				}
			}
			common := client.NewCommonServiceProtobufClient(server.URL, httpClient)

			_, err := common.Ping(context.Background(), &client.PingRequest{})

			if tc.wantCode == "" {
				if err != nil {
					t.Fatalf("Ping: %v", err)
				}
				return
			}
			var twerr twirp.Error
			if !errors.As(err, &twerr) {
				t.Fatalf("Ping error = %v, want a Twirp error", err)
			}
			if twerr.Code() != tc.wantCode {
				t.Fatalf("code = %q, want %q", twerr.Code(), tc.wantCode)
			}
		})
	}
}

func TestHTTPChainRefusesARebindingHost(t *testing.T) {
	server := newChainServer(t, config.DefaultHTTPServerConfig())
	req, err := http.NewRequest(http.MethodPost, server.URL+"/twirp/common.CommonService/Ping", nil)
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Host = "attacker.example"
	req.Header.Set("Authorization", "Bearer "+chainTestToken)

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusForbidden)
	}
}

func TestHTTPChainRefusesAnOversizedBody(t *testing.T) {
	serverConfig := config.DefaultHTTPServerConfig()
	serverConfig.MaxBodyBytes = 1024
	server := newChainServer(t, serverConfig)
	req, err := http.NewRequest(http.MethodPost, server.URL+"/twirp/common.CommonService/Ping", bytes.NewReader(make([]byte, 1025)))
	if err != nil {
		t.Fatalf("NewRequest: %v", err)
	}
	req.Header.Set("Content-Type", "application/protobuf")
	req.Header.Set("Authorization", "Bearer "+chainTestToken)

	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusRequestEntityTooLarge)
	}
}

// The default body cap must stay far above the largest body a caller sends.
// The bundled woofx3 manifest is the largest one shipped, and module install
// sends it, with its triggers and actions, as a handful of Twirp requests.
func TestDefaultMaxBodyBytesCoversTheBundledManifest(t *testing.T) {
	manifest, err := os.ReadFile(filepath.Join("..", "..", "..", "modules", "woofx3", "manifest.json"))
	if err != nil {
		t.Fatalf("read bundled manifest: %v", err)
	}
	const headroom = 16
	if int64(len(manifest))*headroom > config.DefaultMaxBodyBytes {
		t.Fatalf("bundled manifest is %d bytes; DefaultMaxBodyBytes (%d) no longer leaves %dx headroom",
			len(manifest), config.DefaultMaxBodyBytes, headroom)
	}
}
