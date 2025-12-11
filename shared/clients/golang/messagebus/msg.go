package messagebus

import (
	"encoding/json"
	"fmt"
	"reflect"
)

// MessageImpl is a concrete implementation of the Msg interface
type MessageImpl struct {
	subject string
	data    []byte
}

// NewMessageImpl creates a new MessageImpl
func NewMessageImpl(subject string, data []byte) *MessageImpl {
	return &MessageImpl{
		subject: subject,
		data:    data,
	}
}

// Subject returns the message subject
func (m *MessageImpl) Subject() string {
	return m.subject
}

// Data returns the message data
func (m *MessageImpl) Data() []byte {
	return m.data
}

// JSON unmarshals the message data into the provided interface
func (m *MessageImpl) JSON(v interface{}) error {
	return json.Unmarshal(m.data, v)
}

// String returns the message data as a string
func (m *MessageImpl) String() string {
	return string(m.data)
}

// CreateMessage creates a message from various data formats
func CreateMessage(subject string, data interface{}) (Msg, error) {
	var bytes []byte
	var err error

	switch d := data.(type) {
	case string:
		bytes = []byte(d)

	case []byte:
		bytes = d

	case []uint8: // Same as []byte but explicit
		bytes = d

	case []int:
		// Handle []int from HTTP backend JSON serialization
		bytes = make([]byte, len(d))
		for i, v := range d {
			if v < 0 || v > 255 {
				return nil, fmt.Errorf("invalid byte value %d at index %d (must be 0-255)", v, i)
			}
			bytes[i] = byte(v)
		}

	case []interface{}:
		// Handle []interface{} from JSON unmarshaling
		bytes = make([]byte, len(d))
		for i, v := range d {
			switch val := v.(type) {
			case int:
				if val < 0 || val > 255 {
					return nil, fmt.Errorf("invalid byte value %d at index %d (must be 0-255)", val, i)
				}
				bytes[i] = byte(val)
			case float64: // JSON numbers are float64 by default
				intVal := int(val)
				if intVal < 0 || intVal > 255 {
					return nil, fmt.Errorf("invalid byte value %d at index %d (must be 0-255)", intVal, i)
				}
				bytes[i] = byte(intVal)
			default:
				return nil, fmt.Errorf("unsupported element type %T at index %d", val, i)
			}
		}

	default:
		return nil, fmt.Errorf("unsupported data format: %T", data)
	}

	return NewMessageImpl(subject, bytes), nil
}

// CreateMessageFromString creates a message from a string
func CreateMessageFromString(subject, data string) Msg {
	return NewMessageImpl(subject, []byte(data))
}

// CreateMessageFromBytes creates a message from a byte slice
func CreateMessageFromBytes(subject string, data []byte) Msg {
	return NewMessageImpl(subject, data)
}

// CreateMessageFromJSON creates a message by marshaling an object to JSON
func CreateMessageFromJSON(subject string, data interface{}) (Msg, error) {
	bytes, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal JSON: %w", err)
	}
	return NewMessageImpl(subject, bytes), nil
}

// MustCreateMessage is like CreateMessage but panics on error
func MustCreateMessage(subject string, data interface{}) Msg {
	msg, err := CreateMessage(subject, data)
	if err != nil {
		panic(err)
	}
	return msg
}

// IsValidByteSlice checks if an interface{} can be converted to a valid byte slice
func IsValidByteSlice(data interface{}) bool {
	v := reflect.ValueOf(data)
	if v.Kind() != reflect.Slice {
		return false
	}

	for i := 0; i < v.Len(); i++ {
		elem := v.Index(i)
		if !elem.CanInterface() {
			return false
		}

		switch val := elem.Interface().(type) {
		case int:
			if val < 0 || val > 255 {
				return false
			}
		case float64:
			intVal := int(val)
			if intVal < 0 || intVal > 255 || float64(intVal) != val {
				return false
			}
		default:
			return false
		}
	}

	return true
}
