package repository

import "testing"

// MODULE is every ordinary uninstall, so a caller that says nothing must get
// the safe behaviour rather than the powerful one.
func TestAnUnsetProvenanceDefaultsToModule(t *testing.T) {
	for _, in := range []string{"", "   "} {
		if got := normalizeProvenance(in); got != "MODULE" {
			t.Errorf("normalizeProvenance(%q) = %q, want MODULE", in, got)
		}
	}
}

// Removing an engine-owned namespace has to be asked for by name. This is the
// path the retired `builtin` and `chat_commands` rows had no way to reach.
func TestSystemMustBeNamedExplicitly(t *testing.T) {
	if got := normalizeProvenance("SYSTEM"); got != "SYSTEM" {
		t.Errorf("normalizeProvenance(SYSTEM) = %q", got)
	}
}

func TestProvenanceIsCaseAndWhitespaceInsensitive(t *testing.T) {
	for _, in := range []string{"system", " System ", "sYsTeM"} {
		if got := normalizeProvenance(in); got != "SYSTEM" {
			t.Errorf("normalizeProvenance(%q) = %q, want SYSTEM", in, got)
		}
	}
}

// An unrecognised value is passed through rather than silently coerced: it
// will match no rows, which is the honest outcome now that deletes report
// their affected count.
func TestAnUnknownProvenanceIsNotCoercedToModule(t *testing.T) {
	if got := normalizeProvenance("CLIENT"); got != "CLIENT" {
		t.Errorf("normalizeProvenance(CLIENT) = %q, want CLIENT", got)
	}
}
