package main

import (
	"context"
	"errors"
	"testing"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"google.golang.org/protobuf/types/known/structpb"
)

type noopLogger struct{}

func (noopLogger) Info(string, ...any)  {}
func (noopLogger) Warn(string, ...any)  {}
func (noopLogger) Error(string, ...any) {}
func (noopLogger) Debug(string, ...any) {}

type fakeSettingService struct {
	dbv1.SettingService // embed to satisfy the interface; only GetSetting is exercised

	getSettingCalls int
	getSettingFunc  func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error)
}

func (f *fakeSettingService) GetSetting(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
	f.getSettingCalls++
	return f.getSettingFunc(ctx, req)
}

func TestAssetSettingsResolver_NoClientFallsBackToDefault(t *testing.T) {
	r := NewAssetSettingsResolver(nil, "http://localhost:9653/assets/", noopLogger{})

	got := r.Resolve("")
	want := "http://localhost:9653/assets"
	if got != want {
		t.Errorf("Resolve() = %q, want %q", got, want)
	}
}

func TestAssetSettingsResolver_UnsetSettingFallsBackToDefault(t *testing.T) {
	fake := &fakeSettingService{
		getSettingFunc: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			return &dbv1.SettingResponse{}, nil // no Setting populated == not found
		},
	}
	r := NewAssetSettingsResolver(fake, "http://localhost:9653/assets", noopLogger{})

	got := r.Resolve("app-1")
	want := "http://localhost:9653/assets"
	if got != want {
		t.Errorf("Resolve() = %q, want %q", got, want)
	}
}

func TestAssetSettingsResolver_UsesConfiguredSetting(t *testing.T) {
	fake := &fakeSettingService{
		getSettingFunc: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			if req.Key != AssetBaseURLSettingKey {
				t.Errorf("GetSetting key = %q, want %q", req.Key, AssetBaseURLSettingKey)
			}
			value, _ := structpb.NewValue("https://cdn.example.com/assets/")
			return &dbv1.SettingResponse{
				Setting: &dbv1.Setting{Key: req.Key, Value: value},
			}, nil
		},
	}
	r := NewAssetSettingsResolver(fake, "http://localhost:9653/assets", noopLogger{})

	got := r.Resolve("app-1")
	want := "https://cdn.example.com/assets"
	if got != want {
		t.Errorf("Resolve() = %q, want %q", got, want)
	}

	// Second call within the cache TTL must not round-trip again.
	r.Resolve("app-1")
	if fake.getSettingCalls != 1 {
		t.Errorf("GetSetting called %d times, want 1 (cached)", fake.getSettingCalls)
	}
}

func TestAssetSettingsResolver_ErrorFallsBackToDefault(t *testing.T) {
	fake := &fakeSettingService{
		getSettingFunc: func(ctx context.Context, req *dbv1.GetSettingRequest) (*dbv1.SettingResponse, error) {
			return nil, errors.New("db-proxy unreachable")
		},
	}
	r := NewAssetSettingsResolver(fake, "http://localhost:9653/assets", noopLogger{})

	got := r.Resolve("app-1")
	want := "http://localhost:9653/assets"
	if got != want {
		t.Errorf("Resolve() = %q, want %q", got, want)
	}
}
