package main

import (
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"encoding/json"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/persist/file-adapter"
)

type CustomResponse struct {
	Granted bool `json:"granted"`
}

func Policy(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := r.URL.Query().Get("sub")
		obj := r.URL.Query().Get("obj")
		act := r.URL.Query().Get("act")

		fmt.Printf("%s %s %s", sub, obj, act)

		m, err := model.NewModelFromString(`
			[request_definition]
			r = sub, obj, act

			[policy_definition]
			p = sub, obj, act, eft

			[policy_effect]
			e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

			[matchers]
			m = r.sub == p.sub && keyMatch2(r.obj, p.obj) && r.act == p.act
		`)

		if err != nil {
			log.Fatalf("error: model: %s", err)
		}

		a := fileadapter.NewAdapter("testPolicy.csv")

		e, err := casbin.NewEnforcer(m, a)
		if err != nil {
			log.Fatalf("error: enforcer: %s", err)
		}

		ok, err := e.Enforce(sub, obj, act)
		if err != nil {
			log.Fatalf("error: could not enforce: %s", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(&CustomResponse {
			Granted: ok,
		})
	}
}


// var def core.WorkflowDefinition
// if err := json.NewDecoder(r.Body).Decode(&def); err != nil {
// 	logger.Error("Invalid request body", "error", err)
// 	http.Error(w, "Invalid request body", http.StatusBadRequest)
// 	return
// }

// if err := service.CreateWorkflowDefinition(r.Context(), &def); err != nil {
// 	http.Error(w, err.Error(), http.StatusInternalServerError)
// 	return
// }

// w.Header().Set("Content-Type", "application/json")
// json.NewEncoder(w).Encode(def)