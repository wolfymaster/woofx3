package main

import (
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"

	"github.com/casbin/casbin/v2"
	"github.com/casbin/casbin/v2/model"
	fileadapter "github.com/casbin/casbin/v2/persist/file-adapter"
	"github.com/casbin/casbin/v2/util"
)

type CustomResponse struct {
	Granted bool `json:"granted"`
}

func Policy(logger *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub := r.URL.Query().Get("sub")
		obj := r.URL.Query().Get("obj")
		act := r.URL.Query().Get("act")

		fmt.Printf("%s %s %s \n", sub, obj, act)

		m, err := model.NewModelFromString(`
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _, _
g2 = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (hasRole(r.sub, r.obj, p.sub) && hasObjType(r.obj, p.obj) && r.act == p.act) || (keyMatch2(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act)
		`)

		if err != nil {
			log.Fatalf("error: model: %s", err)
		}

		a := fileadapter.NewAdapter("testPolicy.csv")

		e, err := casbin.NewEnforcer(m, a)
		if err != nil {
			log.Fatalf("error: enforcer: %s", err)
		}

		e.AddFunction("hasRole", func(args ...interface{}) (interface{}, error) {
			if len(args) != 3 {
				return false, nil
			}

			reqSub := args[0].(string)
			reqObj := args[1].(string)
			reqRole := args[2].(string)

			// Get all role assignments
			roles, err := e.GetGroupingPolicy()
			if err != nil {

			}

			for _, role := range roles {
				if len(role) >= 3 {
					policyUser := role[0]
					policyObj := role[1]
					policyRole := role[2]

					// Check if patterns match
					if util.KeyMatch2(reqSub, policyUser) &&
						util.KeyMatch2(reqObj, policyObj) &&
						reqRole == policyRole {
						return true, nil
					}
				}
			}
			return false, nil
		})

		// Add custom function for object type checking with pattern matching
		e.AddFunction("hasObjType", func(args ...interface{}) (interface{}, error) {
			if len(args) != 2 {
				return false, nil
			}

			reqObj := args[0].(string)
			reqObjType := args[1].(string)

			// Get all object type assignments
			objTypes, err := e.GetNamedGroupingPolicy("g2")
			if err != nil {

			}

			for _, objType := range objTypes {
				if len(objType) >= 2 {
					policyObj := objType[0]
					policyObjType := objType[1]

					// Check if patterns match
					if util.KeyMatch2(reqObj, policyObj) && reqObjType == policyObjType {
						return true, nil
					}
				}
			}
			return false, nil
		})

		ok, err := e.Enforce(sub, obj, act)
		if err != nil {
			log.Fatalf("error: could not enforce: %s", err)
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(&CustomResponse{
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
