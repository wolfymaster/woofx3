package services

import (
	"context"
	"errors"
	"testing"

	"github.com/twitchtv/twirp"

	client "github.com/wolfymaster/woofx3/clients/db"
)

func TestRegisterTriggersKeepsEachTriggersPlatform(t *testing.T) {
	cases := []struct {
		name     string
		platform string
	}{
		{name: "a trigger pinned to twitch", platform: "twitch"},
		{name: "a trigger for any platform", platform: ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc, _ := newModuleSvc(t)
			ctx := context.Background()
			req := &client.RegisterTriggersRequest{ModuleId: "pups", Triggers: []*client.TriggerInput{{
				Name: "Follow", Description: "Follow", Event: "channel.follow", ConfigSchema: "[]",
				ManifestId: "follow", Transport: "eventbus", Platform: tc.platform,
			}}}
			if _, err := svc.RegisterTriggers(ctx, req); err != nil {
				t.Fatalf("RegisterTriggers: %v", err)
			}

			got, err := svc.GetTriggerByCanonicalId(ctx, &client.GetByCanonicalIdRequest{CanonicalId: "pups:trigger:follow"})
			if err != nil {
				t.Fatalf("GetTriggerByCanonicalId: %v", err)
			}
			if got.GetTrigger().GetPlatform() != tc.platform {
				t.Fatalf("platform = %q, want %q", got.GetTrigger().GetPlatform(), tc.platform)
			}
		})
	}
}

func TestRegisterTriggersRefusesAnUnknownPlatform(t *testing.T) {
	svc, _ := newModuleSvc(t)
	for _, platform := range []string{"Twitch", "youtube", " twitch"} {
		_, err := svc.RegisterTriggers(context.Background(), &client.RegisterTriggersRequest{ModuleId: "pups", Triggers: []*client.TriggerInput{{
			Name: "Follow", Description: "Follow", Event: "channel.follow", ConfigSchema: "[]",
			ManifestId: "follow", Transport: "eventbus", Platform: platform,
		}}})
		var twerr twirp.Error
		if !errors.As(err, &twerr) || twerr.Code() != twirp.InvalidArgument {
			t.Fatalf("platform %q: err = %v, want InvalidArgument", platform, err)
		}
	}
}
