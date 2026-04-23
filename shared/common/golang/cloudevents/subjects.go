package cloudevents

type Subject string

const (
	// Twitch user events
	SubjectTwitchChatMessage      Subject = "message.user.twitch"
	SubjectTwitchCheer            Subject = "cheer.user.twitch"
	SubjectTwitchFollow           Subject = "follow.user.twitch"
	SubjectTwitchSubscribe        Subject = "subscribe.user.twitch"
	SubjectTwitchSubscriptionGift Subject = "subscription.gift.twitch"
	SubjectTwitchStreamOnline     Subject = "online.user.twitch"

	// Twitch channel events
	SubjectTwitchHypeTrainBegin Subject = "hypetrain.channel.twitch"

	// Twitch API commands
	SubjectTwitchApi Subject = "twitchapi"

	// Chat events (platform-agnostic; payload carries `platform` discriminator)
	SubjectChatSend Subject = "message.send"

	// Chat command events — subject pattern `chat.command.<slug>` emitted by
	// woofwoofwoof when a chat command matches. The wildcard is documentation;
	// the workflow engine subscribes to concrete subjects via the reactive
	// registrar at workflow-creation time.
	SubjectChatCommandPattern Subject = "chat.command.*"

	// Slobs / OBS events
	SubjectSlobs Subject = "slobs"

	// Workflow events
	SubjectWorkflowExecute Subject = "workflow.execute"

	// DB proxy workflow lifecycle events — match publisher.go:58 format:
	// "db.{entityType}.{operation}.{appId}"
	SubjectDbWorkflowCreatedPattern Subject = "db.workflow.created.*"
	SubjectDbWorkflowUpdatedPattern Subject = "db.workflow.updated.*"
	SubjectDbWorkflowDeletedPattern Subject = "db.workflow.deleted.*"

	// Module events
	SubjectModuleChange            Subject = "module.change"
	SubjectModuleAdd               Subject = "module.change.add"
	SubjectModuleUpdate            Subject = "module.change.update"
	SubjectModuleDelete            Subject = "module.change.delete"
	SubjectModuleState             Subject = "module.change.state"
	SubjectModuleTriggerRegistered Subject = "module.trigger.registered"
	SubjectModuleActionRegistered  Subject = "module.action.registered"

	// System events
	SubjectHeartbeat    Subject = "HEARTBEAT"
	SubjectMessageBusInit Subject = "MESSAGEBUS_INIT"
)
