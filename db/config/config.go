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
//
// The p.sub == "*" clause is how "every user" is expressed. Two cases need it,
// and neither can be represented with g() rows: the built-in "everyone" group
// (materialising one membership row per chatter would be unbounded and would
// go stale constantly), and a restricted command with no group or user grant
// configured, which means "no restriction" rather than "deny all". Putting it
// in the matcher keeps both enforcement paths - db-proxy's GetCommand hook and
// woofwoofwoof's canUse -> HasPermission - agreeing without either of them
// special-casing it in application code.
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
m = (p.sub == "*" || g(r.sub, p.sub) || r.sub == p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act
`, nil
}
