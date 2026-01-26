package services

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/wolfymaster/woofx3/common/runtime"
	"github.com/wolfymaster/woofx3/db/config"
)

type HTTPServerService struct {
	*runtime.BaseService[*http.Server]
	logger           *slog.Logger
	config           *config.Config
	app              interface{}
	server           *http.Server
	casbinMiddleware interface {
		HTTPMiddleware(http.Handler) http.Handler
	}
}

func NewHTTPServerService(app interface{}, config *config.Config, logger *slog.Logger) *HTTPServerService {
	return &HTTPServerService{
		BaseService: runtime.NewBaseService[*http.Server]("http", "server", nil, false), // HTTP server doesn't need external heartbeat monitoring
		logger:      logger,
		config:      config,
		app:         app,
	}
}

func (s *HTTPServerService) Connect(ctx context.Context, appCtx *runtime.ApplicationContext) error {
	s.logger.Info("Setting up HTTP server")

	mux := http.NewServeMux()

	if appWithMethods, ok := s.app.(interface {
		App() interface {
			BadgerDB() interface{}
			Casbin() interface{}
			Db() interface{}
			Logger() *slog.Logger
			NATSConn() interface{}
			EventCache() interface{}
			PublisherWorker() interface{}
			AckWorker() interface{}
			CleanupWorker() interface{}
			MetricsWorker() interface{}
			EventPublisher() interface{}
		}
	}); ok {
		app := appWithMethods.App()
		s.setupRoutes(mux, app)
	}

	var handler http.Handler = mux

	s.server = &http.Server{
		Addr:    ":" + s.config.HTTPPort,
		Handler: handler,
	}
	s.SetClient(s.server)

	go func() {
		s.logger.Info("Starting HTTP server", "port", s.config.HTTPPort)
		if err := s.server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			s.logger.Error("HTTP server failed", "error", err)
		}
	}()

	return s.BaseService.Connect(ctx, appCtx)
}

func (s *HTTPServerService) setupRoutes(mux *http.ServeMux, app interface{}) {
	s.logger.Info("Setting up routes")
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
