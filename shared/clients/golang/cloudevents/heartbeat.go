package cloudevents

type HeartbeatData struct {
	Application string `json:"application"`
	Ready       bool   `json:"ready"`
}

func NewHeartbeatEvent(appName string, ready bool) *BaseEvent[HeartbeatData] {
	return NewEventWithSubject(
		"com.woofx3.heartbeat",
		appName,
		"HEARTBEAT",
		HeartbeatData{
			Application: appName,
			Ready:       ready,
		},
	)
}
