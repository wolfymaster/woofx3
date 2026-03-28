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

	// Slobs / OBS events
	SubjectSlobs Subject = "slobs"

	// Workflow events
	SubjectWorkflowChange  Subject = "workflow.change"
	SubjectWorkflowAdd     Subject = "workflow.change.add"
	SubjectWorkflowUpdate  Subject = "workflow.change.update"
	SubjectWorkflowDelete  Subject = "workflow.change.delete"
	SubjectWorkflowExecute Subject = "workflow.execute"

	// Module events
	SubjectModuleChange            Subject = "module.change"
	SubjectModuleAdd               Subject = "module.change.add"
	SubjectModuleUpdate            Subject = "module.change.update"
	SubjectModuleDelete            Subject = "module.change.delete"
	SubjectModuleState             Subject = "module.change.state"
	SubjectModuleTriggerRegistered Subject = "module.trigger.registered"

	// System events
	SubjectHeartbeat    Subject = "HEARTBEAT"
	SubjectMessageBusInit Subject = "MESSAGEBUS_INIT"
)
