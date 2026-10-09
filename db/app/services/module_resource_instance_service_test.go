package services

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"testing"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/google/uuid"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/workers"
	"github.com/wolfymaster/woofx3/db/database/models"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
	"gorm.io/gorm"
)

// newInstanceSvc runs the real SQLite migration chain and installs one module
// whose display name differs from its manifest id, the way every published
// module's does.
func newInstanceSvc(t *testing.T) (*moduleService, *gorm.DB) {
	t.Helper()
	db := openEmptySQLite(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	// Every connection to :memory: is a separate database.
	sqlDB.SetMaxOpenConns(1)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, sqliteChain(t)).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	module := &models.Module{
		ID:        uuid.New(),
		ModuleKey: "woofx3_wheel_spin:1.0.0:abc",
		ModuleID:  "woofx3_wheel_spin",
		Name:      "Wheel Spin",
		Version:   "1.0.0",
	}
	if err := db.Create(module).Error; err != nil {
		t.Fatalf("install module: %v", err)
	}
	// The outbox row's id comes from a Postgres column default that the
	// SQLite schema lacks, so the test supplies one.
	err = db.Callback().Create().Before("gorm:create").Register("test:worker_event_id", func(tx *gorm.DB) {
		if event, ok := tx.Statement.Dest.(*models.WorkerEvent); ok && event.ID == "" {
			event.ID = uuid.NewString()
		}
	})
	if err != nil {
		t.Fatalf("register outbox id callback: %v", err)
	}
	publisher := workers.NewEventPublisher(repo.NewDbEventRepository(db), slog.New(slog.DiscardHandler))
	svc := NewModuleService(
		repo.NewModuleRepository(db),
		repo.NewResourceReferenceRepository(db),
		repo.NewModuleResourceInstanceRepository(db),
		publisher,
	)
	return svc, db
}

func createWheel(t *testing.T, svc *moduleService, settingsJSON string) *client.ModuleResourceInstance {
	t.Helper()
	resp, err := svc.CreateResourceInstance(context.Background(), &client.CreateResourceInstanceRequest{
		ModuleName:   "woofx3_wheel_spin",
		Kind:         "wheel",
		InstanceId:   "prizes",
		DisplayName:  "Prizes",
		SettingsJson: settingsJSON,
	})
	if err != nil {
		t.Fatalf("CreateResourceInstance: %v", err)
	}
	return resp.Instance
}

func TestAnInstanceIsAddressedByItsModulesManifestIdNotItsName(t *testing.T) {
	svc, db := newInstanceSvc(t)

	created := createWheel(t, svc, "")
	if created.CanonicalId != "woofx3_wheel_spin:wheel:prizes" {
		t.Fatalf("canonical id = %q, want woofx3_wheel_spin:wheel:prizes", created.CanonicalId)
	}
	if created.ModuleName != "woofx3_wheel_spin" {
		t.Fatalf("module name = %q, want woofx3_wheel_spin", created.ModuleName)
	}

	got, err := svc.GetResourceInstance(context.Background(), &client.GetResourceInstanceRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:prizes",
	})
	if err != nil {
		t.Fatalf("GetResourceInstance by the manifest id: %v", err)
	}
	if got.Instance.CanonicalId != created.CanonicalId {
		t.Fatalf("got %q, want %q", got.Instance.CanonicalId, created.CanonicalId)
	}

	var event models.WorkerEvent
	if err := db.Where("entity_type = ? AND operation = ?", "module.resource.instance", "created").First(&event).Error; err != nil {
		t.Fatalf("created event: %v", err)
	}
	if want := `"canonical_id":"woofx3_wheel_spin:wheel:prizes"`; !strings.Contains(event.Payload, want) {
		t.Fatalf("event payload %s does not carry %s", event.Payload, want)
	}
}

func casWheel(t *testing.T, svc *moduleService, caller, key, expected, value string) *client.CompareAndSetResourceInstanceSettingResponse {
	t.Helper()
	resp, err := svc.CompareAndSetResourceInstanceSetting(context.Background(), &client.CompareAndSetResourceInstanceSettingRequest{
		CanonicalId:  "woofx3_wheel_spin:wheel:prizes",
		ModuleName:   caller,
		Key:          key,
		ExpectedJson: expected,
		ValueJson:    value,
	})
	if err != nil {
		t.Fatalf("CompareAndSetResourceInstanceSetting: %v", err)
	}
	return resp
}

func storedWheelSettings(t *testing.T, svc *moduleService) string {
	t.Helper()
	got, err := svc.GetResourceInstance(context.Background(), &client.GetResourceInstanceRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:prizes",
	})
	if err != nil {
		t.Fatalf("GetResourceInstance: %v", err)
	}
	return got.Instance.SettingsJson
}

func countInstanceEvents(t *testing.T, db *gorm.DB, op string) int64 {
	t.Helper()
	var n int64
	if err := db.Model(&models.WorkerEvent{}).Where("entity_type = ? AND operation = ?", "module.resource.instance", op).Count(&n).Error; err != nil {
		t.Fatalf("count events: %v", err)
	}
	return n
}

func TestInstanceSettingCASWritesAnAbsentKeyFromNull(t *testing.T) {
	svc, db := newInstanceSvc(t)
	createWheel(t, svc, `{"spinSeconds":5}`)

	resp := casWheel(t, svc, "woofx3_wheel_spin", "items", "", `[{"label":"Pizza"}]`)
	if !resp.Swapped || resp.CurrentJson != `[{"label":"Pizza"}]` {
		t.Fatalf("resp = %+v, want swapped with the written value", resp)
	}
	if got := storedWheelSettings(t, svc); got != `{"items":[{"label":"Pizza"}],"spinSeconds":5}` {
		t.Fatalf("settings = %s", got)
	}
	if n := countInstanceEvents(t, db, "updated"); n != 1 {
		t.Fatalf("updated events = %d, want 1", n)
	}
}

func TestInstanceSettingCASRefusesAStaleExpectationWithTheStoredValue(t *testing.T) {
	svc, db := newInstanceSvc(t)
	createWheel(t, svc, `{"items":[{"label":"Pizza"}]}`)

	resp := casWheel(t, svc, "woofx3_wheel_spin", "items", `[]`, `[{"label":"Tacos"}]`)
	if resp.Swapped || resp.CurrentJson != `[{"label":"Pizza"}]` {
		t.Fatalf("resp = %+v, want refused with the stored list", resp)
	}
	if n := countInstanceEvents(t, db, "updated"); n != 0 {
		t.Fatalf("updated events = %d, want none for a refusal", n)
	}

	// A null expectation means "unset", which a key holding a list is not.
	if resp := casWheel(t, svc, "woofx3_wheel_spin", "items", "null", `[]`); resp.Swapped {
		t.Fatalf("a null expectation swapped a key that holds a value")
	}
}

func TestInstanceSettingCASComparesByMeaning(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, `{"items":[{"label":"Pizza","weight":1}],"empty":{}}`)

	if resp := casWheel(t, svc, "woofx3_wheel_spin", "items", `[{"weight":1.0,"label":"Pizza"}]`, `[]`); !resp.Swapped {
		t.Fatalf("key order and 1 vs 1.0 refused the swap: %+v", resp)
	}
	if resp := casWheel(t, svc, "woofx3_wheel_spin", "empty", `[]`, `[{"label":"Tacos"}]`); !resp.Swapped {
		t.Fatalf("an empty array did not match an empty object: %+v", resp)
	}
}

func TestInstanceSettingCASIsRefusedToAModuleThatDoesNotOwnTheInstance(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, "")

	for _, caller := range []string{"someone_else", "Wheel Spin"} {
		_, err := svc.CompareAndSetResourceInstanceSetting(context.Background(), &client.CompareAndSetResourceInstanceSettingRequest{
			CanonicalId: "woofx3_wheel_spin:wheel:prizes",
			ModuleName:  caller,
			Key:         "items",
			ValueJson:   `[]`,
		})
		wantTwirpCode(t, err, twirp.PermissionDenied)
	}
	if got := storedWheelSettings(t, svc); got != "{}" {
		t.Fatalf("settings = %s, want untouched", got)
	}
}

func TestInstanceSettingCASRefusesBadRequests(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, "")
	ctx := context.Background()

	_, err := svc.CompareAndSetResourceInstanceSetting(ctx, &client.CompareAndSetResourceInstanceSettingRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:missing", ModuleName: "woofx3_wheel_spin", Key: "items", ValueJson: `[]`,
	})
	wantTwirpCode(t, err, twirp.NotFound)

	_, err = svc.CompareAndSetResourceInstanceSetting(ctx, &client.CompareAndSetResourceInstanceSettingRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:prizes", ModuleName: "woofx3_wheel_spin", Key: "items", ValueJson: `{not json`,
	})
	wantTwirpCode(t, err, twirp.InvalidArgument)

	_, err = svc.CompareAndSetResourceInstanceSetting(ctx, &client.CompareAndSetResourceInstanceSettingRequest{
		CanonicalId: "woofx3_wheel_spin:wheel:prizes", Key: "items", ValueJson: `[]`,
	})
	wantTwirpCode(t, err, twirp.InvalidArgument)
}

func TestInstanceSettingCASKeepsAChangeToAnotherKeyMadeInBetween(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, `{"items":[],"spinSeconds":5}`)

	// The streamer saves another field between this call's read and write:
	// simulated by writing it straight to the row before the first attempt.
	inst, err := svc.instanceRepo.GetByModuleKindInstance(mustModuleUUID(t, svc), "wheel", "prizes")
	if err != nil {
		t.Fatalf("load instance: %v", err)
	}
	if ok, err := svc.instanceRepo.CompareAndSetSettings(inst.ID, inst.Settings, `{"items":[],"spinSeconds":9}`); !ok || err != nil {
		t.Fatalf("seed concurrent edit: %v %v", ok, err)
	}

	if resp := casWheel(t, svc, "woofx3_wheel_spin", "items", `[]`, `["Pizza"]`); !resp.Swapped {
		t.Fatalf("a change to another key refused the swap: %+v", resp)
	}
	if got := storedWheelSettings(t, svc); got != `{"items":["Pizza"],"spinSeconds":9}` {
		t.Fatalf("settings = %s, want both changes kept", got)
	}
}

func TestInstanceSettingCASLetsOnlyOneOfTwoRacingWritersSwap(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, `{"items":[]}`)

	const writers = 8
	results := make(chan bool, writers)
	for i := 0; i < writers; i++ {
		go func(i int) {
			resp, err := svc.CompareAndSetResourceInstanceSetting(context.Background(), &client.CompareAndSetResourceInstanceSettingRequest{
				CanonicalId:  "woofx3_wheel_spin:wheel:prizes",
				ModuleName:   "woofx3_wheel_spin",
				Key:          "items",
				ExpectedJson: `[]`,
				ValueJson:    fmt.Sprintf(`[%d]`, i),
			})
			results <- err == nil && resp.Swapped
		}(i)
	}
	swapped := 0
	for i := 0; i < writers; i++ {
		if <-results {
			swapped++
		}
	}
	if swapped != 1 {
		t.Fatalf("%d writers swapped from the same expectation, want exactly 1", swapped)
	}
}

func TestInstanceSettingCASClearsAListWithLuasEmptyTable(t *testing.T) {
	svc, _ := newInstanceSvc(t)
	createWheel(t, svc, `{"items":["Pizza"],"style":{"a":1}}`)

	if resp := casWheel(t, svc, "woofx3_wheel_spin", "items", `["Pizza"]`, `{}`); !resp.Swapped || resp.CurrentJson != "[]" {
		t.Fatalf("resp = %+v, want swapped to []", resp)
	}
	if resp := casWheel(t, svc, "woofx3_wheel_spin", "style", `{"a":1}`, `{}`); !resp.Swapped || resp.CurrentJson != "{}" {
		t.Fatalf("resp = %+v, want an object kept an object", resp)
	}
	if got := storedWheelSettings(t, svc); got != `{"items":[],"style":{}}` {
		t.Fatalf("settings = %s", got)
	}
}

func mustModuleUUID(t *testing.T, svc *moduleService) uuid.UUID {
	t.Helper()
	module, err := svc.repo.GetByName("woofx3_wheel_spin")
	if err != nil {
		t.Fatalf("load module: %v", err)
	}
	return module.ID
}

func TestSettingValuesEqual(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{`1`, `1.0`, true},
		{`{"a":1,"b":"x"}`, `{"b":"x","a":1}`, true},
		{`["A","B"]`, `["B","A"]`, false},
		{`[]`, `{}`, true},
		{`["A"]`, `{}`, false},
		{`[]`, `null`, false},
		{`"1"`, `1`, false},
	}
	for _, c := range cases {
		a, _ := decodeOptionalJSON(c.a)
		b, _ := decodeOptionalJSON(c.b)
		if got := settingValuesEqual(a, b); got != c.want {
			t.Errorf("settingValuesEqual(%s, %s) = %v, want %v", c.a, c.b, got, c.want)
		}
	}
}
