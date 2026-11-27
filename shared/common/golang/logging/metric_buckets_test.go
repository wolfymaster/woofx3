package logging

import (
	"slices"
	"testing"
)

func TestBucketSetsAreAscendingAndFresh(t *testing.T) {
	tests := []struct {
		name    string
		buckets func() []float64
	}{
		{"short", ShortDurationBucketsSeconds},
		{"long", LongDurationBucketsSeconds},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.buckets()
			if !slices.IsSorted(got) {
				t.Fatalf("boundaries are not ascending: %v", got)
			}
			got[0] = -1
			if tc.buckets()[0] == -1 {
				t.Fatal("a caller changed the shared boundaries")
			}
		})
	}
}
