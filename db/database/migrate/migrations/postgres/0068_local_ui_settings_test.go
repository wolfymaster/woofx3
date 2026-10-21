package postgres

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/go-gormigrate/gormigrate/v2"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

func TestLocalUISettingsWriteUnderOneCounter(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewLocalUISettingRepository(db)
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	value := `{"widgets":[]}`

	first, err := repo.Write(context.Background(), repository.LocalUISettingWrite{Namespace: "dashboardLayouts", Key: "main", Value: &value, At: at})
	if err != nil {
		t.Fatalf("first Write: %v", err)
	}
	second, err := repo.Write(context.Background(), repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", Value: &value, At: at})
	if err != nil {
		t.Fatalf("second Write: %v", err)
	}
	if first.Setting.Revision != 1 || second.Setting.Revision != 2 {
		t.Fatalf("revisions = %d, %d, want 1, 2", first.Setting.Revision, second.Setting.Revision)
	}

	stale := int64(1)
	refused, err := repo.Write(context.Background(), repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", ExpectedRevision: &stale, At: at})
	if err != nil {
		t.Fatalf("stale Write: %v", err)
	}
	if !refused.Conflict || refused.Setting.Revision != 2 {
		t.Fatalf("stale delete = %+v, want a conflict carrying revision 2", refused)
	}

	deleted, err := repo.Write(context.Background(), repository.LocalUISettingWrite{Namespace: "macros", Key: "m1", At: at})
	if err != nil {
		t.Fatalf("delete Write: %v", err)
	}
	if !deleted.Setting.Deleted || deleted.Setting.Revision != 3 {
		t.Fatalf("delete = %+v, want a tombstone at revision 3", deleted.Setting)
	}
}

// Concurrent writers must draw distinct, gapless revisions that become
// visible in revision order, and of several writers racing on one key with the
// same expected revision exactly one wins.
func TestLocalUISettingsConcurrentWriters(t *testing.T) {
	db := openEmptyPostgres(t)
	if err := gormigrate.New(db, gormigrate.DefaultOptions, All()).Migrate(); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	repo := repository.NewLocalUISettingRepository(db)
	ctx := context.Background()
	at := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	value := `1`

	seed, err := repo.Write(ctx, repository.LocalUISettingWrite{Namespace: "race", Key: "contested", Value: &value, At: at})
	if err != nil {
		t.Fatalf("seed Write: %v", err)
	}
	seedRevision := seed.Setting.Revision

	const unconditionalWriters = 24
	const racingWriters = 8

	type outcome struct {
		result *repository.LocalUISettingWriteResult
		err    error
	}
	outcomes := make(chan outcome, unconditionalWriters+racingWriters)
	start := make(chan struct{})
	var wg sync.WaitGroup
	launch := func(write repository.LocalUISettingWrite) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			result, err := repo.Write(ctx, write)
			outcomes <- outcome{result: result, err: err}
		}()
	}
	for i := 0; i < unconditionalWriters; i++ {
		launch(repository.LocalUISettingWrite{Namespace: "race", Key: fmt.Sprintf("k%d", i), Value: &value, At: at})
	}
	for i := 0; i < racingWriters; i++ {
		expected := seedRevision
		launch(repository.LocalUISettingWrite{Namespace: "race", Key: "contested", Value: &value, ExpectedRevision: &expected, At: at})
	}
	close(start)
	wg.Wait()
	close(outcomes)

	revisions := map[int64]bool{seedRevision: true}
	racingWins := 0
	for o := range outcomes {
		if o.err != nil {
			t.Fatalf("concurrent Write: %v", o.err)
		}
		if o.result.Conflict {
			continue
		}
		if revisions[o.result.Setting.Revision] {
			t.Fatalf("revision %d handed out twice", o.result.Setting.Revision)
		}
		revisions[o.result.Setting.Revision] = true
		if o.result.Setting.Key == "contested" {
			racingWins++
		}
	}
	if racingWins != 1 {
		t.Fatalf("%d of %d writers racing on one expected revision won, want exactly 1", racingWins, racingWriters)
	}
	wantRevisions := 1 + unconditionalWriters + racingWins
	for revision := int64(1); revision <= int64(wantRevisions); revision++ {
		if !revisions[revision] {
			t.Fatalf("revision %d never handed out: a gap in 1..%d", revision, wantRevisions)
		}
	}
	if len(revisions) != wantRevisions {
		t.Fatalf("%d distinct revisions, want %d", len(revisions), wantRevisions)
	}

	changes, hasMore, err := repo.ChangesSince(ctx, 0, 1000)
	if err != nil || hasMore {
		t.Fatalf("ChangesSince(0): hasMore=%v err=%v", hasMore, err)
	}
	// One row per key, so the contested key's seed revision was replaced.
	if len(changes) != unconditionalWriters+1 {
		t.Fatalf("ChangesSince(0) returned %d rows, want %d", len(changes), unconditionalWriters+1)
	}
	for i := 1; i < len(changes); i++ {
		if changes[i].Revision <= changes[i-1].Revision {
			t.Fatalf("changes out of order at %d: %d after %d", i, changes[i].Revision, changes[i-1].Revision)
		}
	}
}
