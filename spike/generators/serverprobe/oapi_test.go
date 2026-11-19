// What the oapi-codegen strict server enforces on its own, with no validation middleware.
package serverprobe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	gen "github.com/wolfymaster/woofx3/spike/generators/gen/oapi/slice.31"
)

type strict struct {
	gen.StrictServerInterface
	got *gen.UpdateModuleRequest
}

func (s *strict) UpdateModule(_ context.Context, r gen.UpdateModuleRequestObject) (gen.UpdateModuleResponseObject, error) {
	s.got = r.Body
	return gen.UpdateModule200JSONResponse{}, nil
}

func TestOapiStrictServerWithoutMiddleware(t *testing.T) {
	for _, c := range []struct{ name, body string }{
		{"unknown field (additionalProperties false)", `{"name":"a","bogus":1}`},
		{"empty name (minLength 1)", `{"name":""}`},
		{"missing required name", `{}`},
		{"wrong type", `{"name":5}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			h := gen.Handler(gen.NewStrictHandler(&strict{}, nil))
			req := httptest.NewRequest(http.MethodPut, "/modules/m1", strings.NewReader(c.body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, req)
			t.Logf("status %d for %s", rec.Code, c.name)
		})
	}
}
