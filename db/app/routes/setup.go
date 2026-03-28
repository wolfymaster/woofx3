package routes

import (
	"net/http"

	"github.com/wolfymaster/woofx3/db/app/middleware"
	"github.com/wolfymaster/woofx3/db/app/types"
)

// SetupAllRoutes registers all application routes with the provided mux
func SetupAllRoutes(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) {
	PingRoutes(mux)
	UserRoutes(mux, app)
	WorkflowRoutes(mux, app, casbinMiddleware)
	PermissionRoutes(mux, app)
	SettingsRoutes(mux, app)
	CommandRoutes(mux, app, casbinMiddleware)
	ModuleRoutes(mux, app)
}
