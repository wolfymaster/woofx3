package secrets

import "fmt"

// settingsSealScope is the Box scope for engine settings. A settings row is
// identified by its key alone, so (scope, key) binds a sealed value to its
// row the way (module id, key) does for module settings.
const settingsSealScope = "settings"

// SettingSeal seals and opens the values of the engine settings it names,
// and passes every other setting through as it is.
type SettingSeal struct {
	box  *Box
	keys map[string]struct{}
}

// NewSettingSeal builds the seal for `keys`. A missing box, an empty key or a
// key named twice is a wiring error.
func NewSettingSeal(box *Box, keys []string) (*SettingSeal, error) {
	if box == nil {
		return nil, fmt.Errorf("sealed settings need a secrets box")
	}
	set := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if key == "" {
			return nil, fmt.Errorf("sealed setting key is empty")
		}
		if _, dup := set[key]; dup {
			return nil, fmt.Errorf("sealed setting key %q is listed twice", key)
		}
		set[key] = struct{}{}
	}
	return &SettingSeal{box: box, keys: set}, nil
}

// Keys lists the sealed setting keys, in no particular order.
func (s *SettingSeal) Keys() []string {
	keys := make([]string, 0, len(s.keys))
	for key := range s.keys {
		keys = append(keys, key)
	}
	return keys
}

// Seals reports whether `key`'s value is sealed at rest.
func (s *SettingSeal) Seals(key string) bool {
	_, ok := s.keys[key]
	return ok
}

// StoredValue is what goes in the value column for `key`. An empty value
// stays empty so it still reads as unset.
func (s *SettingSeal) StoredValue(key, value string) (string, error) {
	if !s.Seals(key) || value == "" {
		return value, nil
	}
	sealed, err := s.box.Seal(settingsSealScope, key, value)
	if err != nil {
		return "", fmt.Errorf("sealing setting %q: %w", key, err)
	}
	return sealed, nil
}

// PlainValue is the value a caller reads for `key`. A sealed key's value that
// does not open (a changed WOOFX3_SECRETS_KEY, a value copied from another
// row, or plain text the startup sealing has not reached) is an error, never
// handed back as stored.
func (s *SettingSeal) PlainValue(key, stored string) (string, error) {
	if !s.Seals(key) || stored == "" {
		return stored, nil
	}
	plain, err := s.box.Open(settingsSealScope, key, stored)
	if err != nil {
		return "", fmt.Errorf("setting %q cannot be opened: %w", key, err)
	}
	return plain, nil
}
