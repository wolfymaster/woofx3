package main

import (
	"context"
	"errors"
	"testing"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"google.golang.org/protobuf/types/known/structpb"
)

type fakeSettingService struct {
	getSetting func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error)
	calls      int
}

func (f *fakeSettingService) GetSetting(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
	f.calls++
	return f.getSetting(ctx, req)
}

func (f *fakeSettingService) GetSettings(context.Context, *dbv1.GetSettingsRequest) (*dbv1.GetSettingsResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSettingService) SetSetting(context.Context, *dbv1.SetSettingRequest) (*dbv1.SettingResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSettingService) SetSettings(context.Context, *dbv1.SetSettingsRequest) (*dbv1.SetSettingsResponse, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSettingService) DeleteSetting(context.Context, *dbv1.DeleteSettingRequest) (*dbv1.ResponseStatus, error) {
	return nil, errors.New("not implemented")
}

func (f *fakeSettingService) ListSettingsByPrefix(context.Context, *dbv1.ListSettingsRequest) (*dbv1.ListSettingsResponse, error) {
	return nil, errors.New("not implemented")
}

func stringSettingResponse(value string) *dbv1.SettingResponse {
	return &dbv1.SettingResponse{
		Setting: &dbv1.Setting{
			Key:   SceneManagerURLSettingKey,
			Value: structpb.NewStringValue(value),
		},
	}
}

func TestSceneManagerURLResolverFallsBackWithNoDbClient(t *testing.T) {
	r := NewSceneManagerURLResolver(nil, "http://127.0.0.1:9100/", nil)
	if got := r.Resolve(); got != "http://127.0.0.1:9100" {
		t.Fatalf("got %q", got)
	}
}

func TestSceneManagerURLResolverUsesConfiguredSettingAndCaches(t *testing.T) {
	settings := &fakeSettingService{
		getSetting: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			if req.Key != SceneManagerURLSettingKey {
				t.Fatalf("unexpected key %q", req.Key)
			}
			if req.ApplicationId != "" {
				t.Fatalf("expected empty (process-wide) applicationId, got %q", req.ApplicationId)
			}
			return stringSettingResponse("https://tunnel.example.com/"), nil
		},
	}
	r := NewSceneManagerURLResolver(settings, "http://127.0.0.1:9100", nil)

	if got := r.Resolve(); got != "https://tunnel.example.com" {
		t.Fatalf("got %q", got)
	}
	// Second call within the TTL must not round-trip again.
	r.Resolve()
	if settings.calls != 1 {
		t.Fatalf("expected 1 call, got %d", settings.calls)
	}
}

func TestSceneManagerURLResolverFallsBackOnTransportError(t *testing.T) {
	settings := &fakeSettingService{
		getSetting: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			return nil, errors.New("db-proxy unreachable")
		},
	}
	r := NewSceneManagerURLResolver(settings, "http://127.0.0.1:9100", nil)

	if got := r.Resolve(); got != "http://127.0.0.1:9100" {
		t.Fatalf("got %q", got)
	}
}

func TestSceneManagerURLResolverFallsBackWhenSettingUnset(t *testing.T) {
	settings := &fakeSettingService{
		getSetting: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			return &dbv1.SettingResponse{}, nil
		},
	}
	r := NewSceneManagerURLResolver(settings, "http://127.0.0.1:9100", nil)

	if got := r.Resolve(); got != "http://127.0.0.1:9100" {
		t.Fatalf("got %q", got)
	}
}
