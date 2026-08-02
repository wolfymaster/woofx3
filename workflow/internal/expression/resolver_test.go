package expression

import "testing"

func TestResolveStringAssetURLToken(t *testing.T) {
	r := NewResolver()
	r.SetAssetURLBase("http://127.0.0.1:9100/overlay/assets/")

	// Regression: the repository key legitimately contains dots (file
	// extensions) — this must not be misparsed as a source.path
	// expression, which would split on the first "." and silently
	// truncate the path.
	got, err := r.ResolveString("${woofx3_asset_url:modules/wolfy_profile/assets/pleasure.mp3}")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "http://127.0.0.1:9100/overlay/assets/modules/wolfy_profile/assets/pleasure.mp3"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveStringAssetURLTokenEmbeddedInLargerString(t *testing.T) {
	r := NewResolver()
	r.SetAssetURLBase("http://127.0.0.1:9100/overlay/assets")

	got, err := r.ResolveString("prefix-${woofx3_asset_url:modules/wm/assets/bell.mp3}-suffix")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "prefix-http://127.0.0.1:9100/overlay/assets/modules/wm/assets/bell.mp3-suffix"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveStringAssetURLTokenWithoutBaseConfigured(t *testing.T) {
	r := NewResolver()
	// SetAssetURLBase never called — a full-expression token must fail
	// loudly rather than silently resolving to a broken URL.
	_, err := r.ResolveString("${woofx3_asset_url:modules/wm/assets/bell.mp3}")
	if err == nil {
		t.Fatal("expected an error when no asset base URL is configured")
	}
}

func TestResolveStringOrdinarySourcePathStillWorks(t *testing.T) {
	r := NewResolver()
	r.SetAssetURLBase("http://127.0.0.1:9100/overlay/assets")
	r.AddSource("trigger", map[string]any{"data": map[string]any{"userName": "wolfy"}})

	got, err := r.ResolveString("Hello ${trigger.data.userName}!")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Hello wolfy!" {
		t.Fatalf("got %q", got)
	}
}
