package activities

import (
	"context"

	"github.com/wolfymaster/woofx3/wooflow/internal/workflow/api"
	t "github.com/wolfymaster/woofx3/wooflow/internal/workflow/temporal"
)

// MediaAlertAdapter converts MediaAlert to api.ActivityFunc signature
func MediaAlertAdapter(ctx context.Context, params map[string]any) (api.ExecuteActionResult, error) {
	result, err := MediaAlert(ctx, params)
	return api.ExecuteActionResult{
		Success: true, // Set success based on error
		Exports: result.Exports,
		Error:   "",
	}, err
}

// UpdateTimerAdapter converts UpdateTimer to api.ActivityFunc signature  
func UpdateTimerAdapter(ctx context.Context, params map[string]any) (api.ExecuteActionResult, error) {
	result, err := UpdateTimer(ctx, params)
	return api.ExecuteActionResult{
		Success: true, // Set success based on error
		Exports: result.Exports,
		Error:   "",
	}, err
}