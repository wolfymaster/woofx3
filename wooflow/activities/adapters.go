package activities

import (
        "context"

        "github.com/wolfymaster/woofx3/wooflow/internal/workflow/api"
)

// MediaAlertAdapter converts MediaAlert to api.ActivityFunc signature
func MediaAlertAdapter(ctx context.Context, params map[string]any) (api.ExecuteActionResult, error) {
        result, err := MediaAlert(ctx, params)
        
        // Properly map Success and Error based on the actual result and error
        success := err == nil
        errorMsg := ""
        if err != nil {
                errorMsg = err.Error()
        }
        
        return api.ExecuteActionResult{
                Success: success,
                Exports: result.Exports,
                Error:   errorMsg,
        }, err
}

// UpdateTimerAdapter converts UpdateTimer to api.ActivityFunc signature  
func UpdateTimerAdapter(ctx context.Context, params map[string]any) (api.ExecuteActionResult, error) {
        result, err := UpdateTimer(ctx, params)
        
        // Properly map Success and Error based on the actual result and error
        success := err == nil
        errorMsg := ""
        if err != nil {
                errorMsg = err.Error()
        }
        
        return api.ExecuteActionResult{
                Success: success,
                Exports: result.Exports,
                Error:   errorMsg,
        }, err
}