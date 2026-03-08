package routes

import (
	"net/http"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	middleware "github.com/wolfymaster/woofx3/db/app/middleware"
	svc "github.com/wolfymaster/woofx3/db/app/services"
	types "github.com/wolfymaster/woofx3/db/app/types"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

func WorkflowRoutes(mux *http.ServeMux, app *types.App, casbinMiddleware *middleware.CasbinMiddleware) {
	workflowRepository := repo.NewWorkflowRepository(app.Db)
	workflowService := svc.NewWorkflowService(workflowRepository, app.Db, app.EventPublisher)
	workflowHandler := client.NewWorkflowServiceServer(
		workflowService,
		twirp.WithServerHooks(twirp.ChainHooks(
		// TODO: Add casbin middleware wrapper if needed
		// casbinMiddleware.Wrap(workflowService),
		)),
	)
	mux.Handle(workflowHandler.PathPrefix(), workflowHandler)
}
