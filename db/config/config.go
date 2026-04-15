package config

import (
	"github.com/wolfymaster/woofx3/clients/nats"
)

type DatabaseEnvConfig struct {
	DatabaseURL       string `env:"WOOFX3_DATABASE_URL,required"`
	BadgerPath        string `env:"WOOFX3_BADGER_PATH,required"`
	DatabaseProxyPort string `env:"WOOFX3_DATABASE_PROXY_PORT,default=8080"`
	LogLevel          string `env:"WOOFX3_LOG_LEVEL"`
	ApplicationID     string `env:"WOOFX3_APPLICATION_ID"`
	ApplicationName   string `env:"WOOFX3_APPLICATION_NAME,default=woofx3"`
	nats.Config
}

func GetCasbinModelString() (string, error) {
	return `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act, eft

[role_definition]
g = _, _, _
g2 = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = (hasRole(r.sub, r.obj, p.sub) && hasObjType(r.obj, p.obj) && r.act == p.act) || (keyMatch2(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && r.act == p.act)
`, nil
}
