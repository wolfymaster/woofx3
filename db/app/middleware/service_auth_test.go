package middleware

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/twitchtv/twirp"

	commonconfig "github.com/wolfymaster/woofx3/common/config"
)

const testToken = "0123456789abcdef0123456789abcdef"

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestServiceAuthWrap(t *testing.T) {
	auth, err := NewServiceAuth(testToken, []string{"db"}, quietLogger())
	if err != nil {
		t.Fatalf("NewServiceAuth: %v", err)
	}
	handler := auth.Wrap(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	cases := []struct {
		name          string
		host          string
		authorization string
		wantStatus    int
		wantCode      twirp.ErrorCode
	}{
		{name: "no header", host: "127.0.0.1:8080", wantStatus: http.StatusUnauthorized, wantCode: twirp.Unauthenticated},
		{name: "wrong token", host: "127.0.0.1:8080", authorization: "Bearer " + testToken + "x", wantStatus: http.StatusUnauthorized, wantCode: twirp.Unauthenticated},
		{name: "token without scheme", host: "127.0.0.1:8080", authorization: testToken, wantStatus: http.StatusUnauthorized, wantCode: twirp.Unauthenticated},
		{name: "basic scheme", host: "127.0.0.1:8080", authorization: "Basic " + testToken, wantStatus: http.StatusUnauthorized, wantCode: twirp.Unauthenticated},
		{name: "empty bearer", host: "127.0.0.1:8080", authorization: "Bearer ", wantStatus: http.StatusUnauthorized, wantCode: twirp.Unauthenticated},
		{name: "rebinding host with the token", host: "evil.example:8080", authorization: "Bearer " + testToken, wantStatus: http.StatusForbidden, wantCode: twirp.PermissionDenied},
		{name: "rebinding host without the token", host: "evil.example", wantStatus: http.StatusForbidden, wantCode: twirp.PermissionDenied},
		{name: "no host", host: "", authorization: "Bearer " + testToken, wantStatus: http.StatusForbidden, wantCode: twirp.PermissionDenied},
		{name: "correct token on ipv4 loopback", host: "127.0.0.1:8080", authorization: "Bearer " + testToken, wantStatus: http.StatusOK},
		{name: "correct token on ipv6 loopback", host: "[::1]:8080", authorization: "Bearer " + testToken, wantStatus: http.StatusOK},
		{name: "correct token on localhost", host: "LOCALHOST:5555", authorization: "bearer " + testToken, wantStatus: http.StatusOK},
		{name: "correct token on a configured host", host: "db:8080", authorization: "Bearer " + testToken, wantStatus: http.StatusOK},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/twirp/common.CommonService/Ping", nil)
			req.Host = tc.host
			if tc.authorization != "" {
				req.Header.Set("Authorization", tc.authorization)
			}
			rec := httptest.NewRecorder()

			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, tc.wantStatus)
			}
			if tc.wantCode == "" {
				return
			}
			var envelope struct {
				Code string `json:"code"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &envelope); err != nil {
				t.Fatalf("body is not a Twirp error: %v (%s)", err, rec.Body.String())
			}
			if envelope.Code != string(tc.wantCode) {
				t.Fatalf("code = %q, want %q", envelope.Code, tc.wantCode)
			}
		})
	}
}

func TestNewServiceAuthRefusesUnusableConfig(t *testing.T) {
	cases := []struct {
		name    string
		token   string
		hosts   []string
		wantErr error
	}{
		{name: "empty token", token: "", wantErr: commonconfig.ErrSecretEmpty},
		{name: "placeholder token", token: "CHANGE_ME", wantErr: commonconfig.ErrSecretPlaceholder},
		{name: "short token", token: "short", wantErr: commonconfig.ErrSecretTooShort},
		{name: "blank allowed host", token: testToken, hosts: []string{" "}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := NewServiceAuth(tc.token, tc.hosts, quietLogger())
			if err == nil {
				t.Fatal("NewServiceAuth succeeded, want an error")
			}
			if tc.wantErr != nil && !errors.Is(err, tc.wantErr) {
				t.Fatalf("error = %v, want %v", err, tc.wantErr)
			}
		})
	}
}
