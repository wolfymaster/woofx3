package cloudevents

import "encoding/json"

func Encode(event interface{}) ([]byte, error) {
	return json.Marshal(event)
}
