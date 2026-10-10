package services

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/wolfymaster/woofx3/db/database/models"
)

func TestParseSegmentConditionRefusesMalformedTrees(t *testing.T) {
	cases := map[string]struct {
		when string
		want string
	}{
		"not json":            {`{"fact":`, "not a segment condition"},
		"trailing data":       {`{"fact": "a", "op": "exists"} {}`, "trailing data"},
		"unknown key":         {`{"fact": "a", "op": "exists", "path": "x"}`, "unknown field"},
		"unknown nested key":  {`{"all": [{"fact": "a", "op": "exists", "values": 1}]}`, "unknown field"},
		"two kinds":           {`{"all": [{"fact": "a", "op": "exists"}], "not": {"fact": "a", "op": "exists"}}`, "exactly one"},
		"empty node":          {`{}`, "exactly one"},
		"empty all":           {`{"all": []}`, "all has no conditions"},
		"empty any":           {`{"any": []}`, "any has no conditions"},
		"atom without fact":   {`{"op": "exists"}`, "has no fact"},
		"atom without op":     {`{"fact": "a", "value": 1}`, "has no op"},
		"unknown op":          {`{"fact": "a", "op": "contains", "value": "x"}`, `op "contains"`},
		"exists with value":   {`{"fact": "a", "op": "exists", "value": 1}`, "takes no value"},
		"within a number":     {`{"fact": "a", "op": "within", "value": 3600}`, "needs a duration"},
		"within bad duration": {`{"fact": "a", "op": "within", "value": "a month"}`, "needs a duration"},
		"older than nothing":  {`{"fact": "a", "op": "older_than", "value": "-1h"}`, "positive duration"},
		"gt a string":         {`{"fact": "a", "op": "gt", "value": "10"}`, "gt needs a number"},
		"gte null":            {`{"fact": "a", "op": "gte", "value": null}`, "gte needs a number"},
		"eq a bool":           {`{"fact": "a", "op": "eq", "value": true}`, "number or a string"},
		"eq without value":    {`{"fact": "a", "op": "eq"}`, "needs a value"},
		"nested error path":   {`{"any": [{"fact": "a", "op": "exists"}, {"not": {"fact": "b", "op": "lt"}}]}`, "any[1]: not: b: lt needs a number"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, err := parseSegmentCondition(tc.when)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("parse(%s) = %v, want an error containing %q", tc.when, err, tc.want)
			}
		})
	}
}

func TestParseSegmentConditionNamesItsFactsAndTimeRelativity(t *testing.T) {
	condition, canonical, err := parseSegmentCondition(`{"all": [
		{"fact": "user:fact:messages", "op": "gte", "value": 10},
		{"any": [{"fact": "user:fact:last_seen", "op": "within", "value": "24h"}, {"not": {"fact": "user:fact:messages", "op": "exists"}}]}
	]}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if want := []string{"user:fact:last_seen", "user:fact:messages"}; !slices.Equal(condition.facts(), want) {
		t.Fatalf("facts = %v, want %v", condition.facts(), want)
	}
	if !condition.timeRelative() {
		t.Fatal("a within atom did not make the condition time-relative")
	}
	want := `{"all":[{"fact":"user:fact:messages","op":"gte","value":10},{"any":[{"fact":"user:fact:last_seen","op":"within","value":"24h"},{"not":{"fact":"user:fact:messages","op":"exists"}}]}]}`
	if canonical != want {
		t.Fatalf("canonical = %s\nwant        %s", canonical, want)
	}

	plain, _, err := parseSegmentCondition(`{"fact": "user:fact:messages", "op": "gt", "value": 0}`)
	if err != nil || plain.timeRelative() {
		t.Fatalf("a plain threshold: time-relative %v, %v", plain.timeRelative(), err)
	}
}

func TestSegmentConditionChecksOpsAgainstFactKinds(t *testing.T) {
	facts := map[string]segmentFact{
		"n": {valueKind: models.FactValueKindNumber},
		"s": {valueKind: models.FactValueKindString},
		"t": {valueKind: models.FactValueKindTimestamp},
	}
	cases := map[string]string{
		`{"fact": "n", "op": "gt", "value": 1}`:            "",
		`{"fact": "t", "op": "lte", "value": 1}`:           "",
		`{"fact": "t", "op": "older_than", "value": "1h"}`: "",
		`{"fact": "s", "op": "eq", "value": "gold"}`:       "",
		`{"fact": "n", "op": "ne", "value": 3}`:            "",
		`{"fact": "s", "op": "exists"}`:                    "",
		`{"fact": "s", "op": "gte", "value": 1}`:           "gte compares numbers and timestamps, and the fact is a string",
		`{"fact": "n", "op": "within", "value": "1h"}`:     "within reads a timestamp, and the fact is a number",
		`{"fact": "n", "op": "eq", "value": "3"}`:          "eq compares a number fact with a string",
		`{"fact": "s", "op": "ne", "value": 3}`:            "ne compares a string fact with a number",
		`{"fact": "missing", "op": "exists"}`:              "missing is not a fact",
	}
	for when, want := range cases {
		condition, _, err := parseSegmentCondition(when)
		if err != nil {
			t.Fatalf("parse(%s): %v", when, err)
		}
		err = condition.checkFacts(facts)
		if want == "" && err != nil {
			t.Errorf("check(%s) = %v, want ok", when, err)
		}
		if want != "" && (err == nil || !strings.Contains(err.Error(), want)) {
			t.Errorf("check(%s) = %v, want %q", when, err, want)
		}
	}
}

func TestEvaluateSegmentCondition(t *testing.T) {
	now := time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)
	num := func(n float64) *factReading { return &factReading{num: &n} }
	str := func(s string) *factReading { return &factReading{str: &s} }
	at := func(ago time.Duration) *factReading { return num(float64(now.Add(-ago).UnixMilli())) }
	values := map[string]*factReading{
		"messages":  num(10),
		"tier":      str("gold"),
		"last_seen": at(48 * time.Hour),
		"first":     at(400 * 24 * time.Hour),
		"empty":     {},
	}

	cases := []struct {
		when string
		want bool
	}{
		{`{"fact": "messages", "op": "eq", "value": 10}`, true},
		{`{"fact": "messages", "op": "ne", "value": 10}`, false},
		{`{"fact": "messages", "op": "gt", "value": 10}`, false},
		{`{"fact": "messages", "op": "gte", "value": 10}`, true},
		{`{"fact": "messages", "op": "lt", "value": 10.5}`, true},
		{`{"fact": "messages", "op": "lte", "value": 9}`, false},
		{`{"fact": "tier", "op": "eq", "value": "gold"}`, true},
		{`{"fact": "tier", "op": "ne", "value": "silver"}`, true},
		{`{"fact": "tier", "op": "gt", "value": 1}`, false},
		{`{"fact": "messages", "op": "exists"}`, true},
		{`{"fact": "messages", "op": "not_exists"}`, false},
		{`{"fact": "last_seen", "op": "within", "value": "72h"}`, true},
		{`{"fact": "last_seen", "op": "within", "value": "24h"}`, false},
		{`{"fact": "last_seen", "op": "older_than", "value": "24h"}`, true},
		{`{"fact": "last_seen", "op": "older_than", "value": "48h"}`, false},
		{`{"fact": "first", "op": "older_than", "value": "8760h"}`, true},

		// A value the viewer does not have: only not_exists and ne hold.
		{`{"fact": "absent", "op": "exists"}`, false},
		{`{"fact": "absent", "op": "not_exists"}`, true},
		{`{"fact": "absent", "op": "eq", "value": 0}`, false},
		{`{"fact": "absent", "op": "ne", "value": 0}`, true},
		{`{"fact": "absent", "op": "gte", "value": 0}`, false},
		{`{"fact": "absent", "op": "lt", "value": 1}`, false},
		{`{"fact": "absent", "op": "within", "value": "1h"}`, false},
		{`{"fact": "absent", "op": "older_than", "value": "1h"}`, false},
		{`{"fact": "empty", "op": "exists"}`, false},
		{`{"fact": "empty", "op": "ne", "value": "x"}`, true},

		{`{"all": [{"fact": "messages", "op": "gte", "value": 10}, {"fact": "tier", "op": "eq", "value": "gold"}]}`, true},
		{`{"all": [{"fact": "messages", "op": "gte", "value": 10}, {"fact": "absent", "op": "exists"}]}`, false},
		{`{"any": [{"fact": "absent", "op": "exists"}, {"fact": "tier", "op": "eq", "value": "gold"}]}`, true},
		{`{"any": [{"fact": "absent", "op": "exists"}, {"fact": "messages", "op": "lt", "value": 1}]}`, false},
		{`{"not": {"fact": "absent", "op": "exists"}}`, true},
		{`{"not": {"any": [{"fact": "messages", "op": "gt", "value": 100}, {"fact": "last_seen", "op": "older_than", "value": "720h"}]}}`, true},
	}
	for _, tc := range cases {
		condition, _, err := parseSegmentCondition(tc.when)
		if err != nil {
			t.Fatalf("parse(%s): %v", tc.when, err)
		}
		if got := condition.evaluate(values, now); got != tc.want {
			t.Errorf("evaluate(%s) = %v, want %v", tc.when, got, tc.want)
		}
	}
}
