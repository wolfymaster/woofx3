package cloudevents

import (
	"encoding/json"
	"testing"
)

func TestEncode(t *testing.T) {
	data := map[string]interface{}{
		"key":   "value",
		"count": 42,
	}

	bytes, err := Encode(data)
	if err != nil {
		t.Fatalf("Expected no error from Encode, got: %v", err)
	}

	if len(bytes) == 0 {
		t.Fatal("Expected non-empty bytes, got empty")
	}

	// Verify it's valid JSON
	var decoded map[string]interface{}
	if err := json.Unmarshal(bytes, &decoded); err != nil {
		t.Fatalf("Encoded data should be valid JSON, got error: %v", err)
	}

	if decoded["key"] != "value" {
		t.Errorf("Expected key %q, got %v", "value", decoded["key"])
	}

	if decoded["count"] != float64(42) { // JSON numbers decode as float64
		t.Errorf("Expected count %v, got %v", 42, decoded["count"])
	}
}

func TestDecode(t *testing.T) {
	// Valid case: decoding into a pointer
	jsonData := []byte(`{"name": "test", "value": 123}`)
	var result struct {
		Name  string `json:"name"`
		Value int    `json:"value"`
	}

	err := Decode(jsonData, &result)
	if err != nil {
		t.Fatalf("Expected no error from Decode, got: %v", err)
	}

	if result.Name != "test" {
		t.Errorf("Expected name %q, got %q", "test", result.Name)
	}

	if result.Value != 123 {
		t.Errorf("Expected value %d, got %d", 123, result.Value)
	}
}

func TestDecode_IntoSlice(t *testing.T) {
	// Valid case: decoding into a slice pointer
	jsonData := []byte(`["a", "b", "c"]`)
	var result []string

	err := Decode(jsonData, &result)
	if err != nil {
		t.Fatalf("Expected no error from Decode, got: %v", err)
	}

	if len(result) != 3 {
		t.Fatalf("Expected slice length 3, got %d", len(result))
	}

	if result[0] != "a" || result[1] != "b" || result[2] != "c" {
		t.Errorf("Expected [a b c], got %v", result)
	}
}

func TestDecode_InvalidJSON(t *testing.T) {
	invalidJSON := []byte(`{invalid json}`)
	var result map[string]interface{}

	err := Decode(invalidJSON, &result)
	if err == nil {
		t.Fatal("Expected error for invalid JSON, got nil")
	}
}
