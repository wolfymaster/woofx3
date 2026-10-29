package cloudevents

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// concreteSubject turns a subscription pattern into a subject that matches
// it, since what must be refused is a publish that would reach the
// subscriber.
func concreteSubject(pattern string) string {
	tokens := strings.Split(pattern, ".")
	for i, t := range tokens {
		if t == "*" || t == ">" {
			tokens[i] = "x"
		}
	}
	return strings.Join(tokens, ".")
}

// Every Subject constant names something an engine service subscribes to,
// serves or publishes as itself. Read from the source so a constant added
// later without a reservation fails here rather than going unnoticed.
func TestEverySubjectConstantIsReserved(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "subjects.go", nil, 0)
	if err != nil {
		t.Fatalf("parse subjects.go: %v", err)
	}
	checked := 0
	ast.Inspect(file, func(n ast.Node) bool {
		spec, ok := n.(*ast.ValueSpec)
		if !ok {
			return true
		}
		ident, ok := spec.Type.(*ast.Ident)
		if !ok || ident.Name != "Subject" {
			return true
		}
		for i, value := range spec.Values {
			lit, ok := value.(*ast.BasicLit)
			if !ok {
				continue
			}
			subject, err := strconv.Unquote(lit.Value)
			if err != nil {
				t.Fatalf("unquote %s: %v", lit.Value, err)
			}
			checked++
			if _, reserved := ReservedSubjectMatch(concreteSubject(subject)); !reserved {
				t.Errorf("%s = %q is not reserved; add it to reserved.go", spec.Names[i].Name, subject)
			}
		}
		return true
	})
	if checked < 50 {
		t.Fatalf("checked only %d Subject constants; is subjects.go still parsed right?", checked)
	}
}

// Subjects consumed outside Go, with where. These have no Go constant, so
// they are listed here; a new one belongs on this list and in reserved.go.
func TestSubjectsConsumedOutsideGoAreReserved(t *testing.T) {
	subjects := map[string]string{
		"ui.notify.alert":                       "sceneManager/src/nats-subscriptions.ts",
		"widget.queue.skip":                     "sceneManager alert queue controls",
		"widget.queue.clear":                    "sceneManager alert queue controls",
		"widget.queue.replay":                   "sceneManager alert queue controls",
		"widget.queue.state":                    "sceneManager alert queue read",
		"db.scene.updated.*":                    "sceneManager/src/nats-subscriptions.ts",
		"db.ack.>":                              "db/app/workers/ack_worker.go",
		"setting.integration.token.updated":     "api/src/routes/context.ts",
		"setting.integration.enabled.updated":   "api/src/routes/context.ts",
		"barkloader.module.field_options":       "barkloader/app/src/services/field_options.rs",
		"webhook.woofx3_throne.throne_webhook":  "webhook trigger events the engine fires",
		"engine.companion.dashboard_credential": "api/src/relay-dashboard-edge.ts",
		"engine.companion.relay_config.set":     "connectors/src/companion/relay-config-requests.ts",
	}
	for subject, consumer := range subjects {
		if _, reserved := ReservedSubjectMatch(concreteSubject(subject)); !reserved {
			t.Errorf("%q (consumed by %s) is not reserved", subject, consumer)
		}
	}
}

func TestReservedSubjectMatch(t *testing.T) {
	cases := []struct {
		subject string
		match   string
	}{
		{"db.workflow.created.x", "db."},
		{"widget.queue.clear", "widget.queue."},
		{"engine.obs.command", "engine."},
		{"workflow.cancel", "workflow.cancel"},
		{"workflow.run.cancelled", "workflow.run."},
		// Retired, no publisher or consumer left; the name stays reserved so
		// nothing new can claim it.
		{"message.send", "message.send"},
		{"stream.online", "stream.online"},
		{"channel.cheer", "channel."},
		{"session.ended", "session."},
		{"platform.gateway.send", "platform.gateway."},
		{"platform.gateway.field_options", "platform.gateway."},
		{"command.created", "command."},
		// Open: nothing reserves these.
		{"dbx.thing", ""},
		{"badge.awarded", ""},
		{"stream.started.notification", ""},
		{"widget.custom", ""},
		{"custom.event", ""},
		{"message.sent", ""},
		{"message.send.later", ""},
		{"platform.gatewayx", ""},
		{"platform.gateway", ""},
		{"platform.other", ""},
	}
	for _, tc := range cases {
		match, reserved := ReservedSubjectMatch(tc.subject)
		if reserved != (tc.match != "") || match != tc.match {
			t.Errorf("ReservedSubjectMatch(%q) = %q, %v; want %q", tc.subject, match, reserved, tc.match)
		}
	}
}

const reservedSubjectsContractPath = "../../contracts/reserved-subjects.json"

func loadReservedSubjectsContract(t *testing.T) reservedSubjectsContract {
	t.Helper()
	raw, err := os.ReadFile(reservedSubjectsContractPath)
	if err != nil {
		t.Fatalf("read %s: %v", reservedSubjectsContractPath, err)
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var contract reservedSubjectsContract
	if err := decoder.Decode(&contract); err != nil {
		t.Fatalf("decode %s: %v", reservedSubjectsContractPath, err)
	}
	return contract
}

// reserved_data.go is generated from the contract the api and barkloader read
// directly; a contract edit without `go generate` would leave the engine
// enforcing a different list from the services around it.
func TestReservedDataMatchesContract(t *testing.T) {
	contract := loadReservedSubjectsContract(t)
	if !reflect.DeepEqual(contract, reservedSubjects) {
		t.Fatalf("reserved_data.go is stale; run `go generate ./...` in shared/common/golang/cloudevents\ncontract: %+v\ngenerated: %+v", contract, reservedSubjects)
	}
}

func TestReservedSubjectsContractInvariants(t *testing.T) {
	contract := loadReservedSubjectsContract(t)
	lists := map[string][]string{
		"commandSubjectPrefixes": contract.CommandSubjectPrefixes,
		"engineAssertedPrefixes": contract.EngineAssertedPrefixes,
		"platformEventEntries":   contract.PlatformEventEntries,
		"uploadReservedPrefixes": contract.UploadReservedPrefixes,
		"engineModuleSegments":   contract.EngineModuleSegments,
	}
	for name, entries := range lists {
		if len(entries) == 0 {
			t.Errorf("%s is empty", name)
		}
		seen := map[string]bool{}
		for _, entry := range entries {
			if entry == "" || strings.TrimSpace(entry) != entry {
				t.Errorf("%s holds a blank or padded entry %q", name, entry)
			}
			if seen[entry] {
				t.Errorf("%s lists %q twice", name, entry)
			}
			seen[entry] = true
		}
	}
	engineAsserted := setOf(contract.EngineAssertedPrefixes)
	for _, entry := range contract.PlatformEventEntries {
		if !engineAsserted[entry] {
			t.Errorf("platform event entry %q is not in engineAssertedPrefixes", entry)
		}
	}
	for _, segment := range contract.EngineModuleSegments {
		if strings.Contains(segment, ".") {
			t.Errorf("engine module segment %q must be a single subject token", segment)
		}
	}
}

// Barkloader lets an upload declare events under module.<its id>. but never
// under a namespace the engine publishes module lifecycle events in, so every
// module.* Subject constant must have its second token listed.
func TestEngineModuleSubjectsAreListedSegments(t *testing.T) {
	file, err := parser.ParseFile(token.NewFileSet(), "subjects.go", nil, 0)
	if err != nil {
		t.Fatalf("parse subjects.go: %v", err)
	}
	segments := setOf(reservedSubjects.EngineModuleSegments)
	checked := 0
	ast.Inspect(file, func(n ast.Node) bool {
		lit, ok := n.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		subject, err := strconv.Unquote(lit.Value)
		if err != nil || !strings.HasPrefix(subject, "module.") {
			return true
		}
		checked++
		segment := strings.SplitN(strings.TrimPrefix(subject, "module."), ".", 2)[0]
		if !segments[segment] {
			t.Errorf("%q publishes under module.%s., which engineModuleSegments does not list", subject, segment)
		}
		return true
	})
	if checked == 0 {
		t.Fatal("found no module.* subjects in subjects.go; is it still parsed right?")
	}
}
