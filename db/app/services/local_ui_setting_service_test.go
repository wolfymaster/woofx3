package services

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	repo "github.com/wolfymaster/woofx3/db/database/repository"
)

var localUISettingClock = time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)

// newLocalUISettingSvc runs the real SQLite migration chain, so the counter
// row and the table's constraints are the ones production has.
func newLocalUISettingSvc(t *testing.T) client.LocalUISettingService {
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
	return &localUISettingService{
		settings: repo.NewLocalUISettingRepository(db),
		now:      func() time.Time { return localUISettingClock },
	}
}

func setUISetting(t *testing.T, svc client.LocalUISettingService, namespace, key, value string) *client.LocalUISetting {
	t.Helper()
	resp, err := svc.SetLocalUISetting(context.Background(), &client.SetLocalUISettingRequest{
		Namespace: namespace, Key: key, ValueJson: value,
	})
	if err != nil {
		t.Fatalf("SetLocalUISetting(%s, %s): %v", namespace, key, err)
	}
	if resp.Conflict {
		t.Fatalf("SetLocalUISetting(%s, %s): unexpected conflict", namespace, key)
	}
	return resp.Setting
}

func TestLocalUISettingRevisionsRiseAcrossNamespaces(t *testing.T) {
	svc := newLocalUISettingSvc(t)
	ctx := context.Background()

	first := setUISetting(t, svc, "dashboardLayouts", "main", `{"widgets":[]}`)
	second := setUISetting(t, svc, "dashboardNotes", "n1", `"hello"`)
	third := setUISetting(t, svc, "dashboardLayouts", "main", `{"widgets":[1]}`)
	deleted, err := svc.DeleteLocalUISetting(ctx, &client.DeleteLocalUISettingRequest{Namespace: "dashboardNotes", Key: "n1"})
	if err != nil {
		t.Fatalf("DeleteLocalUISetting: %v", err)
	}

	got := []int64{first.Revision, second.Revision, third.Revision, deleted.Setting.Revision}
	want := []int64{1, 2, 3, 4}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("revisions = %v, want %v", got, want)
		}
	}
	if !third.UpdatedAt.AsTime().Equal(localUISettingClock) {
		t.Errorf("updated_at = %v, want %v", third.UpdatedAt.AsTime(), localUISettingClock)
	}
}

func TestLocalUISettingExpectedRevision(t *testing.T) {
	svc := newLocalUISettingSvc(t)
	ctx := context.Background()
	set := func(value string, expected int64) *client.WriteLocalUISettingResponse {
		t.Helper()
		resp, err := svc.SetLocalUISetting(ctx, &client.SetLocalUISettingRequest{
			Namespace: "macros", Key: "m1", ValueJson: value, ExpectedRevision: int64Ptr(expected),
		})
		if err != nil {
			t.Fatalf("SetLocalUISetting: %v", err)
		}
		return resp
	}

	refused := set(`1`, 5)
	if !refused.Conflict || refused.Setting != nil {
		t.Fatalf("expected 5 on a key never written: conflict=%v setting=%v, want a conflict with no row", refused.Conflict, refused.Setting)
	}

	created := set(`1`, 0)
	if created.Conflict || created.Setting.Revision != 1 {
		t.Fatalf("expected 0 on a new key: %+v, want revision 1", created)
	}

	stale := set(`2`, 0)
	if !stale.Conflict || stale.Setting.Revision != 1 || stale.Setting.ValueJson != `1` {
		t.Fatalf("stale write: %+v, want a conflict carrying revision 1 with value 1", stale)
	}

	updated := set(`2`, 1)
	if updated.Conflict || updated.Setting.Revision != 2 {
		t.Fatalf("write at the stored revision: %+v, want revision 2", updated)
	}

	staleDelete, err := svc.DeleteLocalUISetting(ctx, &client.DeleteLocalUISettingRequest{
		Namespace: "macros", Key: "m1", ExpectedRevision: int64Ptr(1),
	})
	if err != nil {
		t.Fatalf("DeleteLocalUISetting: %v", err)
	}
	if !staleDelete.Conflict || staleDelete.Setting.Revision != 2 {
		t.Fatalf("stale delete: %+v, want a conflict carrying revision 2", staleDelete)
	}

	tomb, err := svc.DeleteLocalUISetting(ctx, &client.DeleteLocalUISettingRequest{
		Namespace: "macros", Key: "m1", ExpectedRevision: int64Ptr(2),
	})
	if err != nil {
		t.Fatalf("DeleteLocalUISetting: %v", err)
	}
	// Refused writes roll back, so they consumed no revision.
	if tomb.Conflict || !tomb.Setting.Deleted || tomb.Setting.Revision != 3 {
		t.Fatalf("delete at the stored revision: %+v, want a tombstone at revision 3", tomb)
	}

	if recreated := set(`3`, 0); recreated.Conflict || recreated.Setting.Revision != 4 {
		t.Fatalf("expected 0 over a tombstone: %+v, want revision 4", recreated)
	}
}

func TestLocalUISettingTombstones(t *testing.T) {
	svc := newLocalUISettingSvc(t)
	ctx := context.Background()
	setUISetting(t, svc, "dashboardCounters", "a", `1`)
	setUISetting(t, svc, "dashboardCounters", "b", `2`)
	if _, err := svc.DeleteLocalUISetting(ctx, &client.DeleteLocalUISettingRequest{Namespace: "dashboardCounters", Key: "a"}); err != nil {
		t.Fatalf("DeleteLocalUISetting: %v", err)
	}

	listed, err := svc.ListLocalUISettings(ctx, &client.ListLocalUISettingsRequest{Namespace: "dashboardCounters"})
	if err != nil {
		t.Fatalf("ListLocalUISettings: %v", err)
	}
	if len(listed.Settings) != 1 || listed.Settings[0].Key != "b" {
		t.Fatalf("listed = %v, want only b", listed.Settings)
	}

	_, err = svc.GetLocalUISetting(ctx, &client.GetLocalUISettingRequest{Namespace: "dashboardCounters", Key: "a"})
	wantTwirpCode(t, err, twirp.NotFound)

	changes, err := svc.ListLocalUISettingChanges(ctx, &client.ListLocalUISettingChangesRequest{AfterRevision: 1})
	if err != nil {
		t.Fatalf("ListLocalUISettingChanges: %v", err)
	}
	if len(changes.Settings) != 2 {
		t.Fatalf("changes after 1 = %v, want b then the tombstone of a", changes.Settings)
	}
	if b := changes.Settings[0]; b.Key != "b" || b.Revision != 2 || b.Deleted {
		t.Errorf("first change = %+v, want b at revision 2", b)
	}
	if a := changes.Settings[1]; a.Key != "a" || a.Revision != 3 || !a.Deleted || a.ValueJson != "" {
		t.Errorf("second change = %+v, want the tombstone of a at revision 3 with no value", a)
	}
}

func TestLocalUISettingChangesPaginate(t *testing.T) {
	svc := newLocalUISettingSvc(t)
	ctx := context.Background()
	for _, key := range []string{"a", "b", "c", "d", "e"} {
		setUISetting(t, svc, "dashboardNotes", key, `"x"`)
	}

	var seen []string
	after := int64(0)
	for pages := 0; ; pages++ {
		if pages > 5 {
			t.Fatalf("pagination did not end; seen %v", seen)
		}
		page, err := svc.ListLocalUISettingChanges(ctx, &client.ListLocalUISettingChangesRequest{AfterRevision: after, Limit: 2})
		if err != nil {
			t.Fatalf("ListLocalUISettingChanges: %v", err)
		}
		for _, setting := range page.Settings {
			seen = append(seen, setting.Key)
			after = setting.Revision
		}
		if !page.HasMore {
			break
		}
		if len(page.Settings) != 2 {
			t.Fatalf("a page with more to come has %d rows, want 2", len(page.Settings))
		}
	}
	if strings.Join(seen, "") != "abcde" {
		t.Fatalf("paged keys = %v, want a through e once each", seen)
	}
}

func TestLocalUISettingValidation(t *testing.T) {
	svc := newLocalUISettingSvc(t)
	ctx := context.Background()
	long := func(n int) string { return strings.Repeat("k", n) }

	sets := []struct {
		name string
		req  *client.SetLocalUISettingRequest
	}{
		{"empty namespace", &client.SetLocalUISettingRequest{Key: "k", ValueJson: `1`}},
		{"empty key", &client.SetLocalUISettingRequest{Namespace: "n", ValueJson: `1`}},
		{"long namespace", &client.SetLocalUISettingRequest{Namespace: long(maxLocalUISettingNamespaceBytes + 1), Key: "k", ValueJson: `1`}},
		{"long key", &client.SetLocalUISettingRequest{Namespace: "n", Key: long(maxLocalUISettingKeyBytes + 1), ValueJson: `1`}},
		{"empty value", &client.SetLocalUISettingRequest{Namespace: "n", Key: "k"}},
		{"value that is not JSON", &client.SetLocalUISettingRequest{Namespace: "n", Key: "k", ValueJson: `{"a":`}},
		{"value over the cap", &client.SetLocalUISettingRequest{Namespace: "n", Key: "k", ValueJson: `"` + long(maxLocalUISettingValueBytes) + `"`}},
		{"negative expected revision", &client.SetLocalUISettingRequest{Namespace: "n", Key: "k", ValueJson: `1`, ExpectedRevision: int64Ptr(-1)}},
	}
	for _, tc := range sets {
		t.Run("set/"+tc.name, func(t *testing.T) {
			_, err := svc.SetLocalUISetting(ctx, tc.req)
			wantTwirpCode(t, err, twirp.InvalidArgument)
		})
	}

	t.Run("set/value at the cap", func(t *testing.T) {
		setUISetting(t, svc, "n", "k", `"`+long(maxLocalUISettingValueBytes-2)+`"`)
	})

	t.Run("delete/empty key", func(t *testing.T) {
		_, err := svc.DeleteLocalUISetting(ctx, &client.DeleteLocalUISettingRequest{Namespace: "n"})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
	t.Run("list/empty namespace", func(t *testing.T) {
		_, err := svc.ListLocalUISettings(ctx, &client.ListLocalUISettingsRequest{})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
	t.Run("changes/negative revision", func(t *testing.T) {
		_, err := svc.ListLocalUISettingChanges(ctx, &client.ListLocalUISettingChangesRequest{AfterRevision: -1})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})
	t.Run("changes/limit over the maximum", func(t *testing.T) {
		_, err := svc.ListLocalUISettingChanges(ctx, &client.ListLocalUISettingChangesRequest{Limit: maxLocalUISettingChangesLimit + 1})
		wantTwirpCode(t, err, twirp.InvalidArgument)
	})

	// Nothing refused above may have taken a revision.
	changes, err := svc.ListLocalUISettingChanges(ctx, &client.ListLocalUISettingChangesRequest{})
	if err != nil {
		t.Fatalf("ListLocalUISettingChanges: %v", err)
	}
	if len(changes.Settings) != 1 || changes.Settings[0].Revision != 1 {
		t.Fatalf("changes = %v, want only the write at the cap, at revision 1", changes.Settings)
	}
}
