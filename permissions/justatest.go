package main

import (
    "fmt"
    "log"
	"os"
    "github.com/casbin/casbin/v2"
    "github.com/casbin/casbin/v2/model"
	"github.com/casbin/casbin/v2/util"
    fileadapter "github.com/casbin/casbin/v2/persist/file-adapter"
)

func main() {
    // Debug: Read and print the policy file
    fmt.Println("=== Policy File Contents ===")
    content, err := os.ReadFile("testPolicy.csv")
    if err != nil {
        log.Fatalf("error reading policy file: %s", err)
    }
    fmt.Printf("File contents:\n%s\n", string(content))
    fmt.Println("===========================")

    sub := "wolfymaster"
    obj := "command/woof"
    act := "read"

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

    // Check what policies were loaded
    fmt.Println("=== Loaded Policies ===")
    allPolicies, err := e.GetPolicy()
    for i, policy := range allPolicies {
        fmt.Printf("p[%d]: %v\n", i, policy)
    }

    // Try to get p2 policies specifically
    p2Policies, err := e.GetFilteredPolicy(0, "p2")
    fmt.Println("=== p2 Policies ===")
    for i, policy := range p2Policies {
        fmt.Printf("p2[%d]: %v\n", i, policy)
    }

    groupPolicies, err := e.GetGroupingPolicy()
    for i, policy := range groupPolicies {
        fmt.Printf("g[%d]: %v\n", i, policy)
    }
    fmt.Println("=====================")


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


    ok, reason, err := e.EnforceEx(sub, obj, act)
    if err != nil {
        log.Fatalf("error: could not enforce: %s", err)
    }

    fmt.Printf("Result: %v, Reason: %v\n", ok, reason)
}