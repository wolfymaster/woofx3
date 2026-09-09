package monitor

import (
	"testing"
	"time"
)

func newTestMonitor() *NATSMonitor {
	return &NATSMonitor{
		expirationTimeout: 15 * time.Second,
		lastHeartbeats:    make(map[string]*heartbeatEntry),
	}
}

func TestNoDeclaredDependenciesIsAlwaysSatisfied(t *testing.T) {
	m := newTestMonitor()
	if pending := m.PendingDependencies(); pending != nil {
		t.Errorf("PendingDependencies() = %v, want nil", pending)
	}
}

// Silence from a service that has never spoken is indistinguishable from one
// still starting. Treating it as ready is the assumption the gate removes.
func TestAServiceThatHasNeverHeartbeatedIsPending(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader")
	pending := m.PendingDependencies()
	if len(pending) != 1 || pending[0] != "barkloader" {
		t.Errorf("PendingDependencies() = %v, want [barkloader]", pending)
	}
}

// Barkloader heartbeats throughout reconciliation with ready=false. Present
// but not ready must not release a dependent.
func TestAServiceReportingNotReadyIsPending(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader")
	m.lastHeartbeats["barkloader"] = &heartbeatEntry{lastSeen: time.Now(), ready: false}
	if pending := m.PendingDependencies(); len(pending) != 1 {
		t.Errorf("PendingDependencies() = %v, want [barkloader]", pending)
	}
}

func TestAReadyServiceIsNotPending(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader")
	m.lastHeartbeats["barkloader"] = &heartbeatEntry{lastSeen: time.Now(), ready: true}
	if pending := m.PendingDependencies(); len(pending) != 0 {
		t.Errorf("PendingDependencies() = %v, want empty", pending)
	}
}

// A service that reported ready and then went away is pending again: the
// heartbeat is a liveness claim, not a one-time announcement.
func TestAStaleReadyHeartbeatIsPending(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader")
	m.lastHeartbeats["barkloader"] = &heartbeatEntry{
		lastSeen: time.Now().Add(-30 * time.Second),
		ready:    true,
	}
	if pending := m.PendingDependencies(); len(pending) != 1 {
		t.Errorf("PendingDependencies() = %v, want [barkloader]", pending)
	}
}

func TestOnlyUnreadyDependenciesAreReported(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader", "db-proxy")
	m.lastHeartbeats["barkloader"] = &heartbeatEntry{lastSeen: time.Now(), ready: true}
	m.lastHeartbeats["db-proxy"] = &heartbeatEntry{lastSeen: time.Now(), ready: false}
	pending := m.PendingDependencies()
	if len(pending) != 1 || pending[0] != "db-proxy" {
		t.Errorf("PendingDependencies() = %v, want [db-proxy]", pending)
	}
}

func TestStartupDependenciesReportsWhatWasDeclared(t *testing.T) {
	m := newTestMonitor().WaitFor("barkloader")
	got := m.StartupDependencies()
	if len(got) != 1 || got[0] != "barkloader" {
		t.Errorf("StartupDependencies() = %v, want [barkloader]", got)
	}
}
