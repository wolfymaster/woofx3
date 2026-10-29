package database

import (
	"fmt"
	"reflect"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// IDSource hands out the ids new rows are stored under. It is injected so a
// test can make ids deterministic.
type IDSource interface {
	NewUUID() uuid.UUID
}

// RandomIDs is the production IDSource: random (version 4) UUIDs.
type RandomIDs struct{}

func (RandomIDs) NewUUID() uuid.UUID {
	return uuid.New()
}

// assignIDCallbackName is the create callback RegisterIDAssignment installs.
const assignIDCallbackName = "woofx3:assign_uuid"

// RegisterIDAssignment makes every gorm create give a row a new id from ids
// when the row's id is still zero.
//
// The Postgres schema has uuid_generate_v4() column defaults and the SQLite
// schema has none, so ids are chosen here, in the client, for both dialects;
// the Postgres defaults remain for statements that bypass gorm. An id the
// caller set is never replaced.
//
// Only a model's single `id` primary key of uuid type (uuid.UUID, or a string
// column tagged `type:uuid`) is filled. A composite key, or a single key under
// another name such as session_compaction.session_id, refers to another row,
// and inventing a value for it would hide the caller's bug.
//
// Raw SQL (db.Raw, db.Exec) does not run create callbacks, so a hand-written
// INSERT must bind its own id.
func RegisterIDAssignment(db *gorm.DB, ids IDSource) error {
	if ids == nil {
		return fmt.Errorf("register %s: id source is nil", assignIDCallbackName)
	}
	err := db.Callback().Create().Before("gorm:create").Register(assignIDCallbackName, func(tx *gorm.DB) {
		assignIDs(tx, ids)
	})
	if err != nil {
		return fmt.Errorf("register %s: %w", assignIDCallbackName, err)
	}
	return nil
}

func assignIDs(tx *gorm.DB, ids IDSource) {
	if tx.Error != nil || tx.Statement.Schema == nil {
		return
	}
	field := uuidIDField(tx.Statement.Schema)
	if field == nil {
		return
	}
	rv := tx.Statement.ReflectValue
	switch rv.Kind() {
	case reflect.Slice, reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			assignID(tx, field, reflect.Indirect(rv.Index(i)), ids)
		}
	case reflect.Struct:
		assignID(tx, field, rv, ids)
	}
}

func assignID(tx *gorm.DB, field *schema.Field, row reflect.Value, ids IDSource) {
	if row.Kind() != reflect.Struct {
		return
	}
	if _, zero := field.ValueOf(tx.Statement.Context, row); !zero {
		return
	}
	id := ids.NewUUID()
	var value interface{} = id
	if field.FieldType.Kind() == reflect.String {
		value = id.String()
	}
	if err := field.Set(tx.Statement.Context, row, value); err != nil {
		tx.AddError(fmt.Errorf("assign id to %s: %w", tx.Statement.Schema.Table, err))
	}
}

// uuidIDField returns the model's id field when it is the sole primary key
// and holds a uuid, or nil.
func uuidIDField(s *schema.Schema) *schema.Field {
	if len(s.PrimaryFields) != 1 {
		return nil
	}
	field := s.PrimaryFields[0]
	if field.DBName != "id" {
		return nil
	}
	if field.FieldType == reflect.TypeOf(uuid.UUID{}) {
		return field
	}
	if field.FieldType.Kind() == reflect.String && field.DataType == "uuid" {
		return field
	}
	return nil
}
