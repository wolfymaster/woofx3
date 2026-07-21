package main

import (
	"context"
	"strings"
	"sync"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// AssetBaseURLSettingKey is the db-proxy `settings` row a UI settings page
// writes to override where workflow-referenced assets are served from.
// Modules/workflows must never embed a deployment-specific asset host
// directly; they reference `${woofx3_asset_url}` instead, and this setting
// (or, absent a row, DefaultAssetBaseURL) supplies the value at execution
// time. Application-scoped, same as storage.* settings in barkloader.
const AssetBaseURLSettingKey = "assets.baseUrl"

// assetURLCacheTTL bounds how stale a resolved asset base URL can be after
// the setting changes in the DB. Task execution can run at high frequency,
// so we cache per applicationId rather than round-tripping to db-proxy on
// every parameter resolution.
const assetURLCacheTTL = 30 * time.Second

// assetURLRequestTimeout bounds the GetSetting call itself so a slow or
// unreachable db-proxy can't stall workflow execution.
const assetURLRequestTimeout = 2 * time.Second

type cachedAssetURL struct {
	value     string
	fetchedAt time.Time
}

// AssetSettingsResolver implements engine.AssetURLResolver against the
// db-proxy SettingService. Falls back to defaultURL (derived from
// WOOFX3_BARKLOADER_URL, see main.go) whenever no `assets.baseUrl` row
// exists yet, so the engine works out of the box before the UI's asset
// settings page has been used.
type AssetSettingsResolver struct {
	client     dbv1.SettingService
	defaultURL string
	logger     tasks.Logger

	mu    sync.RWMutex
	cache map[string]cachedAssetURL
}

func NewAssetSettingsResolver(client dbv1.SettingService, defaultURL string, logger tasks.Logger) *AssetSettingsResolver {
	return &AssetSettingsResolver{
		client:     client,
		defaultURL: strings.TrimRight(defaultURL, "/"),
		logger:     logger,
		cache:      make(map[string]cachedAssetURL),
	}
}

// Resolve returns the asset base URL for applicationID, e.g.
// "https://cdn.example.com/assets" — callers append "/<path>" themselves via
// the `${woofx3_asset_url}` expression. Never returns an error; a lookup
// failure just falls back to defaultURL so a flaky db-proxy never breaks
// workflow execution.
func (r *AssetSettingsResolver) Resolve(applicationID string) string {
	r.mu.RLock()
	cached, ok := r.cache[applicationID]
	r.mu.RUnlock()
	if ok && time.Since(cached.fetchedAt) < assetURLCacheTTL {
		return cached.value
	}

	value := r.defaultURL
	if r.client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), assetURLRequestTimeout)
		resp, err := r.client.GetSetting(ctx, &dbv1.GetSettingRequest{
			Key:           AssetBaseURLSettingKey,
			ApplicationId: applicationID,
		})
		cancel()

		if err != nil {
			r.logger.Warn("Failed to resolve assets.baseUrl setting; using default",
				"applicationId", applicationID, "error", err, "default", r.defaultURL)
		} else if sv := resp.GetSetting().GetValue().GetStringValue(); sv != "" {
			value = strings.TrimRight(sv, "/")
		}
	}

	r.mu.Lock()
	r.cache[applicationID] = cachedAssetURL{value: value, fetchedAt: time.Now()}
	r.mu.Unlock()

	return value
}
