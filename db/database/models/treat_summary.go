package models

import (
	"time"

	"github.com/google/uuid"
)

// TreatsSummary represents a summary of treats for a user over a specific period
type TreatsSummary struct {
	UserID                uuid.UUID                        `json:"user_id"`
	TotalPoints           int                              `json:"total_points"`
	TreatTypeDistribution map[string]TreatTypeStats        `json:"treat_type_distribution"`
	RecentTreats         []Treat                          `json:"recent_treats,omitempty"`
	PeriodStart          time.Time                        `json:"period_start,omitempty"`
	PeriodEnd            time.Time                        `json:"period_end,omitempty"`
}

// TreatTypeStats contains statistics for a specific treat type
type TreatTypeStats struct {
	Count int `json:"count"`
	Total int `json:"total"`
}

// TableName specifies the table name for the TreatsSummary (view)
func (TreatsSummary) TableName() string {
	return "treats_summary"
}
