package nats

import (
	"context"
	"encoding/json"
)

type MessageImpl struct {
	ctx     context.Context
	subject string
	data    []byte
}

func newMessage(ctx context.Context, subject string, data []byte) *MessageImpl {
	return &MessageImpl{ctx: ctx, subject: subject, data: data}
}

// Context carries the consumer span a subscription started for this message.
func (m *MessageImpl) Context() context.Context {
	if m.ctx == nil {
		return context.Background()
	}
	return m.ctx
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
	return newMessage(context.Background(), subject, data)
}
