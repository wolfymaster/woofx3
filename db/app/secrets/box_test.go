package secrets

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"
)

func encodedKey(fill byte) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
}

func newTestBox(t *testing.T, fill byte) *Box {
	t.Helper()
	box, err := NewBox(encodedKey(fill))
	if err != nil {
		t.Fatalf("NewBox: %v", err)
	}
	return box
}

func TestSealThenOpenRoundTrips(t *testing.T) {
	box := newTestBox(t, 7)
	sealed, err := box.Seal("example_store", "webhookSecret", "s3cr3t")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	if !strings.HasPrefix(sealed, sealedPrefix) || strings.Contains(sealed, "s3cr3t") {
		t.Fatalf("sealed value = %q", sealed)
	}
	opened, err := box.Open("example_store", "webhookSecret", sealed)
	if err != nil || opened != "s3cr3t" {
		t.Fatalf("Open = %q, %v", opened, err)
	}
}

func TestSealUsesAFreshNonceEachTime(t *testing.T) {
	box := newTestBox(t, 7)
	first, _ := box.Seal("m", "k", "same")
	second, _ := box.Seal("m", "k", "same")
	if first == second {
		t.Fatal("two seals of the same value must differ")
	}
}

func TestOpenRejectsAValueSealedForAnotherRow(t *testing.T) {
	box := newTestBox(t, 7)
	sealed, _ := box.Seal("example_store", "webhookSecret", "s3cr3t")
	if _, err := box.Open("example_store", "otherSetting", sealed); err == nil {
		t.Fatal("a value copied to another key must not open")
	}
	if _, err := box.Open("other_module", "webhookSecret", sealed); err == nil {
		t.Fatal("a value copied to another module must not open")
	}
}

func TestOpenRejectsAnotherKey(t *testing.T) {
	sealed, _ := newTestBox(t, 7).Seal("m", "k", "s3cr3t")
	if _, err := newTestBox(t, 8).Open("m", "k", sealed); err == nil {
		t.Fatal("a value sealed under another key must not open")
	}
}

func TestOpenRejectsATamperedValue(t *testing.T) {
	box := newTestBox(t, 7)
	sealed, _ := box.Seal("m", "k", "s3cr3t")
	raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(sealed, sealedPrefix))
	raw[len(raw)-1] ^= 0x01
	tampered := sealedPrefix + base64.StdEncoding.EncodeToString(raw)
	if _, err := box.Open("m", "k", tampered); err == nil {
		t.Fatal("a tampered value must not open")
	}
}

func TestOpenRejectsMalformedValues(t *testing.T) {
	box := newTestBox(t, 7)
	for _, sealed := range []string{"s3cr3t", "v2:AAAA", "v1:not base64!", "v1:AAAA"} {
		if _, err := box.Open("m", "k", sealed); err == nil {
			t.Errorf("Open(%q) must fail", sealed)
		}
	}
}

func TestNewBoxRejectsMalformedKeys(t *testing.T) {
	short := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{7}, 16))
	for _, key := range []string{"", "not base64!", short} {
		if _, err := NewBox(key); err == nil {
			t.Errorf("NewBox(%q) must fail", key)
		}
	}
}
