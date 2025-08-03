package main

import (
	"os"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/gorilla/mux"
)

type App struct {
	Logger          *slog.Logger
}

func NewApp() (*App, error) {
	app := &App{}
	app.Logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	return app, nil
}

func (app *App) run() error {
	return app.startHttpServer()
}

func (app *App) startHttpServer() error {
	router := app.setupRoutes()

	port := 9005
	return http.ListenAndServe(fmt.Sprintf(":%d", port), router)
}

func (app *App) setupRoutes() *mux.Router {
	router := mux.NewRouter()

	router.HandleFunc("/policy", Policy(app.Logger)).Methods("GET")

	return router
}

func (app *App) cleanup() {
	app.Logger.Info("server exited")
}
