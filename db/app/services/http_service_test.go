package services

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
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
		routeSetup: func(mux *http.ServeMux, _ *types.App, _ *middleware.CasbinMiddleware) error {
			mu.Lock()
			registrations++
			mu.Unlock()
			// Registering the same pattern twice is what panics in production.
			mux.Handle("/twirp/common.CommonService/", http.NotFoundHandler())
			return nil
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
	if !svc.routesInitialized.Load() {
		t.Fatal("routesInitialized is false after ensureRoutes succeeded")
	}
}

// A route that cannot be built from the app's configuration fails setup
// without latching it, so the request answers an error and a later one tries
// again rather than serving a mux missing that route.
func TestEnsureRoutesReportsAFailedSetupWithoutLatching(t *testing.T) {
	attempts := 0
	svc := &HTTPServerService{
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
		mux:    http.NewServeMux(),
		routeSetup: func(_ *http.ServeMux, _ *types.App, _ *middleware.CasbinMiddleware) error {
			attempts++
			return errors.New("alert retention period must be positive")
		},
	}

	err := svc.ensureRoutes(&types.App{})
	if err == nil || !strings.Contains(err.Error(), "retention period") {
		t.Fatalf("ensureRoutes = %v, want the setup failure", err)
	}
	if svc.routesInitialized.Load() {
		t.Fatal("routesInitialized is true after setup failed")
	}
	if err := svc.ensureRoutes(&types.App{}); err == nil || attempts != 2 {
		t.Fatalf("second ensureRoutes = %v after %d attempts, want a retry that fails again", err, attempts)
	}
}
