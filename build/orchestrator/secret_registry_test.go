package main

import "testing"

func TestEngineSecretSpecsRegisterTheSecretsServicesRequire(t *testing.T) {
	specs := engineSecretSpecs()
	if err := checkSecretSpecs(specs); err != nil {
		t.Fatalf("the engine secret registry is invalid: %v", err)
	}
	registered := map[string]bool{}
	for _, spec := range specs {
		registered[spec.EnvKey] = true
	}
	for _, want := range []string{"WOOFX3_MESSAGEBUS_TOKEN", "WOOFX3_BARKLOADER_KEY", "WOOFX3_SCENE_MANAGER_TOKEN_SECRET"} {
		if !registered[want] {
			t.Errorf("%s is not in the engine secret registry", want)
		}
	}
}
