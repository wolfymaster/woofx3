package nats

import "encoding/json"

type MessageImpl struct {
	subject string
	data    []byte
}

func (m *MessageImpl) Subject() string {
	return m.subject
}

func (m *MessageImpl) Data() []byte {
	return m.data
}

func (m *MessageImpl) JSON(v interface{}) error {
	return json.Unmarshal(m.data, v)
}

func (m *MessageImpl) String() string {
	return string(m.data)
}

func CreateMessage(subject string, data []byte) Msg {
	return &MessageImpl{
		subject: subject,
		data:    data,
	}
}
