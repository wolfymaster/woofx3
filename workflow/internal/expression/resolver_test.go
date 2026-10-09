package expression

import (
	"reflect"
	"testing"
)

func TestResolveStringAssetURLToken(t *testing.T) {
	r := NewResolver()
	r.SetAssetURLBase("http://127.0.0.1:9100/assets/")

	// Regression: the repository key legitimately contains dots (file
	// extensions) — this must not be misparsed as a source.path
	// expression, which would split on the first "." and silently
	// truncate the path.
	got, err := r.ResolveString("${woofx3_asset_url:modules/wolfy_profile/assets/pleasure.mp3}")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "http://127.0.0.1:9100/assets/modules/wolfy_profile/assets/pleasure.mp3"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestResolveStringAssetURLTokenEmbeddedInLargerString(t *testing.T) {
	r := NewResolver()
	r.SetAssetURLBase("http://127.0.0.1:9100/assets")

	got, err := r.ResolveString("prefix-${woofx3_asset_url:modules/wm/assets/bell.mp3}-suffix")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	want := "prefix-http://127.0.0.1:9100/assets/modules/wm/assets/bell.mp3-suffix"
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
	r.SetAssetURLBase("http://127.0.0.1:9100/assets")
	r.AddSource("trigger", map[string]any{"data": map[string]any{"userName": "wolfy"}})

	got, err := r.ResolveString("Hello ${trigger.data.userName}!")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Hello wolfy!" {
		t.Fatalf("got %q", got)
	}
}

func TestLazySourceLoadsOnlyWhenReferencedAndOnce(t *testing.T) {
	loads := 0
	r := NewResolver()
	r.AddSource("trigger", map[string]any{"name": "wolfy"})
	r.AddLazySource("viewer", func() any {
		loads++
		return map[string]any{"id": "u1", "user": map[string]any{"apples": 3.0}}
	})

	if got, err := r.ResolveString("hi ${trigger.name}"); err != nil || got != "hi wolfy" {
		t.Fatalf("ResolveString = %v, %v", got, err)
	}
	if loads != 0 {
		t.Fatalf("loaded %d times without a reference, want 0", loads)
	}

	got, err := r.Resolve(map[string]any{
		"id":     "${viewer.id}",
		"apples": "${viewer.user.apples}",
		"text":   "${viewer.id} has ${viewer.user.apples}",
		"more":   "${viewer.user.apples > 2 && viewer.id == 'u1'}",
	})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	want := map[string]any{"id": "u1", "apples": 3.0, "text": "u1 has 3", "more": true}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Resolve = %v, want %v", got, want)
	}
	if loads != 1 {
		t.Fatalf("loaded %d times, want 1", loads)
	}
}

func TestLazySourceResolvesAnAbsentPathToNil(t *testing.T) {
	for name, data := range map[string]any{
		"absent key":       map[string]any{"id": "u1"},
		"nil data":         nil,
		"through a string": map[string]any{"user": "not a map"},
	} {
		t.Run(name, func(t *testing.T) {
			r := NewResolver()
			r.AddLazySource("viewer", func() any { return data })
			got, err := r.ResolveString("${viewer.user.apples}")
			if err != nil || got != nil {
				t.Fatalf("full expression = %v, %v; want nil, nil", got, err)
			}
			text, err := r.ResolveString("has ${viewer.user.apples} apples")
			if err != nil || text != "has  apples" {
				t.Fatalf("embedded = %q, %v", text, err)
			}
		})
	}
}

func TestLazySourceCannotShadowASource(t *testing.T) {
	r := NewResolver()
	r.AddSource("viewer", map[string]any{})
	defer func() {
		if recover() == nil {
			t.Fatal("a lazy source shadowed a source")
		}
	}()
	r.AddLazySource("viewer", func() any { return nil })
}

func TestConditionOnAbsentValueOnlyMeetsPresenceOperators(t *testing.T) {
	r := NewResolver()
	r.AddLazySource("viewer", func() any { return map[string]any{} })
	for _, tc := range []struct {
		op    string
		value any
		want  bool
	}{
		{"gt", 10, false},
		{"lt", 10, false},
		{"gte", 0, false},
		{"contains", "nil", false},
		{"eq", 10, false},
		{"ne", 10, true},
		{"exists", nil, false},
		{"not_exists", nil, true},
	} {
		got, err := Evaluate(&Condition{Field: "${viewer.user.apples}", Operator: tc.op, Value: tc.value}, r)
		if err != nil || got != tc.want {
			t.Errorf("absent %s %v = %v, %v; want %v", tc.op, tc.value, got, err, tc.want)
		}
	}
}
