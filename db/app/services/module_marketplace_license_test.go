package services

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/twitchtv/twirp"
	client "github.com/wolfymaster/woofx3/clients/db"
	"github.com/wolfymaster/woofx3/db/app/secrets"
)

func closeBody(t *testing.T, body io.Closer) {
	t.Helper()
	if err := body.Close(); err != nil {
		t.Errorf("close response body: %v", err)
	}
}

func installCozyLicensed(t *testing.T, svc *moduleService, moduleKey, listingID string, key *string) *client.Module {
	t.Helper()
	edition := int32(1)
	res, err := svc.CreateModule(context.Background(), &client.CreateModuleRequest{
		Name:                  "Cozy",
		ModuleId:              "cozy",
		Version:               "1.0.0",
		Manifest:              "{}",
		ModuleKey:             moduleKey,
		CreatedByType:         "CLIENT",
		CreatedByRef:          "client-1",
		MarketplaceListingId:  &listingID,
		MarketplaceEdition:    &edition,
		MarketplaceLicenseKey: key,
	})
	if err != nil {
		t.Fatalf("CreateModule %s: %v", moduleKey, err)
	}
	return res.Module
}

func storedLicenseKey(t *testing.T, svc *moduleService) *string {
	t.Helper()
	row, err := svc.repo.GetByModuleID("cozy")
	if err != nil {
		t.Fatalf("read module row: %v", err)
	}
	return row.MarketplaceLicenseKeySealed
}

func TestLicenseKeyIsSealedAtRestAndReadAsWritten(t *testing.T) {
	svc := newProvenanceSvc(t)
	created := installCozyLicensed(t, svc, "cozy:1.0.0:abcdef0", "cozy", ptr("W3X-AAAA"))
	if created.GetMarketplaceLicenseKey() != "W3X-AAAA" {
		t.Fatalf("CreateModule key = %q, want W3X-AAAA", created.GetMarketplaceLicenseKey())
	}

	stored := storedLicenseKey(t, svc)
	if stored == nil || !secrets.IsSealed(*stored) || strings.Contains(*stored, "W3X-AAAA") {
		t.Fatalf("stored key = %v, want it sealed", stored)
	}

	byID, err := svc.GetModuleByModuleId(context.Background(), &client.GetModuleByModuleIdRequest{ModuleId: "cozy"})
	if err != nil {
		t.Fatalf("GetModuleByModuleId: %v", err)
	}
	listed, err := svc.ListModules(context.Background(), &client.ListModulesRequest{})
	if err != nil {
		t.Fatalf("ListModules: %v", err)
	}
	for label, m := range map[string]*client.Module{"GetModuleByModuleId": byID.Module, "ListModules": listed.Modules[0]} {
		if m.GetMarketplaceLicenseKey() != "W3X-AAAA" {
			t.Fatalf("%s key = %q, want W3X-AAAA", label, m.GetMarketplaceLicenseKey())
		}
	}
}

// The key belongs to the listing it was downloaded with: an install that
// names a listing replaces the key, with none when it brings none; an upload
// clears it; an install naming no origin keeps it, as it keeps the listing.
func TestReplacingAModuleReplacesOrKeepsItsLicenseKey(t *testing.T) {
	svc := newProvenanceSvc(t)
	installCozyLicensed(t, svc, "cozy:1.0.0:abcdef0", "cozy", ptr("W3X-AAAA"))

	steps := []struct {
		name    string
		install func() *client.Module
		want    *string
	}{
		{"a new edition with its own key", func() *client.Module {
			return installCozyLicensed(t, svc, "cozy:2.0.0:1234567", "cozy-v2", ptr("W3X-BBBB"))
		}, ptr("W3X-BBBB")},
		{"no origin keeps the key", func() *client.Module {
			return installCozy(t, svc, "cozy:2.0.1:7654321", nil, nil)
		}, ptr("W3X-BBBB")},
		{"a listing without a key leaves none", func() *client.Module {
			return installCozyLicensed(t, svc, "cozy:1.0.0:abcdef0", "cozy", nil)
		}, nil},
		{"a key again", func() *client.Module {
			return installCozyLicensed(t, svc, "cozy:2.0.0:1234567", "cozy-v2", ptr("W3X-CCCC"))
		}, ptr("W3X-CCCC")},
		{"an upload clears it", func() *client.Module {
			return installCozyFromUpload(t, svc, "cozy:3.0.0:3333333", uploadA)
		}, nil},
	}
	for _, step := range steps {
		got := step.install()
		if (step.want == nil) != (got.MarketplaceLicenseKey == nil) ||
			(step.want != nil && *step.want != got.GetMarketplaceLicenseKey()) {
			t.Fatalf("%s: key = %v, want %v", step.name, got.MarketplaceLicenseKey, step.want)
		}
		if (step.want == nil) != (storedLicenseKey(t, svc) == nil) {
			t.Fatalf("%s: stored key does not match the answer", step.name)
		}
	}
}

func TestLicenseKeyIsRefusedWithoutAListingOrWhenBlank(t *testing.T) {
	svc := newProvenanceSvc(t)
	for name, req := range map[string]*client.CreateModuleRequest{
		"no listing": {MarketplaceLicenseKey: ptr("W3X-AAAA")},
		"blank":      {MarketplaceListingId: ptr("cozy"), MarketplaceEdition: ptr(int32(1)), MarketplaceLicenseKey: ptr("")},
		"with an upload": {
			UploadResourceId:      ptr(uploadA),
			MarketplaceLicenseKey: ptr("W3X-AAAA"),
		},
	} {
		t.Run(name, func(t *testing.T) {
			req.Name, req.ModuleId, req.Version, req.Manifest, req.ModuleKey = "Cozy", "cozy", "1.0.0", "{}", "cozy:1.0.0:abcdef0"
			_, err := svc.CreateModule(context.Background(), req)
			var twerr twirp.Error
			if !errors.As(err, &twerr) || twerr.Code() != twirp.InvalidArgument {
				t.Fatalf("err = %v, want InvalidArgument", err)
			}
		})
	}
}

// A key sealed for another row (or under another secrets key) does not open;
// the module still reads, without a key.
func TestALicenseKeyThatDoesNotOpenReadsAsNone(t *testing.T) {
	svc := newProvenanceSvc(t)
	installCozyLicensed(t, svc, "cozy:1.0.0:abcdef0", "cozy", ptr("W3X-AAAA"))
	foreign, err := testSecretsBox(t).Seal(licenseSealScope, "other_module", "W3X-AAAA")
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}
	row, err := svc.repo.GetByModuleID("cozy")
	if err != nil {
		t.Fatalf("read row: %v", err)
	}
	row.MarketplaceLicenseKeySealed = &foreign
	if err := svc.repo.Update(row); err != nil {
		t.Fatalf("update row: %v", err)
	}

	got, err := svc.GetModuleByModuleId(context.Background(), &client.GetModuleByModuleIdRequest{ModuleId: "cozy"})
	if err != nil {
		t.Fatalf("GetModuleByModuleId: %v", err)
	}
	if got.Module.MarketplaceLicenseKey != nil {
		t.Fatalf("key = %q, want none", got.Module.GetMarketplaceLicenseKey())
	}
}

// Barkloader writes the install as Twirp JSON in snake_case.
func TestLicenseKeyCrossesTheTwirpBoundary(t *testing.T) {
	server := httptest.NewServer(client.NewModuleServiceServer(newProvenanceSvc(t)))
	defer server.Close()

	body := `{"name":"Cozy","module_id":"cozy","version":"1.0.0","module_key":"cozy:1.0.0:abcdef0",` +
		`"marketplace_listing_id":"cozy","marketplace_edition":1,"marketplace_license_key":"W3X-AAAA"}`
	res, err := http.Post(server.URL+"/twirp/module.ModuleService/CreateModule", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatalf("CreateModule: %v", err)
	}
	defer closeBody(t, res.Body)
	if res.StatusCode != http.StatusOK {
		text, _ := io.ReadAll(res.Body)
		t.Fatalf("CreateModule status = %d: %s", res.StatusCode, text)
	}

	read, err := http.Post(server.URL+"/twirp/module.ModuleService/GetModuleByModuleId", "application/json",
		strings.NewReader(`{"module_id":"cozy"}`))
	if err != nil {
		t.Fatalf("GetModuleByModuleId: %v", err)
	}
	defer closeBody(t, read.Body)
	text, err := io.ReadAll(read.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if !strings.Contains(string(text), `"marketplace_license_key":"W3X-AAAA"`) {
		t.Fatalf("GetModuleByModuleId body = %s, want the key under its proto name", text)
	}
}
