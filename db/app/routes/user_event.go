package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// UserEventRoutes registers the UserEventService Twirp handler. Casbin is not
// applied: the log is written by the engine, never on behalf of a user, and is
// gated by the proxy's existing auth surface like stream sessions.
func UserEventRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	userEventRepository := repo.NewUserEventRepository(app.Db)
	userEventService := svc.NewUserEventService(userEventRepository)
	userEventHandler := client.NewUserEventServiceServer(userEventService)
	mux.Handle(userEventHandler.PathPrefix(), userEventHandler)
}
