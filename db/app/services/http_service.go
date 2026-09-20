package services

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"

	"github.com/wolfymaster/woofx3/common/logging"
	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/app/types"
)

type RouteSetupFunc func(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware)

type HTTPServerService struct {
	*runtime.BaseService[*http.Server]
	logger           *slog.Logger
	httpHost         string
	httpPort         string
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
	routesInitialized bool
	mux               *http.ServeMux
}

func NewHTTPServerService(app interface{}, httpHost string, httpPort string, logger *slog.Logger, routeSetup RouteSetupFunc) *HTTPServerService {
	return &HTTPServerService{
		BaseService: runtime.NewBaseService[*http.Server]("http", "server", nil, false), // HTTP server doesn't need external heartbeat monitoring
		logger:      logger,
		httpHost:    httpHost,
		httpPort:    httpPort,
		app:         app,
		routeSetup:  routeSetup,
	}
}

func (s *HTTPServerService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Setting up HTTP server")

	// Create mux but defer route setup until first request (when app.Init() has been called)
	s.mux = http.NewServeMux()
	s.routesInitialized = false

	// Wrap handler with lazy initialization, logging, and tracing middleware.
	// Tracing sits outermost so the request span is already on the context by
	// the time the logging middleware and the Twirp handlers run.
	var handler http.Handler = http.HandlerFunc(s.lazyInitHandler)
	handler = s.loggingMiddleware(handler)
	handler = s.tracingMiddleware(handler)

	s.server = &http.Server{
		Addr:    net.JoinHostPort(s.httpHost, s.httpPort),
		Handler: handler,
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

func (s *HTTPServerService) lazyInitHandler(w http.ResponseWriter, r *http.Request) {
	// Initialize routes on first request if not already done
	if !s.routesInitialized {
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
				s.logger.Error("Failed to create casbin middleware", "error", err)
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
	if s.routesInitialized {
		return nil
	}

	casbinMiddleware, err := middleware.NewCasbinMiddleware(app.Casbin)
	if err != nil {
		return err
	}
	s.casbinMiddleware = casbinMiddleware
	s.setupRoutes(s.mux, app)
	s.routesInitialized = true
	s.logger.Info("Routes initialized successfully")
	return nil
}

func (s *HTTPServerService) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Create a response writer wrapper to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Log the incoming request
		s.logger.InfoContext(r.Context(), "HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		)

		// Call the next handler
		next.ServeHTTP(wrapped, r)

		// Log the response
		duration := time.Since(start)
		s.logger.InfoContext(r.Context(), "HTTP response",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", duration.Milliseconds(),
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

func (s *HTTPServerService) setupRoutes(mux *http.ServeMux, app *types.App) {
	s.logger.Info("Setting up routes")

	if s.routeSetup != nil {
		casbinMiddleware := s.casbinMiddleware.(*middleware.CasbinMiddleware)
		s.routeSetup(mux, app, casbinMiddleware)
	}

	s.logger.Info("Routes setup completed")
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
