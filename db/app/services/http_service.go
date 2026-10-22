package services

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/twitchtv/twirp"
	"go.opentelemetry.io/otel/attribute"

	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/app/types"
	"github.com/wolfymaster/woofx3/db/config"
)

// RouteSetupFunc registers every route, or fails when a route cannot be built
// from the app's configuration.
type RouteSetupFunc func(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) error

type HTTPServerService struct {
	*runtime.BaseService[*http.Server]
	logger           *slog.Logger
	httpHost         string
	httpPort         string
	serverConfig     config.HTTPServerConfig
	auth             *middleware.ServiceAuth
	app              interface{}
	server           *http.Server
	routeSetup       RouteSetupFunc
	casbinMiddleware interface {
		HTTPMiddleware(http.Handler) http.Handler
	}
	// Guards the one-time route registration below. http.ServeMux.Handle
	// panics on a duplicate pattern, so two first requests racing here take
	// the process down rather than merely duplicating work.
	initMu            sync.Mutex
	routesInitialized atomic.Bool
	mux               *http.ServeMux
}

func NewHTTPServerService(
	app interface{},
	httpHost string,
	httpPort string,
	serverConfig config.HTTPServerConfig,
	auth *middleware.ServiceAuth,
	logger *slog.Logger,
	routeSetup RouteSetupFunc,
) (*HTTPServerService, error) {
	if auth == nil {
		return nil, fmt.Errorf("http server: service auth is nil")
	}
	if serverConfig.MaxBodyBytes <= 0 {
		return nil, fmt.Errorf("http server: max body bytes must be positive, got %d", serverConfig.MaxBodyBytes)
	}
	return &HTTPServerService{
		// Depending on module storage orders shutdown: the server stops
		// taking requests before storage closes and makes its final flush.
		BaseService:  runtime.NewBaseServiceWithDeps[*http.Server]("http", "server", nil, false, []string{ModuleStorageServiceName}),
		logger:       logger,
		httpHost:     httpHost,
		httpPort:     httpPort,
		serverConfig: serverConfig,
		auth:         auth,
		app:          app,
		routeSetup:   routeSetup,
	}, nil
}

func (s *HTTPServerService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Setting up HTTP server")

	// Create mux but defer route setup until first request (when app.Init() has been called)
	s.mux = http.NewServeMux()
	s.routesInitialized.Store(false)

	s.server = &http.Server{
		Addr:              net.JoinHostPort(s.httpHost, s.httpPort),
		Handler:           s.handler(),
		ReadHeaderTimeout: s.serverConfig.ReadHeaderTimeout,
		ReadTimeout:       s.serverConfig.ReadTimeout,
		WriteTimeout:      s.serverConfig.WriteTimeout,
		IdleTimeout:       s.serverConfig.IdleTimeout,
	}
	s.SetClient(s.server)

	go func() {
		s.logger.Info("Starting HTTP server", "addr", s.server.Addr)
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("HTTP server failed", "error", err)
		}
	}()

	return s.BaseService.Connect(ctx, appCtx)
}

// handler is the full request chain, outermost first: the body limit, so no
// layer reads more than MaxBodyBytes; tracing, so the request span is on the
// context for everything after it; logging, so refused requests are recorded
// too; service auth; then lazy route setup and the Twirp handlers.
func (s *HTTPServerService) handler() http.Handler {
	var handler http.Handler = http.HandlerFunc(s.lazyInitHandler)
	handler = s.auth.Wrap(handler)
	handler = s.loggingMiddleware(handler)
	handler = s.tracingMiddleware(handler)
	return limitBody(handler, s.serverConfig.MaxBodyBytes)
}

// limitBody refuses a request whose declared length is over maxBytes with 413
// and caps what any handler can read from the rest. A body that grows past the
// cap without declaring its length fails as it is read, which Twirp reports as
// a malformed request.
func limitBody(next http.Handler, maxBytes int64) http.Handler {
	limited := http.MaxBytesHandler(next, maxBytes)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > maxBytes {
			writeBodyTooLarge(w, maxBytes)
			return
		}
		limited.ServeHTTP(w, r)
	})
}

// twirpErrorBody is the JSON shape Twirp clients decode errors from.
type twirpErrorBody struct {
	Code string `json:"code"`
	Msg  string `json:"msg"`
}

// writeBodyTooLarge answers in Twirp's JSON error shape so Twirp clients decode
// it. Twirp has no error code for 413, so the status is written by hand.
func writeBodyTooLarge(w http.ResponseWriter, maxBytes int64) {
	body, err := json.Marshal(twirpErrorBody{
		Code: string(twirp.Malformed),
		Msg:  fmt.Sprintf("request body exceeds %d bytes", maxBytes),
	})
	if err != nil {
		http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusRequestEntityTooLarge)
	_, _ = w.Write(body) // The status is already sent; a failed write leaves nothing to report it to.
}

func (s *HTTPServerService) lazyInitHandler(w http.ResponseWriter, r *http.Request) {
	// Initialize routes on first request if not already done
	if !s.routesInitialized.Load() {
		s.logger.Info("Initializing routes on first request")

		if appWithMethods, ok := s.app.(interface {
			App() *types.App
		}); ok {
			app := appWithMethods.App()

			// Wait up to 30s for Init() to complete (Casbin may not be set yet
			// since HTTP starts in service batch 1 and Init() runs after all
			// services connect). Waiting outside ensureRoutes keeps concurrent
			// first requests waiting in parallel rather than end to end.
			deadline := time.Now().Add(30 * time.Second)
			for app.Casbin == nil && time.Now().Before(deadline) {
				time.Sleep(100 * time.Millisecond)
				app = appWithMethods.App()
			}

			if app.Casbin == nil {
				s.logger.Error("FATAL: app.Casbin is nil - application Init() must be called before HTTP requests")
				http.Error(w, "Service not initialized", http.StatusServiceUnavailable)
				return
			}

			if err := s.ensureRoutes(app); err != nil {
				s.logger.Error("Failed to set up routes", "error", err)
				http.Error(w, "Service initialization failed", http.StatusInternalServerError)
				return
			}
		}
	}

	// Serve the request
	s.mux.ServeHTTP(w, r)
}

// ensureRoutes registers every route on the mux exactly once.
//
// The caller's `routesInitialized` check cannot carry that guarantee on its
// own: db-proxy's callers all dial it as they start, so several requests reach
// the handler before any of them has registered a route, and each one reads
// the flag as false. Two that got through both called setupRoutes on the same
// mux, and http.ServeMux.Handle panics on a duplicate pattern rather than
// ignoring it — so the second request killed the process, reporting a conflict
// between a pattern and itself.
//
// Re-reading the flag under the lock is what makes the registration once-only;
// the check outside stays as the cheap path for every request after that.
// Failure does not latch, so a later request can retry.
func (s *HTTPServerService) ensureRoutes(app *types.App) error {
	s.initMu.Lock()
	defer s.initMu.Unlock()
	if s.routesInitialized.Load() {
		return nil
	}

	casbinMiddleware, err := middleware.NewCasbinMiddleware(app.Casbin)
	if err != nil {
		return err
	}
	s.casbinMiddleware = casbinMiddleware
	if err := s.setupRoutes(s.mux, app); err != nil {
		return err
	}
	s.routesInitialized.Store(true)
	s.logger.Info("Routes initialized successfully")
	return nil
}

func (s *HTTPServerService) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		next.ServeHTTP(wrapped, r)

		// Every service reaches the db proxy over Twirp, so a successful call
		// is routine traffic: logging it at info buries everything else. One
		// record per request, raised to warn only when the server failed.
		level := slog.LevelDebug
		if wrapped.statusCode >= http.StatusInternalServerError {
			level = slog.LevelWarn
		}
		s.logger.Log(r.Context(), level, "HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", time.Since(start).Milliseconds(),
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		)
	})
}

// tracingMiddleware opens one span per inbound request. Every Twirp RPC is
// served through this mux, so this is the single top-level entry point for the
// db proxy.
func (s *HTTPServerService) tracingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, span := logging.StartSpan(r.Context(), r.Method+" "+r.URL.Path,
			attribute.String("http.request.method", r.Method),
			attribute.String("url.path", r.URL.Path),
		)
		defer span.End()

		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}
		next.ServeHTTP(wrapped, r.WithContext(ctx))

		span.SetAttributes(attribute.Int("http.response.status_code", wrapped.statusCode))
	})
}

type responseWriter struct {
	http.ResponseWriter
	statusCode int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (s *HTTPServerService) setupRoutes(mux *http.ServeMux, app *types.App) error {
	s.logger.Info("Setting up routes")

	if s.routeSetup != nil {
		casbinMiddleware := s.casbinMiddleware.(*middleware.CasbinMiddleware)
		if err := s.routeSetup(mux, app, casbinMiddleware); err != nil {
			return fmt.Errorf("set up routes: %w", err)
		}
	}

	s.logger.Info("Routes setup completed")
	return nil
}

func (s *HTTPServerService) Disconnect(ctx context.Context) error {
	s.logger.Info("Shutting down HTTP server")

	if s.server != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()

		if err := s.server.Shutdown(shutdownCtx); err != nil {
			s.logger.Error("Error shutting down HTTP server", "error", err)
		}
	}

	return s.BaseService.Disconnect(ctx)
}
