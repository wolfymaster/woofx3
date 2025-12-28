package runtime

type State string

const (
	StateRuntimeInit            State = "runtime_init"
	StateHealthHeartbeat        State = "health_heartbeat"
	StateHealthHeartbeatWaiting State = "health_heartbeat_waiting"
	StateServicesConnect        State = "services_connect"
	StateServicesConnected      State = "services_connected"
	StateApplicationInit        State = "application_init"
	StateApplicationRunning     State = "application_running"
	StateApplicationTerminating State = "application_terminating"
	StateRuntimeTerminating     State = "runtime_terminating"
	StateTerminated             State = "terminated"
)

type Event string

const (
	EventServicesReady       Event = "SERVICES_READY"
	EventHealthCheckFailed   Event = "HEALTH_CHECK_FAILED"
	EventHealthCheckPassed   Event = "HEALTH_CHECK_PASSED"
	EventServicesConnected   Event = "SERVICES_CONNECTED"
	EventApplicationStarted  Event = "APPLICATION_STARTED"
	EventShutdown            Event = "SHUTDOWN"
	EventError               Event = "ERROR"
)
