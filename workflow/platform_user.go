package main

import (
	"fmt"
	"strings"

	"github.com/wolfymaster/woofx3/common/platformgateway"
	"github.com/wolfymaster/woofx3/workflow/internal/expression"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
	"github.com/wolfymaster/woofx3/workflow/internal/types"
)

// userInfoFunction names the module function that looks a user up on a
// platform. A new platform adds a case here and a function in its module; no
// step changes. An exhaustive switch over the contract's closed platform enum
// is the dispatch table, so a platform without a provider is a loud error.
func userInfoFunction(platform platformgateway.PlatformID) (string, error) {
	switch platform {
	case platformgateway.PlatformTwitch:
		return "woofx3_twitch:function:getUserInfo", nil
	}
	return "", fmt.Errorf("platform %q has no user lookup", platform)
}

// userInfoPlatform resolves a step's `platform`: empty or origin means the
// platform the trigger came from.
func userInfoPlatform(params map[string]any, trigger *types.Event) (platformgateway.PlatformID, error) {
	platform, err := chatPlatformParam(params)
	if err != nil {
		return "", err
	}
	if platform == "" || platform == chatPlatformOrigin {
		if trigger == nil || trigger.Platform == "" {
			return "", fmt.Errorf("the trigger came from no platform; choose one")
		}
		platform = trigger.Platform
	}
	id := platformgateway.PlatformID(platform)
	if !id.Valid() {
		return "", fmt.Errorf("platform %q is not one this engine can look users up on; choose origin or one of %s", platform, platformIDChoices())
	}
	return id, nil
}

func platformIDChoices() string {
	ids := platformgateway.PlatformIDs()
	names := make([]string, len(ids))
	for i, id := range ids {
		names[i] = string(id)
	}
	return strings.Join(names, ", ")
}

func userInfoUserParam(params map[string]any) (string, error) {
	user, _ := params["user"].(string)
	if strings.TrimSpace(user) == "" {
		return "", fmt.Errorf("user parameter is required")
	}
	return user, nil
}

// NewPlatformUserInfoAction is the engine handler registered as
// `platform.user.info`. It resolves the platform, then runs that platform's
// module function through the same path as the `function` action, so the
// result is whatever the provider returns plus the platform it came from.
//
// Canonical id of the corresponding action declaration row:
// `woofx3:action:platform.user.info`.
func NewPlatformUserInfoAction() tasks.ActionFunc[AppServices] {
	invoke := NewBarkloaderAction()
	return func(ctx tasks.ActionContext[AppServices], params map[string]any) (map[string]any, error) {
		platform, err := userInfoPlatform(params, ctx.TriggerEvent)
		if err != nil {
			return nil, err
		}
		user, err := userInfoUserParam(params)
		if err != nil {
			return nil, err
		}
		function, err := userInfoFunction(platform)
		if err != nil {
			return nil, err
		}
		// stylegate:ignore GO-ABS-002 reason="tasks.ActionFunc takes a parameter map; this is its argument, not a payload shape of our own"
		result, err := invoke(ctx, map[string]any{"function": function, "user": user})
		if err != nil {
			return nil, fmt.Errorf("looking up %q on %s: %w", user, platform, err)
		}
		result["platform"] = string(platform)
		return result, nil
	}
}

// validatePlatformUserInfoParams is the registration check: `platform` is
// shaped right and `user` is present, either of which may be an expression
// resolved when the step runs.
func validatePlatformUserInfoParams(params map[string]any) error {
	if err := validateChatPlatformParam(params); err != nil {
		return err
	}
	if platform, _ := params["platform"].(string); platform == chatPlatformAll {
		return fmt.Errorf("platform must be %q or a platform id; a lookup answers for one platform", chatPlatformOrigin)
	}
	user, present := params["user"]
	if !present {
		return fmt.Errorf("user parameter is required")
	}
	if text, ok := user.(string); ok && !expression.HasExpression(text) && strings.TrimSpace(text) == "" {
		return fmt.Errorf("user parameter is required")
	}
	return nil
}

// platformUserInfoActionSpec never calls the module in a dry run: provider
// code is not trusted to honour a dry-run flag.
var platformUserInfoActionSpec = tasks.ActionSpec{
	SideEffect: true,
	Validate:   validatePlatformUserInfoParams,
	DryRun: func(params map[string]any) (string, error) {
		if err := validatePlatformUserInfoParams(params); err != nil {
			return "", err
		}
		return "would look up a platform user", nil
	},
}
