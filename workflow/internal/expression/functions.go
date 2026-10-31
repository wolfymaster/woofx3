package expression

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// ErrFunctionCall wraps every failure of a function call in an expression:
// an unknown name, a wrong argument count, an argument it cannot use, or a
// malformed call. Unlike other embedded expressions, one inside a longer
// string fails the step rather than leaving its token in the text, because
// that text is usually on its way to viewers.
var ErrFunctionCall = errors.New("function call failed")

// callPattern finds what reads as a function call. It decides only whether an
// expression that failed to parse was meant to be a call, so a match inside a
// string literal of an expression that parses is harmless.
var callPattern = regexp.MustCompile(`[A-Za-z_$][A-Za-z0-9_$.\[\]-]*\s*\(`)

// decimalNumber is the text an argument may hold to count as a number.
// Stricter than strconv.ParseFloat, which also reads "Inf", "NaN" and "0x10".
var decimalNumber = regexp.MustCompile(`^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$`)

const (
	// noArgLimit is a function's maxArgs when it takes any number of arguments.
	noArgLimit = -1
	// resultDecimals is where arithmetic results are cut, so that binary
	// floating point noise (0.1 + 0.2 = 0.30000000000000004) never reaches a
	// viewer.
	resultDecimals = 10
	// maxRoundDigits matches resultDecimals: finer digits would only show noise.
	maxRoundDigits = 10
	// maxWholeNumber is the largest whole number a float64 holds exactly.
	maxWholeNumber = 1 << 53
)

type function struct {
	minArgs int
	maxArgs int
	call    func(r *Resolver, name string, args []any) (any, error)
}

// functions is the expression language's fixed set. It must match
// EXPRESSION_FUNCTIONS in shared/clients/typescript/api/expression.ts; both are
// held to tests/expression-conformance.json beside it.
var functions = map[string]function{
	"add":       {minArgs: 2, maxArgs: noArgLimit, call: fold(func(a, b float64) float64 { return a + b })},
	"subtract":  {minArgs: 2, maxArgs: 2, call: fold(func(a, b float64) float64 { return a - b })},
	"multiply":  {minArgs: 2, maxArgs: noArgLimit, call: fold(func(a, b float64) float64 { return a * b })},
	"divide":    {minArgs: 2, maxArgs: 2, call: callDivide},
	"min":       {minArgs: 2, maxArgs: noArgLimit, call: fold(math.Min)},
	"max":       {minArgs: 2, maxArgs: noArgLimit, call: fold(math.Max)},
	"round":     {minArgs: 1, maxArgs: 2, call: callRound},
	"uppercase": {minArgs: 1, maxArgs: 1, call: mapText(strings.ToUpper)},
	"lowercase": {minArgs: 1, maxArgs: 1, call: mapText(strings.ToLower)},
	"random":    {minArgs: 2, maxArgs: 2, call: callRandom},
}

// lookupFunction checks a call against the set, so a bad one fails when it is
// parsed, whichever branch of the expression it sits in.
func lookupFunction(name string, argCount int) (function, error) {
	fn, ok := functions[name]
	if !ok {
		return function{}, fmt.Errorf("unknown function %q", name)
	}
	if argCount < fn.minArgs {
		return function{}, fmt.Errorf("%s takes at least %d arguments, got %d", name, fn.minArgs, argCount)
	}
	if fn.maxArgs != noArgLimit && argCount > fn.maxArgs {
		return function{}, fmt.Errorf("%s takes at most %d arguments, got %d", name, fn.maxArgs, argCount)
	}
	return fn, nil
}

type call struct {
	name string
	fn   function
	args []node
}

func (n call) eval(r *Resolver) (any, error) {
	args := make([]any, len(n.args))
	for i, arg := range n.args {
		value, err := arg.eval(r)
		if err != nil {
			return nil, fmt.Errorf("%w: %s: %w", ErrFunctionCall, n.name, err)
		}
		args[i] = value
	}
	result, err := n.fn.call(r, n.name, args)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrFunctionCall, err)
	}
	return result, nil
}

// ValidateFunctionCalls reports the first bad function call in a string's
// `${…}` expressions. An expression with no call is not judged: it keeps the
// run-time behavior it has always had.
func ValidateFunctionCalls(s string) error {
	for _, match := range expressionPattern.FindAllStringSubmatch(s, -1) {
		expr := match[1]
		if strings.HasPrefix(expr, assetURLPrefix) || strings.HasPrefix(expr, assetMarkerPrefix) {
			continue
		}
		if !callPattern.MatchString(expr) {
			continue
		}
		if _, err := parseCompound(expr); err != nil {
			return fmt.Errorf("${%s}: %w", expr, err)
		}
	}
	return nil
}

func fold(combine func(a, b float64) float64) func(*Resolver, string, []any) (any, error) {
	return func(_ *Resolver, name string, args []any) (any, error) {
		total, err := numberArg(name, args, 0)
		if err != nil {
			return nil, err
		}
		for i := 1; i < len(args); i++ {
			n, err := numberArg(name, args, i)
			if err != nil {
				return nil, err
			}
			total = combine(total, n)
		}
		return arithmeticResult(name, total)
	}
}

func callDivide(_ *Resolver, name string, args []any) (any, error) {
	dividend, err := numberArg(name, args, 0)
	if err != nil {
		return nil, err
	}
	divisor, err := numberArg(name, args, 1)
	if err != nil {
		return nil, err
	}
	if divisor == 0 {
		return nil, fmt.Errorf("%s: cannot divide by zero", name)
	}
	return arithmeticResult(name, dividend/divisor)
}

// callRound rounds halves away from zero. The value is cleaned of float noise
// first, so 1.005, stored as 1.00499999…, rounds to 1.01 as written.
func callRound(_ *Resolver, name string, args []any) (any, error) {
	value, err := numberArg(name, args, 0)
	if err != nil {
		return nil, err
	}
	digits := 0
	if len(args) > 1 {
		d, err := wholeNumberArg(name, args, 1)
		if err != nil {
			return nil, err
		}
		if d < 0 || d > maxRoundDigits {
			return nil, fmt.Errorf("%s: digits must be between 0 and %d, got %v", name, maxRoundDigits, d)
		}
		digits = int(d)
	}
	scale := math.Pow10(digits)
	return arithmeticResult(name, math.Round(withoutFloatNoise(value*scale))/scale)
}

func callRandom(r *Resolver, name string, args []any) (any, error) {
	low, err := wholeNumberArg(name, args, 0)
	if err != nil {
		return nil, err
	}
	high, err := wholeNumberArg(name, args, 1)
	if err != nil {
		return nil, err
	}
	if low > high {
		return nil, fmt.Errorf("%s: min %d is greater than max %d", name, low, high)
	}
	return float64(low + int64(r.randomBelow(uint64(high-low)+1))), nil
}

func mapText(transform func(string) string) func(*Resolver, string, []any) (any, error) {
	return func(_ *Resolver, name string, args []any) (any, error) {
		switch v := args[0].(type) {
		case nil:
			return "", nil
		case map[string]any, OpenRecord, []any:
			return nil, fmt.Errorf("%s: argument 1 is not text", name)
		default:
			return transform(toString(v)), nil
		}
	}
}

// numberArg reads an argument as a number. Text holding a number counts,
// because chat arguments arrive as text. A missing value does not: a typo must
// not quietly become 0, and `|| 0` states that fallback when it is wanted.
func numberArg(name string, args []any, index int) (float64, error) {
	var n float64
	var ok bool
	if text, isText := args[index].(string); isText {
		trimmed := strings.TrimSpace(text)
		if decimalNumber.MatchString(trimmed) {
			parsed, err := strconv.ParseFloat(trimmed, 64)
			n, ok = parsed, err == nil
		}
	} else {
		n, ok = toFloat64(args[index])
	}
	if !ok || math.IsNaN(n) || math.IsInf(n, 0) {
		return 0, fmt.Errorf("%s: argument %d is missing or not a number, got %#v", name, index+1, args[index])
	}
	return n, nil
}

func wholeNumberArg(name string, args []any, index int) (int64, error) {
	n, err := numberArg(name, args, index)
	if err != nil {
		return 0, err
	}
	if n != math.Trunc(n) || math.Abs(n) > maxWholeNumber {
		return 0, fmt.Errorf("%s: argument %d must be a whole number, got %v", name, index+1, n)
	}
	return int64(n), nil
}

func arithmeticResult(name string, result float64) (float64, error) {
	if math.IsNaN(result) || math.IsInf(result, 0) {
		return 0, fmt.Errorf("%s: result is too large", name)
	}
	return withoutFloatNoise(result), nil
}

func withoutFloatNoise(n float64) float64 {
	cleaned, err := strconv.ParseFloat(strconv.FormatFloat(n, 'f', resultDecimals, 64), 64)
	if err != nil {
		return n
	}
	return cleaned
}
