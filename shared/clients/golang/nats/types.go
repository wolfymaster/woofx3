package nats

type Config struct {
	URL      string
	Name     string
	JWT      string
	NKeySeed string
}

type Handler func(msg Msg)

type Logger interface {
	Info(message string, args ...interface{})
	Error(message string, args ...interface{})
	Warn(message string, args ...interface{})
	Debug(message string, args ...interface{})
}

type Msg interface {
	Subject() string
	Data() []byte
	JSON(v interface{}) error
	String() string
}

type Subscription interface {
	Unsubscribe() error
}
