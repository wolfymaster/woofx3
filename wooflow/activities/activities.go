package activities

// import (
// 	"context"

// 	t "github.com/wolfymaster/woofx3/wooflow/internal/workflow/temporal"
// 	"github.com/wolfymaster/woofx3/wooflow/topics"
// 	"go.temporal.io/sdk/activity"
// )

// func PerformSystemCommand(ctx context.Context, name string, topic string, command string, args map[string]any) (t.ExecuteActionResult, error) {
// 	logger := activity.GetLogger(ctx)
// 	logger.Info("sending system command", "topic", topic, "name", name, "args", args)

// 	return t.ExecuteActionResult{
// 		Publish: true,
// 		PublishData: map[string]any{
// 			"command": command,
// 			"args":    args,
// 		},
// 		PublishTopic: t.PublishTopic{
// 			Value: topic,
// 			Valid: true,
// 		},
// 		Exports: args,
// 	}, nil
// }

// func MediaAlert(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	// text, exists := params["text"]
// 	// if exists {
// 	// 	// check for substitution
// 	// 	for key, value := range params {
// 	// 		placeholder := "{" + key + "}"
// 	// 		text = strings.ReplaceAll(text.(string), placeholder, fmt.Sprintf("%v", value))
// 	// 	}
// 	// }
// 	// params["text"] = text

// 	substitutedParams := processPlaceholders(params, params).(map[string]any)
// 	return PerformSystemCommand(ctx, "Media Alert", topics.Slobs, "alert_message", substitutedParams)
// }

// func SendChatCommand(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Send Chat Command", topics.WoofWoofWoof, "write_message", params)
// }

// func AddChatCommand(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Add Chat Command", topics.WoofWoofWoof, "add_command", params)
// }

// func UpdateStreamInformation(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Update Stream Information", topics.Twitch, "update_stream", params)
// }

// func TimeoutUser(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Timeout User", topics.Twitch, "timeout", params)
// }

// func ShoutoutUser(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Shoutout User", topics.Twitch, "shoutout", params)
// }

// func UpdateCounter(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Update Counter", topics.Slobs, "count", params)
// }

// func UpdateTimer(ctx context.Context, params map[string]any) (t.ExecuteActionResult, error) {
// 	return PerformSystemCommand(ctx, "Update Timer", topics.Slobs, "updateTime", params)
// }
