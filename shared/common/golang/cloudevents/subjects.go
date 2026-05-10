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

	// Unified widget event channel (R2 of the widget refactor).
	// Single inbound subject for everything an overlay reports about a
	// widget — alert lifecycle acks, counter increments, timer state,
	// goal hits, generic completion. CloudEvent data shape:
	//   { applicationId, moduleId, instanceId, widgetCanonicalId?,
	//     key, value, occurredAt }
	// Dispatch on `key`:
	//   "alert.lifecycle" → AlertQueueManager.handleStatus
	//   anything else     → db.upsertWidgetStatus
	SubjectWidgetEvent Subject = "widget.event"

	// Backend-authoritative alert dispatch (Phase 2). The workflow alert
	// action publishes to `ui.notify.alert` (intent); only the api
	// subscribes and enqueues. The api's AlertQueueManager publishes
	// here when it dispatches the next leased alert; streamware
	// subscribes and broadcasts to connected overlays. Decouples
	// "alert was authored" from "alert is currently being shown."
	SubjectUIAlertBroadcast Subject = "ui.alert.broadcast"

	// DB proxy workflow lifecycle events — match publisher.go:58 format:
	// "db.{entityType}.{operation}.{appId}"
	SubjectDbWorkflowCreatedPattern Subject = "db.workflow.created.*"
	SubjectDbWorkflowUpdatedPattern Subject = "db.workflow.updated.*"
	SubjectDbWorkflowDeletedPattern Subject = "db.workflow.deleted.*"

	// Module events
	SubjectModuleChange               Subject = "module.change"
	SubjectModuleAdd                  Subject = "module.change.add"
	SubjectModuleUpdate               Subject = "module.change.update"
	SubjectModuleDelete               Subject = "module.change.delete"
	SubjectModuleState                Subject = "module.change.state"
	SubjectModuleTriggerRegistered    Subject = "module.trigger.registered"
	SubjectModuleActionRegistered     Subject = "module.action.registered"
	SubjectModuleFunctionRegistered   Subject = "module.function.registered"
	SubjectModuleWidgetRegistered     Subject = "module.widget.registered"
	SubjectModuleTriggerDeregistered  Subject = "module.trigger.deregistered"
	SubjectModuleActionDeregistered   Subject = "module.action.deregistered"
	SubjectModuleFunctionDeregistered Subject = "module.function.deregistered"
	SubjectModuleWidgetDeregistered   Subject = "module.widget.deregistered"
	SubjectModuleAssetRegistered      Subject = "module.asset.registered"
	SubjectModuleAssetDeregistered    Subject = "module.asset.deregistered"

	// Module resource-instance lifecycle. Instances are runtime-created
	// rows of a kind that some installed module declares it provides
	// (counters, future timers / polls / leaderboards, etc.). The engine
	// owns identity; the module owns semantics.
	SubjectModuleResourceInstanceCreated Subject = "module.resource.instance.created"
	SubjectModuleResourceInstanceDeleted Subject = "module.resource.instance.deleted"

	// Module persistent-storage change events. Publishers emit on the
	// per-module subject `module.storage.<moduleId>.changed`; subscribers
	// (api/src/storage-change-emitter.ts) wildcard on the pattern. The
	// CloudEvents `type` is the canonical, non-wildcard string.
	SubjectModuleStorageChanged        Subject = "module.storage.changed"
	SubjectModuleStorageChangedPattern Subject = "module.storage.*.changed"

	// (Phase 4 `module.widget.status.changed` collapsed into
	//  `widget.event` during R2 — see SubjectWidgetEvent above.)

	// DB-proxy outbox patterns. Format mirrors publisher.go:
	// "db.{entityType}.{operation}.{appId}". The api/ TypeScript service
	// subscribes via these wildcards.
	SubjectDbModuleTriggerRegisteredPattern    Subject = "db.module.trigger.registered.*"
	SubjectDbModuleActionRegisteredPattern     Subject = "db.module.action.registered.*"
	SubjectDbModuleFunctionRegisteredPattern   Subject = "db.module.function.registered.*"
	SubjectDbModuleWidgetRegisteredPattern     Subject = "db.module.widget.registered.*"
	SubjectDbModuleTriggerDeregisteredPattern  Subject = "db.module.trigger.deregistered.*"
	SubjectDbModuleActionDeregisteredPattern   Subject = "db.module.action.deregistered.*"
	SubjectDbModuleFunctionDeregisteredPattern Subject = "db.module.function.deregistered.*"
	SubjectDbModuleWidgetDeregisteredPattern   Subject = "db.module.widget.deregistered.*"
	SubjectDbModuleAssetRegisteredPattern      Subject = "db.module.asset.registered.*"
	SubjectDbModuleAssetDeregisteredPattern    Subject = "db.module.asset.deregistered.*"
	SubjectDbModuleResourceInstanceCreatedPattern Subject = "db.module.resource.instance.created.*"
	SubjectDbModuleResourceInstanceDeletedPattern Subject = "db.module.resource.instance.deleted.*"

	// System events
	SubjectHeartbeat    Subject = "HEARTBEAT"
	SubjectMessageBusInit Subject = "MESSAGEBUS_INIT"
)
