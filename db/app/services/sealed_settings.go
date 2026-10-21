package services

import (
	"fmt"

	"github.com/wolfymaster/woofx3/db/app/secrets"
	"github.com/wolfymaster/woofx3/db/database/repository"
)

// TwitchTokenSettingKey holds the linked Twitch account's token. A public
// Twitch app's refresh token in it stays valid until it is used, so it is a
// credential like any other.
const TwitchTokenSettingKey = "twitch_token"

// SealedSettingKeys names every engine setting whose value is a credential.
// The settings service seals these at rest and opens them on read, so
// callers keep reading and writing plain text through the same RPCs. A key
// added here has its stored plain-text value sealed on the next start (see
// SealPlaintextSettings).
func SealedSettingKeys() []string {
	return []string{TwitchTokenSettingKey}
}

// SealPlaintextSettings seals every sealed key whose stored value is still
// plain text, as written before the key was sealed, and returns how many it
// sealed. Each row is swapped only while it still holds the value read, so a
// write landing meanwhile is kept, and running it again changes nothing.
func SealPlaintextSettings(repo *repository.SettingRepository, seal *secrets.SettingSeal) (int, error) {
	rows, err := repo.GetSettingsByKeys(seal.Keys())
	if err != nil {
		return 0, fmt.Errorf("reading sealed settings: %w", err)
	}
	sealedCount := 0
	for _, row := range rows {
		if row.Value == "" || secrets.IsSealed(row.Value) {
			continue
		}
		sealed, err := seal.StoredValue(row.Key, row.Value)
		if err != nil {
			return sealedCount, err
		}
		swapped, err := repo.CompareAndSetValue(row.Key, row.Value, sealed)
		if err != nil {
			return sealedCount, fmt.Errorf("sealing stored setting %q: %w", row.Key, err)
		}
		if swapped {
			sealedCount++
		}
	}
	return sealedCount, nil
}
