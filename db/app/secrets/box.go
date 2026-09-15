// Package secrets seals values that must not rest in the database as plain
// text, such as `secret` module settings.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// sealedPrefix versions the sealed format so a later key rotation can tell
// formats apart.
const sealedPrefix = "v1:"

// Box seals and opens values with AES-256-GCM under one key. Every value is
// bound to the row it belongs to, so a sealed value copied onto another row
// fails to open.
type Box struct {
	aead cipher.AEAD
}

// NewBox builds a Box from a base64-encoded 32-byte key.
func NewBox(encodedKey string) (*Box, error) {
	key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encodedKey))
	if err != nil {
		return nil, fmt.Errorf("WOOFX3_SECRETS_KEY is not valid base64: %w", err)
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("WOOFX3_SECRETS_KEY must decode to 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Box{aead: aead}, nil
}

// Seal encrypts plaintext for the row identified by (scope, name).
func (b *Box) Seal(scope, name, plaintext string) (string, error) {
	nonce := make([]byte, b.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}
	sealed := b.aead.Seal(nonce, nonce, []byte(plaintext), associatedData(scope, name))
	return sealedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// Open decrypts a value Seal produced for the same (scope, name).
func (b *Box) Open(scope, name, sealed string) (string, error) {
	encoded, ok := strings.CutPrefix(sealed, sealedPrefix)
	if !ok {
		return "", errors.New("sealed value has an unknown format")
	}
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", errors.New("sealed value is not valid base64")
	}
	nonceSize := b.aead.NonceSize()
	if len(raw) < nonceSize {
		return "", errors.New("sealed value is truncated")
	}
	plaintext, err := b.aead.Open(nil, raw[:nonceSize], raw[nonceSize:], associatedData(scope, name))
	if err != nil {
		return "", errors.New("sealed value does not open under this key for this row")
	}
	return string(plaintext), nil
}

func associatedData(scope, name string) []byte {
	return []byte(scope + "\x00" + name)
}
