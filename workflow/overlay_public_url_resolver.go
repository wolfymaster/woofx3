package main

import (
	"context"
	"strings"
	"sync"
	"time"

	dbv1 "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/workflow/internal/tasks"
)

// OverlayPublicURLSettingKey is the db-proxy `settings` row a UI settings
// page writes to configure the single public base URL this deployment's
// overlay surface is reachable at — both token-scoped overlay access and
// (via the same `/overlay/` surface) asset resolution (see
// docs/services/engine-settings-ui.md). Process-wide, not scoped per
// application — it describes the deployment's own network topology, not
// anything per-application.
const OverlayPublicURLSettingKey = "overlay.publicUrl"

const overlayPublicURLCacheTTL = 30 * time.Second
const overlayPublicURLRequestTimeout = 2 * time.Second

// OverlayPublicURLResolver resolves OverlayPublicURLSettingKey via the
// db-proxy with a 30s TTL cache. Mirrors the "DB setting with config
// fallback" pattern used elsewhere in this codebase (see
// streamware/src/overlay/overlay-public-url-resolver.ts, its structural
// sibling): never returns an error, never blocks callers on a slow or
// unreachable db-proxy for more than overlayPublicURLRequestTimeout — a
// lookup failure, an unset setting, or no db client configured all fall
// back to defaultURL, which itself may be an empty string (no hardcoded
// guess beyond the caller-supplied env/config default).
type OverlayPublicURLResolver struct {
	settings   dbv1.SettingService
	defaultURL string
	logger     tasks.Logger

	mu        sync.Mutex
	cached    string
	expiresAt time.Time
}

func NewOverlayPublicURLResolver(settings dbv1.SettingService, defaultURL string, logger tasks.Logger) *OverlayPublicURLResolver {
	return &OverlayPublicURLResolver{
		settings:   settings,
		defaultURL: strings.TrimRight(defaultURL, "/"),
		logger:     logger,
	}
}

// Resolve implements engine.AssetURLResolver.
func (r *OverlayPublicURLResolver) Resolve() string {
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

	ctx, cancel := context.WithTimeout(context.Background(), overlayPublicURLRequestTimeout)
	defer cancel()

	value := r.defaultURL
	resp, err := r.settings.GetSetting(ctx, &dbv1.GetSettingRequest{
		Key:           OverlayPublicURLSettingKey,
		ApplicationId: "",
	})
	if err != nil {
		if r.logger != nil {
			r.logger.Warn("failed to resolve overlay.publicUrl setting; using default", "error", err, "default", r.defaultURL)
		}
	} else if setting := resp.GetSetting(); setting != nil {
		if s := setting.GetValue().GetStringValue(); s != "" {
			value = strings.TrimRight(s, "/")
		}
	}

	r.mu.Lock()
	r.cached = value
	r.expiresAt = time.Now().Add(overlayPublicURLCacheTTL)
	r.mu.Unlock()

	return value
}
