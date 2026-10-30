package database

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
	"time"

	gsqlite "github.com/libtnb/sqlite"
	"gorm.io/gorm"
)

func TestSystemDatabaseLogsNoBoundValues(t *testing.T) {
	const secret = "client-secret-that-must-not-be-logged"
	var logged bytes.Buffer
	config := systemLoggerConfig()
	// Every query counts as slow, so the slow path is logged too.
	config.SlowThreshold = time.Nanosecond
	db, err := gorm.Open(gsqlite.Open(":memory:"), &gorm.Config{
		Logger: NewSlogAdapter(slog.New(slog.NewTextHandler(&logged, nil)), config),
	})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.Exec(`CREATE TABLE clients (client_secret TEXT)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}

	if err := db.Exec(`INSERT INTO clients (client_secret) VALUES (?)`, secret).Error; err != nil {
		t.Fatalf("slow insert: %v", err)
	}
	if err := db.Exec(`INSERT INTO missing (client_secret) VALUES (?)`, secret).Error; err == nil {
		t.Fatal("an insert into a missing table succeeded")
	}

	out := logged.String()
	if !strings.Contains(out, "gorm trace (slow)") || !strings.Contains(out, "level=ERROR") {
		t.Fatalf("expected a slow and an error trace, got:\n%s", out)
	}
	if strings.Contains(out, secret) {
		t.Errorf("a bound value reached the log:\n%s", out)
	}
}

func TestSlogAdapter_TracedQueryOmitsBoundValues(t *testing.T) {
	var buf bytes.Buffer
	slogger := slog.New(slog.NewTextHandler(&buf, nil))

	db, err := InitializeDB("sqlite:///:memory:", slogger, RandomIDs{})
	if err != nil {
		t.Fatal(err)
	}

	// The table does not exist, so the statement errors and Trace logs its SQL.
	if err := db.Exec("DELETE FROM clients WHERE client_secret = ?", "topsecret").Error; err == nil {
		t.Fatal("expected the statement to fail")
	}

	out := buf.String()
	if !strings.Contains(out, "client_secret") {
		t.Fatalf("expected the traced SQL in the log, got %q", out)
	}
	if strings.Contains(out, "topsecret") {
		t.Fatalf("bound value leaked into the log: %q", out)
	}
}
