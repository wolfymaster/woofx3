// What the ogen-generated server enforces before a handler runs, and what the hand-written remainder is.
package serverprobe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gen "github.com/wolfymaster/woofx3/spike/generators/gen/ogen/slice.31"
)

// allowAll stands in for token checks; the real one maps a bearer token to a caller.
type allowAll struct{}

func (allowAll) HandleAdminBearer(ctx context.Context, _ gen.OperationName, _ gen.AdminBearer) (context.Context, error) {
	return ctx, nil
}
func (allowAll) HandleBillingBearer(ctx context.Context, _ gen.OperationName, _ gen.BillingBearer) (context.Context, error) {
	return ctx, nil
}
func (allowAll) HandleServiceBearer(ctx context.Context, _ gen.OperationName, _ gen.ServiceBearer) (context.Context, error) {
	return ctx, nil
}

type handler struct {
	gen.Handler
	got *gen.UpdateModuleRequest
}

func (h *handler) UpdateModule(_ context.Context, req *gen.UpdateModuleRequest, _ gen.UpdateModuleParams) (gen.UpdateModuleRes, error) {
	h.got = req
	return &gen.ModuleResponse{}, nil
}

func TestOgenServerEnforcesTheSchema(t *testing.T) {
	cases := []struct {
		name, body string
		want       int
	}{
		{"valid", `{"name":"a"}`, 200},
		{"unknown field (additionalProperties false)", `{"name":"a","bogus":1}`, 400},
		{"empty name (minLength 1)", `{"name":""}`, 400},
		{"missing required name", `{}`, 400},
		{"null description", `{"name":"a","description":null}`, 200},
		{"wrong type", `{"name":5}`, 400},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := &handler{}
			srv, err := gen.NewServer(h, allowAll{})
			if err != nil {
				t.Fatal(err)
			}
			req := httptest.NewRequest(http.MethodPut, "/modules/m1", strings.NewReader(c.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer x")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			if rec.Code != c.want {
				t.Errorf("status %d, want %d: %s", rec.Code, c.want, rec.Body.String())
			}
			if c.name == "null description" && !(h.got.Description.Set && h.got.Description.Null) {
				t.Errorf("null was not distinguished from absent: %+v", h.got.Description)
			}
			if c.name == "valid" && h.got.Description.Set {
				t.Errorf("absent was reported as set")
			}
			if c.want == 400 {
				t.Logf("400 body from the generated decoder (not the contract's Error envelope): %s", strings.TrimSpace(rec.Body.String()))
			}
		})
	}
}
