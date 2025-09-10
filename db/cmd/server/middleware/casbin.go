package middelware

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/casbin/casbin/v2"
	"github.com/twitchtv/twirp"

	"github.com/wolfymaster/woofx3/db/internal/types"
)

type CasbinMiddleware struct {
	enforcer *casbin.Enforcer
}

type requestContextKey struct{}

func NewCasbinMiddleware(enforcer *casbin.Enforcer) (*CasbinMiddleware, error) {
	return &CasbinMiddleware{
		enforcer,
	}, nil
}

// Wrap implements the twirp.Middleware interface
func (m *CasbinMiddleware) Wrap(service types.IsPermissionable) *twirp.ServerHooks {
	return &twirp.ServerHooks{
		RequestRouted: func(ctx context.Context) (context.Context, error) {
			method, ok := twirp.MethodName(ctx)
			if !ok {
				return ctx, twirp.InternalError("method name not found")
			}

			// Get request from context (stored by HTTP middleware)
			body, ok := ctx.Value(requestContextKey{}).([]byte)
			if !ok {
				return ctx, twirp.InternalError("request body not found")
			}

			var request any
			if len(body) > 0 {
				var jsonRequest map[string]any
				if err := json.Unmarshal(body, &jsonRequest); err == nil {
					request = jsonRequest
				} else {
					request = body
				}
			}

			// Check permissions
			if ok, err := service.HasPermission(ctx, m.enforcer, method, request); err != nil || !ok {
				return ctx, twirp.Unauthenticated.Error("unauthorized")
			}

			return ctx, nil
		},
	}
}

func (m *CasbinMiddleware) HTTPMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Read the request body
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Failed to read request", http.StatusBadRequest)
			return
		}

		// Restore the body
		r.Body = io.NopCloser(bytes.NewReader(body))

		// Store in context
		ctx := context.WithValue(r.Context(), requestContextKey{}, body)
		r = r.WithContext(ctx)

		// Continue to the Twirp handler
		next.ServeHTTP(w, r)
	})
}
