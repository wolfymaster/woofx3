package main

import (
	"fmt"

	barkloader "github.com/wolfymaster/woofx3/clients/barkloader"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

func NewBarkloaderAction() tasks.ActionFunc[AppServices] {
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		// Get functionName parameter
		functionName, ok := params["functionName"].(string)
		if !ok {
			return nil, fmt.Errorf("functionName parameter is required and must be a string")
		}

		// Get params parameter (can be nil)
		var args []any
		if paramsVal, exists := params["params"]; exists {
			if paramsSlice, ok := paramsVal.([]any); ok {
				args = paramsSlice
			} else {
				// If it's not a slice, wrap it in a slice
				args = []any{paramsVal}
			}
		}

		// Get barkloader client from context
		client := ctx.Services.Barkloader()
		if client == nil {
			return nil, fmt.Errorf("barkloader service not available")
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
