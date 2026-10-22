package database

import (
	"bytes"
	"log/slog"
	"strings"
	"testing"
)

func TestSlogAdapter_TracedQueryOmitsBoundValues(t *testing.T) {
	var buf bytes.Buffer
	slogger := slog.New(slog.NewTextHandler(&buf, nil))

	db, err := InitializeDB("sqlite:///:memory:", slogger)
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
