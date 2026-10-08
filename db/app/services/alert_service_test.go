package services

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestBuildAlertChangeDataKeepsUpdatedAtPrecision(t *testing.T) {
	zone := time.FixedZone("UTC+2", 2*60*60)
	updatedAt := time.Date(2026, 5, 3, 3, 2, 3, 123456000, zone)
	alert := &models.Alert{ID: uuid.New(), CreatedAt: updatedAt, UpdatedAt: updatedAt}

	data := buildAlertChangeData(alert)

	if got, want := data["updated_at"], "2026-05-03T01:02:03.123456000Z"; got != want {
		t.Fatalf("updated_at = %v, want %v", got, want)
	}
}

func TestBuildAlertChangeDataOrdersWritesWithinOneMillisecond(t *testing.T) {
	base := time.Date(2026, 5, 3, 1, 2, 3, 123000000, time.UTC)
	earlier := buildAlertChangeData(&models.Alert{ID: uuid.New(), UpdatedAt: base.Add(100 * time.Microsecond)})
	later := buildAlertChangeData(&models.Alert{ID: uuid.New(), UpdatedAt: base.Add(900 * time.Microsecond)})

	if earlier["updated_at"].(string) >= later["updated_at"].(string) {
		t.Fatalf("expected %v to sort before %v", earlier["updated_at"], later["updated_at"])
	}
}
