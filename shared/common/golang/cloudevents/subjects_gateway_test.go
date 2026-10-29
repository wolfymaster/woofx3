package cloudevents

import (
	"encoding/json"
	"os"
	"testing"
)

// The Go constants and the platform gateway contract name the same subjects.
// The contract is read from disk so this module needs no dependency on the
// generated platformgateway package.
func TestPlatformGatewaySubjectsMatchTheGatewayContract(t *testing.T) {
	raw, err := os.ReadFile("../../contracts/platform-gateway.json")
	if err != nil {
		t.Fatalf("read platform-gateway.json: %v", err)
	}
	var contract struct {
		Subjects map[string]string `json:"subjects"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("decode platform-gateway.json: %v", err)
	}
	want := map[string]Subject{
		"send":         SubjectPlatformGatewaySend,
		"capabilities": SubjectPlatformGatewayCapabilities,
		"fieldOptions": SubjectPlatformGatewayFieldOptions,
	}
	if len(contract.Subjects) != len(want) {
		t.Fatalf("contract declares %d subjects, constants cover %d", len(contract.Subjects), len(want))
	}
	for name, constant := range want {
		if got := contract.Subjects[name]; got != string(constant) {
			t.Errorf("subjects.%s = %q in the contract, %q in subjects.go", name, got, constant)
		}
	}
}
