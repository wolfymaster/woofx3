package models

import "time"

// UserPageSubmission is one form submission from a public user page.
// SubmissionID is minted by the sender and is the idempotency key: the primary
// key is what makes a redelivery a no-op.
type UserPageSubmission struct {
	SubmissionID string `gorm:"column:submission_id;type:varchar(255);primaryKey"`
	PageID       string `gorm:"column:page_id;type:varchar(255);not null"`
	FormID       string `gorm:"column:form_id;type:varchar(255);not null"`
	// Payload is the data of the `userpage.form.submitted` event as JSON. It
	// holds viewer-written text and viewer identity, so it is never logged.
	Payload     string    `gorm:"column:payload;type:jsonb;not null"`
	SubmittedAt time.Time `gorm:"column:submitted_at;not null"`
	RecordedAt  time.Time `gorm:"column:recorded_at;not null"`
}

func (UserPageSubmission) TableName() string {
	return "user_page_submissions"
}
