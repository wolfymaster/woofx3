package cloudevents

import (
	"bytes"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
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
		"ui.notify.alert":                      "sceneManager/src/nats-subscriptions.ts",
		"widget.queue.skip":                    "sceneManager alert queue controls",
		"widget.queue.clear":                   "sceneManager alert queue controls",
		"widget.queue.replay":                  "sceneManager alert queue controls",
		"db.scene.updated.*":                   "sceneManager/src/nats-subscriptions.ts",
		"db.ack.>":                             "db/app/workers/ack_worker.go",
		"setting.integration.token.updated":    "api/src/routes/commands.ts",
		"barkloader.module.field_options":      "barkloader/app/src/services/field_options.rs",
		"woofwoofwoof":                         "barkloader/lib_sandbox/src/extensions/platform_chat.rs",
		"reward":                               "reward/src/index.ts",
		"webhook.woofx3_throne.throne_webhook": "webhook trigger events the engine fires",
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
		{"message.send", "message.send"},
		{"stream.online", "stream.online"},
		{"channel.cheer", "channel."},
		{"session.ended", "session."},
		// Open: nothing reserves these.
		{"dbx.thing", ""},
		{"badge.awarded", ""},
		{"stream.started.notification", ""},
		{"widget.custom", ""},
		{"custom.event", ""},
		{"reward", "reward"},
		{"rewards.granted", ""},
		{"reward.granted", ""},
		{"slobsx", ""},
	}
	for _, tc := range cases {
		match, reserved := ReservedSubjectMatch(tc.subject)
		if reserved != (tc.match != "") || match != tc.match {
			t.Errorf("ReservedSubjectMatch(%q) = %q, %v; want %q", tc.subject, match, reserved, tc.match)
		}
	}
}

const barkloaderManifestValidate = "../../../../barkloader/lib_module/src/manifest_validate.rs"

var (
	rustReservedList = regexp.MustCompile(`(?s)const USER_RESERVED_EVENT_PREFIXES: \[&str; \d+\] = \[(.*?)\];`)
	rustStringConst  = regexp.MustCompile(`const (\w+): &str = "([^"]*)";`)
)

// Barkloader refuses uploaded modules that declare a command subject as an
// event; the workflow engine refuses workflows that publish one. Both read the
// same list or one of them has a hole the other closed.
func TestBarkloaderRefusesTheSameCommandSubjects(t *testing.T) {
	source, err := os.ReadFile(barkloaderManifestValidate)
	if err != nil {
		t.Fatalf("read %s: %v", barkloaderManifestValidate, err)
	}
	list := rustReservedList.FindSubmatch(source)
	if list == nil {
		if bytes.Contains(source, []byte("USER_RESERVED_EVENT_PREFIXES")) {
			t.Fatalf("%s declares USER_RESERVED_EVENT_PREFIXES in a form this test cannot read; update rustReservedList", barkloaderManifestValidate)
		}
		t.Skipf("%s declares no USER_RESERVED_EVENT_PREFIXES yet", barkloaderManifestValidate)
	}

	consts := map[string]string{}
	dir := filepath.Dir(barkloaderManifestValidate)
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read %s: %v", dir, err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".rs") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", entry.Name(), err)
		}
		for _, m := range rustStringConst.FindAllSubmatch(body, -1) {
			consts[string(m[1])] = string(m[2])
		}
	}

	var rust []string
	for _, item := range strings.Split(string(list[1]), ",") {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		if unquoted, err := strconv.Unquote(item); err == nil {
			rust = append(rust, unquoted)
			continue
		}
		value, ok := consts[item]
		if !ok {
			t.Fatalf("USER_RESERVED_EVENT_PREFIXES entry %s is neither a string nor a known &str const", item)
		}
		rust = append(rust, value)
	}

	want := append([]string{}, CommandSubjectPrefixes...)
	sort.Strings(want)
	sort.Strings(rust)
	if strings.Join(rust, "|") != strings.Join(want, "|") {
		t.Errorf("barkloader reserves %q, CommandSubjectPrefixes is %q", rust, want)
	}
}
