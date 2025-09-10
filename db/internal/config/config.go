package config

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
