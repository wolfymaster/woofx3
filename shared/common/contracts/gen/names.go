package main

import (
	"strings"
	"unicode"
)

// goInitialism is the capitalised spelling Go gives a word, if it has one
// (go.dev/wiki/CodeReviewComments#initialisms).
func goInitialism(word string) (string, bool) {
	switch word {
	case "api":
		return "API", true
	case "id":
		return "ID", true
	case "ids":
		return "IDs", true
	case "url":
		return "URL", true
	}
	return "", false
}

// words splits a contract name into lowercase words at dots, underscores and
// camelCase humps: "chat.send" and "replyToMessageId" become
// [chat send] and [reply to message id].
func words(name string) []string {
	var out []string
	var current strings.Builder
	flush := func() {
		if current.Len() > 0 {
			out = append(out, current.String())
			current.Reset()
		}
	}
	for _, r := range name {
		switch {
		case r == '.' || r == '_':
			flush()
		case unicode.IsUpper(r):
			flush()
			current.WriteRune(unicode.ToLower(r))
		default:
			current.WriteRune(r)
		}
	}
	flush()
	return out
}

// goName is the exported Go identifier for a contract name.
func goName(name string) string {
	var b strings.Builder
	for _, word := range words(name) {
		if initialism, ok := goInitialism(word); ok {
			b.WriteString(initialism)
			continue
		}
		b.WriteString(strings.ToUpper(word[:1]) + word[1:])
	}
	return b.String()
}

// pascalName is a contract name in PascalCase without Go's initialisms, for
// TypeScript type names.
func pascalName(name string) string {
	var b strings.Builder
	for _, word := range words(name) {
		b.WriteString(strings.ToUpper(word[:1]) + word[1:])
	}
	return b.String()
}

// screamingName is a contract name in SCREAMING_SNAKE_CASE, for the keys of
// TypeScript const id objects.
func screamingName(name string) string {
	return strings.ToUpper(strings.Join(words(name), "_"))
}
