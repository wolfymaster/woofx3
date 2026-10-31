package routes

import (
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

// UserPageSubmissionRoutes registers the UserPageSubmissionService Twirp
// handler. Casbin is not applied: submissions are written by the engine, never
// on behalf of a user, and are gated by the proxy's existing auth surface like
// user events.
func UserPageSubmissionRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) {
	service := svc.NewUserPageSubmissionService(
		repo.NewUserPageSubmissionRepository(app.Db),
		app.EventPublisher,
	)
	handler := client.NewUserPageSubmissionServiceServer(service)
	mux.Handle(handler.PathPrefix(), handler)
}
