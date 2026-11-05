package routes

import (
	"fmt"
	"net/http"

	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
)

// WorkflowGroupRoutes registers the WorkflowGroupService Twirp handler.
// Casbin is not applied: like workflows, groups are managed by the api
// service, which authenticates its own callers.
func WorkflowGroupRoutes(mux *http.ServeMux, app *types.App, _ *middleware.CasbinMiddleware) error {
	service, err := svc.NewWorkflowGroupService(app.Db, app.EventPublisher)
	if err != nil {
		return fmt.Errorf("workflow group routes: %w", err)
	}
	handler := client.NewWorkflowGroupServiceServer(service)
	mux.Handle(handler.PathPrefix(), handler)
	return nil
}
