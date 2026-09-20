package services

import (
	"io"
	"log/slog"
	"net/http"
	"sync"
	"testing"

	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/app/types"
)

// Concurrent first requests must register routes exactly once.
//
// http.ServeMux.Handle panics on a duplicate pattern, so a second registration
// does not merely waste work — it takes the process down. db-proxy's callers
// all dial it as they start, which is precisely when several requests arrive
// before any route exists, so this race is the normal startup case rather than
// a rare one.
func TestEnsureRoutesRegistersOnce(t *testing.T) {
	var mu sync.Mutex
	registrations := 0

	svc := &HTTPServerService{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		mux:    http.NewServeMux(),
		routeSetup: func(mux *http.ServeMux, _ *types.App, _ *middleware.CasbinMiddleware) {
			mu.Lock()
			registrations++
			mu.Unlock()
			// Registering the same pattern twice is what panics in production.
			mux.Handle("/twirp/common.CommonService/", http.NotFoundHandler())
		},
	}

	// A nil enforcer is enough: ensureRoutes only hands it to
	// NewCasbinMiddleware, which wraps it without dereferencing. The subject
	// here is how many times registration runs, not authorization.
	app := &types.App{}

	const callers = 16
	var wg sync.WaitGroup
	errs := make([]error, callers)
	for i := range callers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			errs[i] = svc.ensureRoutes(app)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("caller %d: ensureRoutes returned %v", i, err)
		}
	}
	if registrations != 1 {
		t.Fatalf("routes registered %d times, want exactly 1", registrations)
	}
	if !svc.routesInitialized {
		t.Fatal("routesInitialized is false after ensureRoutes succeeded")
	}
}
