package nats

type Config struct {
	URL      string `env:"WOOFX3_MESSAGEBUS_URL,required"`
	Name     string `env:"WOOFX3_MESSAGEBUS_NAME"`
	JWT      string `env:"WOOFX3_MESSAGEBUS_JWT"`
	NKeySeed string `env:"WOOFX3_MESSAGEBUS_NKEYSEED"`
}

type Handler func(msg Msg)

type Logger interface {
	Info(message string, args ...any)
	Error(message string, args ...any)
	Warn(message string, args ...any)
	Debug(message string, args ...any)
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
