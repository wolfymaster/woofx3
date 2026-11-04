package services

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/twitchtv/twirp"
)

// Limits of one cell. Must match DATABASE_LIMITS in
// shared/clients/typescript/api. A length counts code points.
const (
	maxDatabaseTextLength = 5000
	maxDatabaseURLLength  = 2048
	databaseDateLayout    = "2006-01-02"
)

// databaseValueMode is how the values of a write are spelled.
type databaseValueMode int

const (
	// databaseValuesTyped values are JSON values of each column's type, as
	// the dashboard sends them; null is an empty cell.
	databaseValuesTyped databaseValueMode = iota
	// databaseValuesText values are all text, as workflow actions send them,
	// converted to each column's type; an empty text is an empty cell.
	databaseValuesText
)

// coerceValues checks raw values against the columns and returns them as
// stored: a string, float64 or bool per cell, or nil for a cell to clear.
//
// A refusal names the column by its label and never quotes the value, which
// may be a viewer's text and ends up in logs.
func coerceValues(columns []DatabaseColumn, raw map[string]any, mode databaseValueMode) (map[string]any, error) {
	byID := make(map[string]DatabaseColumn, len(columns))
	for _, column := range columns {
		byID[column.ID] = column
	}
	values := make(map[string]any, len(raw))
	for id, value := range raw {
		column, ok := byID[id]
		if !ok {
			return nil, twirp.InvalidArgumentError("values", fmt.Sprintf("the database has no column %q", id))
		}
		var cell any
		var err error
		if mode == databaseValuesText {
			text, isText := value.(string)
			if !isText {
				return nil, invalidCell(column, "must be text")
			}
			cell, err = coerceTextCell(column, text)
		} else {
			cell, err = coerceTypedCell(column, value)
		}
		if err != nil {
			return nil, err
		}
		values[id] = cell
	}
	return values, nil
}

func invalidCell(column DatabaseColumn, problem string) error {
	return twirp.InvalidArgumentError("values", fmt.Sprintf("%s %s", column.Label, problem))
}

func coerceTypedCell(column DatabaseColumn, value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	switch column.Type {
	case DatabaseColumnNumber:
		number, ok := value.(float64)
		if !ok {
			return nil, invalidCell(column, "must be a number")
		}
		return number, nil
	case DatabaseColumnBoolean:
		flag, ok := value.(bool)
		if !ok {
			return nil, invalidCell(column, "must be true or false")
		}
		return flag, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, invalidCell(column, "must be text")
	}
	return checkTextCell(column, text)
}

func coerceTextCell(column DatabaseColumn, text string) (any, error) {
	if text == "" {
		return nil, nil
	}
	switch column.Type {
	case DatabaseColumnNumber:
		number, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
		if err != nil || math.IsInf(number, 0) || math.IsNaN(number) {
			return nil, invalidCell(column, "must be a number")
		}
		return number, nil
	case DatabaseColumnBoolean:
		switch strings.ToLower(strings.TrimSpace(text)) {
		case "true":
			return true, nil
		case "false":
			return false, nil
		}
		return nil, invalidCell(column, "must be true or false")
	case DatabaseColumnDate:
		trimmed := strings.TrimSpace(text)
		if at, err := time.Parse(time.RFC3339, trimmed); err == nil {
			return at.UTC().Format(databaseDateLayout), nil
		}
		return checkTextCell(column, trimmed)
	case DatabaseColumnURL, DatabaseColumnSelect:
		return checkTextCell(column, strings.TrimSpace(text))
	}
	return checkTextCell(column, text)
}

// checkTextCell checks a cell spelled as text in its column's form.
func checkTextCell(column DatabaseColumn, text string) (any, error) {
	if strings.ContainsRune(text, 0) || !utf8.ValidString(text) {
		return nil, invalidCell(column, "must not contain a NUL or an invalid character")
	}
	switch column.Type {
	case DatabaseColumnText:
		if utf8.RuneCountInString(text) > maxDatabaseTextLength {
			return nil, invalidCell(column, fmt.Sprintf("must be at most %d characters", maxDatabaseTextLength))
		}
	case DatabaseColumnDate:
		if _, err := time.Parse(databaseDateLayout, text); err != nil {
			return nil, invalidCell(column, "must be a date written YYYY-MM-DD")
		}
	case DatabaseColumnURL:
		if !isWebURL(text) {
			return nil, invalidCell(column, fmt.Sprintf("must be an http or https link of at most %d characters", maxDatabaseURLLength))
		}
	case DatabaseColumnSelect:
		if !column.hasOption(text) {
			return nil, invalidCell(column, "must be one of its options")
		}
	default:
		return nil, invalidCell(column, "must not be text")
	}
	return text, nil
}

func isWebURL(text string) bool {
	if len(text) > maxDatabaseURLLength {
		return false
	}
	parsed, err := url.Parse(text)
	if err != nil {
		return false
	}
	return (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

// decodeTypedValues reads the JSON object of a typed write.
func decodeTypedValues(raw string) (map[string]any, error) {
	values := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &values); err != nil || values == nil {
		return nil, twirp.InvalidArgumentError("typed_values_json", "must be a JSON object of values by column id")
	}
	return values, nil
}

// publicValues is the part of values a column marks public.
func publicValues(columns []DatabaseColumn, values map[string]any) map[string]any {
	public := map[string]any{}
	for _, column := range columns {
		if !column.Public {
			continue
		}
		if value, ok := values[column.ID]; ok {
			public[column.ID] = value
		}
	}
	return public
}

// encodeValues writes values as compact JSON with HTML escaping off.
func encodeValues(values map[string]any) (string, error) {
	var buf bytes.Buffer
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(values); err != nil {
		return "", err
	}
	return strings.TrimSuffix(buf.String(), "\n"), nil
}
