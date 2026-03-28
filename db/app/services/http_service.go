package services

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/app/types"
)

type RouteSetupFunc func(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware)

type HTTPServerService struct {
	*runtime.BaseService[*http.Server]
	logger     *slog.Logger
	httpPort   string
	app        interface{}
	server           *http.Server
	routeSetup       RouteSetupFunc
	casbinMiddleware interface {
		HTTPMiddleware(http.Handler) http.Handler
	}
	routesInitialized bool
	mux               *http.ServeMux
}

func NewHTTPServerService(app interface{}, httpPort string, logger *slog.Logger, routeSetup RouteSetupFunc) *HTTPServerService {
	return &HTTPServerService{
		BaseService: runtime.NewBaseService[*http.Server]("http", "server", nil, false), // HTTP server doesn't need external heartbeat monitoring
		logger:      logger,
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

	// Wrap handler with lazy initialization and logging middleware
	var handler http.Handler = http.HandlerFunc(s.lazyInitHandler)
	handler = s.loggingMiddleware(handler)

	s.server = &http.Server{
		Addr:    ":" + s.httpPort,
		Handler: handler,
	}
	s.SetClient(s.server)

	go func() {
		s.logger.Info("Starting HTTP server", "port", s.httpPort)
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

			// Assert Casbin is initialized - fail fast per Tiger Style
			if app.Casbin == nil {
				s.logger.Error("FATAL: app.Casbin is nil - application Init() must be called before HTTP requests")
				http.Error(w, "Service not initialized", http.StatusServiceUnavailable)
				return
			}

			// Create casbin middleware
			casbinMiddleware, err := middleware.NewCasbinMiddleware(app.Casbin)
			if err != nil {
				s.logger.Error("Failed to create casbin middleware", "error", err)
				http.Error(w, "Service initialization failed", http.StatusInternalServerError)
				return
			}
			s.casbinMiddleware = casbinMiddleware
			s.setupRoutes(s.mux, app)
			s.routesInitialized = true
			s.logger.Info("Routes initialized successfully")
		}
	}

	// Serve the request
	s.mux.ServeHTTP(w, r)
}

func (s *HTTPServerService) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Create a response writer wrapper to capture status code
		wrapped := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

		// Log the incoming request
		s.logger.Info("HTTP request",
			"method", r.Method,
			"path", r.URL.Path,
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		)

		// Call the next handler
		next.ServeHTTP(wrapped, r)

		// Log the response
		duration := time.Since(start)
		s.logger.Info("HTTP response",
			"method", r.Method,
			"path", r.URL.Path,
			"status", wrapped.statusCode,
			"duration_ms", duration.Milliseconds(),
		)
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
