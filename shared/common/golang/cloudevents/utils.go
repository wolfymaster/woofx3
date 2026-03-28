package cloudevents

import (
	"encoding/json"
)

func Encode(event interface{}) ([]byte, error) {
	return json.Marshal(event)
}

// Decode decodes JSON data into the destination.
// dst must be a pointer to the target type (e.g., &myStruct, &mySlice).
func Decode[T any](data []byte, dst *T) error {
	return json.Unmarshal(data, dst)
}
