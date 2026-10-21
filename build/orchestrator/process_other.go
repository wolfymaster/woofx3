//go:build !windows

package main

import (
	"os"
	"syscall"
)

// startOSProcess starts a service in the orchestrator's process group.
func startOSProcess(path string, argv []string, attr *os.ProcAttr) (serviceHandle, error) {
	process, err := os.StartProcess(path, argv, attr)
	if err != nil {
		return nil, err
	}
	return osProcess{process: process}, nil
}

// RequestStop sends SIGTERM, which every service handles as a graceful
// shutdown.
func (p osProcess) RequestStop() error {
	return p.process.Signal(syscall.SIGTERM)
}

// bindServicesToOrchestratorLifetime does nothing here, so services outlive an
// orchestrator killed with SIGKILL.
func bindServicesToOrchestratorLifetime() error {
	return nil
}
