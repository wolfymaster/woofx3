package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// KindSettingsValidator checks the settings of one resource kind whose meaning
// the db service owns, and carries out what a change to them implies.
//
// Resource kinds are opaque to the engine: their settings mean something only
// to the module declaring the kind. A kind registers here only when the db
// service keeps data its settings describe, and this registry is the one
// place that knowledge lives.
type KindSettingsValidator interface {
	// ApplySettings runs inside the transaction writing an instance's
	// settings, after the write. previous is "" for a new instance. A
	// *KindSettingsError refuses the settings; any error rolls the write back.
	ApplySettings(ctx context.Context, tx *gorm.DB, instanceID uuid.UUID, previous, next string) error
}

// KindSettingsError refuses settings a kind's validator does not accept. Its
// reason is shown to whoever wrote the settings.
type KindSettingsError struct {
	Reason string
	err    error
}

func (e *KindSettingsError) Error() string {
	return e.Reason
}

func (e *KindSettingsError) Unwrap() error {
	return errors.Unwrap(e.err)
}

func kindSettingsErrorf(format string, args ...any) error {
	err := fmt.Errorf(format, args...)
	return &KindSettingsError{Reason: err.Error(), err: err}
}

// asKindSettingsError reports whether err refuses the settings.
func asKindSettingsError(err error) (*KindSettingsError, bool) {
	var refused *KindSettingsError
	ok := errors.As(err, &refused)
	return refused, ok
}

// KindSettingsValidators maps a canonical kind (`<module>:<kind>`) to its
// validator.
type KindSettingsValidators struct {
	byKind map[string]KindSettingsValidator
}

func NewKindSettingsValidators() *KindSettingsValidators {
	return &KindSettingsValidators{byKind: map[string]KindSettingsValidator{}}
}

// Register adds the validator of a canonical kind. A kind registers once: a
// second registration is a wiring error.
func (r *KindSettingsValidators) Register(canonicalKind string, validator KindSettingsValidator) error {
	if validator == nil {
		return fmt.Errorf("register settings validator of %q: validator is nil", canonicalKind)
	}
	if _, taken := r.byKind[canonicalKind]; taken {
		return fmt.Errorf("register settings validator of %q: already registered", canonicalKind)
	}
	r.byKind[canonicalKind] = validator
	return nil
}

// For returns the validator of a canonical kind, if one is registered. Most
// kinds have none: their settings are opaque.
func (r *KindSettingsValidators) For(canonicalKind string) (KindSettingsValidator, bool) {
	validator, ok := r.byKind[canonicalKind]
	return validator, ok
}
