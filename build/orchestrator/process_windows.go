//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// startOSProcess starts a service in a console process group of its own, so
// RequestStop can send it a console control event without sending one to the
// orchestrator or the other services. A process in a new group ignores
// CTRL_C_EVENT, which is why the stop request is CTRL_BREAK_EVENT. A Ctrl+C
// typed into the console therefore reaches the orchestrator alone, which then
// stops the services in dependency order.
func startOSProcess(path string, argv []string, attr *os.ProcAttr) (serviceHandle, error) {
	withGroup := *attr
	sys := syscall.SysProcAttr{}
	if attr.Sys != nil {
		sys = *attr.Sys
	}
	sys.CreationFlags |= windows.CREATE_NEW_PROCESS_GROUP
	withGroup.Sys = &sys

	process, err := os.StartProcess(path, argv, &withGroup)
	if err != nil {
		return nil, err
	}
	return osProcess{process: process}, nil
}

// RequestStop sends CTRL_BREAK_EVENT to the service's process group, whose id
// is the service's pid. Go services receive it as os.Interrupt, Bun services
// as SIGBREAK, and barkloader through its ctrl-break handler. It fails when
// the orchestrator has no console to send the event through; the caller then
// kills the service.
func (p osProcess) RequestStop() error {
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(p.process.Pid))
}

// bindServicesToOrchestratorLifetime puts the orchestrator in a job object
// that kills every process in it when its last handle closes. The services
// inherit the job when they are created, and only the orchestrator holds the
// handle, so when the orchestrator exits, however it exits, the services go
// with it.
//
// The orchestrator joins the job itself, rather than assigning each service
// after starting it, so that no service, nor anything a service starts, runs
// outside the job even for the moment between creation and assignment.
//
// The handle is never closed: closing it would kill the orchestrator along
// with the services. The operating system closes it when the process exits.
func bindServicesToOrchestratorLifetime() error {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return fmt.Errorf("create job object: %w", err)
	}

	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
		BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{
			LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
		},
	}
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&limits)),
		uint32(unsafe.Sizeof(limits)),
	); err != nil {
		windows.CloseHandle(job)
		return fmt.Errorf("set job object limits: %w", err)
	}

	if err := windows.AssignProcessToJobObject(job, windows.CurrentProcess()); err != nil {
		windows.CloseHandle(job)
		return fmt.Errorf("join job object: %w", err)
	}
	return nil
}
