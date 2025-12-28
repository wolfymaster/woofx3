package main

import (
	"fmt"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

func NewBarkloaderAction() tasks.ActionFunc[Services] {
	return func(ctx tasks.ActionContext[Services], params map[string]interface{}) (map[string]interface{}, error) {
		// Get functionName parameter
		functionName, ok := params["functionName"].(string)
		if !ok {
			return nil, fmt.Errorf("functionName parameter is required and must be a string")
		}

		// Get params parameter (can be nil)
		var args []interface{}
		if paramsVal, exists := params["params"]; exists {
			if paramsSlice, ok := paramsVal.([]interface{}); ok {
				args = paramsSlice
			} else {
				// If it's not a slice, wrap it in a slice
				args = []interface{}{paramsVal}
			}
		}

		// Get barkloader client from context
		barkloaderFn := ctx.Services.Barkloader
		if barkloaderFn == nil {
			return nil, fmt.Errorf("barkloader service not available")
		}

		client := barkloaderFn()
		if client == nil {
			return nil, fmt.Errorf("barkloader service not found")
		}

		// Ensure we're using the barkloader.Client type
		_ = (*barkloader.Client)(nil)

		// Invoke the function
		result, err := client.Invoke(functionName, args)
		if err != nil {
			return nil, fmt.Errorf("failed to invoke barkloader function %s: %w", functionName, err)
		}

		return result, nil
	}
}
