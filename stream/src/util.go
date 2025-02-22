package main

type SearchResult struct {
	Found bool
	Index int
}

func SearchString(haystack, needle string) SearchResult {
	if len(needle) == 0 {
		return SearchResult{Found: false, Index: -1}
	}

	if len(needle) > len(haystack) {
		return SearchResult{Found: false, Index: -1}
	}

	// Build bad character table
	badChar := make([]int, 256)
	for i := 0; i < 256; i++ {
		badChar[i] = len(needle)
	}

	for i := 0; i < len(needle)-1; i++ {
		badChar[needle[i]] = len(needle) - 1 - i
	}

	// Perform the search
	i := len(needle) - 1
	for i < len(haystack) {
		k := 0
		for k < len(needle) && needle[len(needle)-1-k] == haystack[i-k] {
			k++
		}

		if k == len(needle) {
			return SearchResult{
				Found: true,
				Index: i - len(needle) + 1,
			}
		}

		i += badChar[haystack[i]]
	}

	return SearchResult{Found: false, Index: -1}
}
