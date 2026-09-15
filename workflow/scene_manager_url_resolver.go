package main

import (
	"context"
	"strings"
	"sync"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

const SceneManagerURLSettingKey = "scene.publicUrl"

const sceneManagerURLCacheTTL = 30 * time.Second
const sceneManagerURLRequestTimeout = 2 * time.Second

// SceneManagerURLResolver never returns an error: a failed, slow, or empty
// lookup of the setting falls back to the configured URL.
type SceneManagerURLResolver struct {
	settings   dbv1.SettingService
	defaultURL string
	logger     tasks.Logger

	mu        sync.Mutex
	cached    string
	expiresAt time.Time
}

func NewSceneManagerURLResolver(settings dbv1.SettingService, defaultURL string, logger tasks.Logger) *SceneManagerURLResolver {
	return &SceneManagerURLResolver{
		settings:   settings,
		defaultURL: strings.TrimRight(defaultURL, "/"),
		logger:     logger,
	}
}

// Resolve implements engine.AssetURLResolver.
func (r *SceneManagerURLResolver) Resolve() string {
	r.mu.Lock()
	if r.settings == nil {
		defer r.mu.Unlock()
		return r.defaultURL
	}
	if time.Now().Before(r.expiresAt) {
		defer r.mu.Unlock()
		return r.cached
	}
	r.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), sceneManagerURLRequestTimeout)
	defer cancel()

	value := r.defaultURL
	resp, err := r.settings.GetSetting(ctx, &dbv1.GetSettingRequest{
		Key:           SceneManagerURLSettingKey,
		ApplicationId: "",
	})
	if err != nil {
		if r.logger != nil {
			r.logger.Warn("failed to resolve scene.publicUrl setting; using default", "error", err, "default", r.defaultURL)
		}
	} else if setting := resp.GetSetting(); setting != nil {
		if s := setting.GetValue().GetStringValue(); s != "" {
			value = strings.TrimRight(s, "/")
		}
	}

	r.mu.Lock()
	r.cached = value
	r.expiresAt = time.Now().Add(sceneManagerURLCacheTTL)
	r.mu.Unlock()

	return value
}
