package config

import (
	"github.com/wolfymaster/woofx3/clients/nats"
)

type DatabaseEnvConfig struct {
	DatabaseURL       string `env:"WOOFX3_DATABASE_URL,required"`
	BadgerPath        string `env:"WOOFX3_BADGER_PATH,required"`
	DatabaseProxyPort string `env:"WOOFX3_DATABASE_PROXY_PORT,default=8080"`
	LogLevel          string `env:"WOOFX3_LOG_LEVEL"`
	nats.Config
}

// Casbin model for command/resource authorization. This governs whether a
// given actor (a chat username, or "group:<groupId>" for a group grant) may
// perform an action on a resource (e.g. "command/<name>"). It is NOT used to
// gate access to the api service's HTTP endpoints - that has its own
// token-based auth. g(user, group) is Casbin's built-in RBAC role resolution;
// keyMatch2 keeps "command/*"-style wildcard grants working.
func GetCasbinModelString() (string, error) {
	return `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (g(r.sub, p.sub) || r.sub == p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act
`, nil
}
