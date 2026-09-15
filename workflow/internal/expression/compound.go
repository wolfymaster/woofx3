package expression

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// compoundCharacters are what make an expression more than a plain
// reference. A plain reference keeps the original path lookup, so every
// expression written before operators existed resolves exactly as it did.
const compoundCharacters = "?:=!<>&|()'\""

func isCompound(expr string) bool {
	return strings.ContainsAny(expr, compoundCharacters)
}

// evaluateCompound evaluates an expression with operators:
//
//	cond ? a : b     only the chosen branch is evaluated
//	a || b, a && b   short-circuiting; yields an operand, as in JavaScript
//	!a               negation
//	== != > >= < <=  numeric when both sides are numbers (=== and !== alias)
//	( ... )          grouping
//	'text' "text"    string literals; 12, 1.5 and -3 are numbers; true false null
//
// Anything else is a reference, resolved like a plain `${source.path}`,
// except that a path which is not there is null, and ordering against null
// is false. Deliberately no arithmetic and no calls: this chooses between
// values, it does not compute them.
func (r *Resolver) evaluateCompound(expr string) (any, error) {
	tokens, err := tokenize(expr)
	if err != nil {
		return nil, err
	}
	p := &parser{expr: expr, tokens: tokens}
	root, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	if !p.done() {
		return nil, fmt.Errorf("unexpected %q in %q", p.tokens[p.pos].text, expr)
	}
	return root.eval(r)
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type tokenKind int

const (
	operatorToken tokenKind = iota
	stringToken
	numberToken
	referenceToken
)

type token struct {
	kind   tokenKind
	text   string
	number float64
}

// Longest first, so ">=" is never read as ">" followed by "=".
var operatorSpellings = []string{"===", "!==", "==", "!=", ">=", "<=", "&&", "||", ">", "<", "!", "?", ":", "(", ")"}

var operatorAliases = map[string]string{"===": "==", "!==": "!="}

func tokenize(expr string) ([]token, error) {
	var tokens []token
	for i := 0; i < len(expr); {
		c := expr[i]
		switch {
		case c == ' ' || c == '\t' || c == '\n':
			i++
		case c == '\'' || c == '"':
			end := strings.IndexByte(expr[i+1:], c)
			if end < 0 {
				return nil, fmt.Errorf("unterminated string in %q", expr)
			}
			tokens = append(tokens, token{kind: stringToken, text: expr[i+1 : i+1+end]})
			i += end + 2
		case isDigit(c) || (c == '-' && i+1 < len(expr) && isDigit(expr[i+1])):
			j := i + 1
			for j < len(expr) && (isDigit(expr[j]) || expr[j] == '.') {
				j++
			}
			n, err := strconv.ParseFloat(expr[i:j], 64)
			if err != nil {
				return nil, fmt.Errorf("bad number %q in %q", expr[i:j], expr)
			}
			tokens = append(tokens, token{kind: numberToken, text: expr[i:j], number: n})
			i = j
		case isReferenceStart(c):
			j := i + 1
			for j < len(expr) && isReferenceChar(expr[j]) {
				j++
			}
			tokens = append(tokens, token{kind: referenceToken, text: expr[i:j]})
			i = j
		default:
			op := matchOperator(expr[i:])
			if op == "" {
				return nil, fmt.Errorf("unexpected %q in %q", string(c), expr)
			}
			width := len(op)
			if alias, ok := operatorAliases[op]; ok {
				op = alias
			}
			tokens = append(tokens, token{kind: operatorToken, text: op})
			i += width
		}
	}
	return tokens, nil
}

func matchOperator(rest string) string {
	for _, op := range operatorSpellings {
		if strings.HasPrefix(rest, op) {
			return op
		}
	}
	return ""
}

func isDigit(c byte) bool {
	return c >= '0' && c <= '9'
}

func isReferenceStart(c byte) bool {
	return c == '_' || c == '$' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
}

// References keep the characters a plain path allows, including `-` (step
// ids like `step-1`) and brackets (`items[0]`).
func isReferenceChar(c byte) bool {
	return isReferenceStart(c) || isDigit(c) || c == '-' || c == '.' || c == '[' || c == ']'
}

// ---------------------------------------------------------------------------
// Parser, lowest precedence first: ternary, ||, &&, equality, comparison,
// unary, primary.
// ---------------------------------------------------------------------------

type parser struct {
	expr   string
	tokens []token
	pos    int
}

func (p *parser) done() bool {
	return p.pos >= len(p.tokens)
}

func (p *parser) acceptOperator(ops ...string) (string, bool) {
	if p.done() || p.tokens[p.pos].kind != operatorToken {
		return "", false
	}
	for _, op := range ops {
		if p.tokens[p.pos].text == op {
			p.pos++
			return op, true
		}
	}
	return "", false
}

func (p *parser) parseTernary() (node, error) {
	cond, err := p.parseOr()
	if err != nil {
		return nil, err
	}
	if _, ok := p.acceptOperator("?"); !ok {
		return cond, nil
	}
	then, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	if _, ok := p.acceptOperator(":"); !ok {
		return nil, fmt.Errorf("missing ':' in %q", p.expr)
	}
	otherwise, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	return conditional{cond: cond, then: then, otherwise: otherwise}, nil
}

func (p *parser) parseOr() (node, error) {
	return p.parseBinary(p.parseAnd, "||")
}

func (p *parser) parseAnd() (node, error) {
	return p.parseBinary(p.parseEquality, "&&")
}

func (p *parser) parseEquality() (node, error) {
	return p.parseBinary(p.parseComparison, "==", "!=")
}

func (p *parser) parseComparison() (node, error) {
	return p.parseBinary(p.parseUnary, ">", ">=", "<", "<=")
}

func (p *parser) parseBinary(operand func() (node, error), ops ...string) (node, error) {
	left, err := operand()
	if err != nil {
		return nil, err
	}
	for {
		op, ok := p.acceptOperator(ops...)
		if !ok {
			return left, nil
		}
		right, err := operand()
		if err != nil {
			return nil, err
		}
		left = binary{op: op, left: left, right: right}
	}
}

func (p *parser) parseUnary() (node, error) {
	if _, ok := p.acceptOperator("!"); ok {
		operand, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return negation{operand: operand}, nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() (node, error) {
	if p.done() {
		return nil, fmt.Errorf("unexpected end of %q", p.expr)
	}
	tok := p.tokens[p.pos]
	p.pos++
	switch tok.kind {
	case stringToken:
		return literal{value: tok.text}, nil
	case numberToken:
		return literal{value: tok.number}, nil
	case referenceToken:
		switch tok.text {
		case "true":
			return literal{value: true}, nil
		case "false":
			return literal{value: false}, nil
		case "null":
			return literal{value: nil}, nil
		}
		return reference{path: tok.text}, nil
	}
	if tok.text == "(" {
		inner, err := p.parseTernary()
		if err != nil {
			return nil, err
		}
		if _, ok := p.acceptOperator(")"); !ok {
			return nil, fmt.Errorf("missing ')' in %q", p.expr)
		}
		return inner, nil
	}
	return nil, fmt.Errorf("unexpected %q in %q", tok.text, p.expr)
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type node interface {
	eval(r *Resolver) (any, error)
}

type literal struct {
	value any
}

func (n literal) eval(*Resolver) (any, error) {
	return n.value, nil
}

type reference struct {
	path string
}

func (n reference) eval(r *Resolver) (any, error) {
	v, err := r.evaluateReference(n.path)
	// Null rather than an error, so a condition or an `||` fallback can test
	// an optional field. An unknown source stays an error: that is a typo,
	// not an absent value.
	if errors.Is(err, ErrPathNotFound) {
		return nil, nil
	}
	return v, err
}

type negation struct {
	operand node
}

func (n negation) eval(r *Resolver) (any, error) {
	v, err := n.operand.eval(r)
	if err != nil {
		return nil, err
	}
	return !truthy(v), nil
}

type binary struct {
	op          string
	left, right node
}

func (n binary) eval(r *Resolver) (any, error) {
	left, err := n.left.eval(r)
	if err != nil {
		return nil, err
	}
	switch n.op {
	case "&&":
		if !truthy(left) {
			return left, nil
		}
		return n.right.eval(r)
	case "||":
		if truthy(left) {
			return left, nil
		}
		return n.right.eval(r)
	}
	right, err := n.right.eval(r)
	if err != nil {
		return nil, err
	}
	// A missing value is neither above nor below anything.
	if (left == nil || right == nil) && n.op != "==" && n.op != "!=" {
		return false, nil
	}
	return evaluateOperator(n.op, left, right)
}

type conditional struct {
	cond, then, otherwise node
}

func (n conditional) eval(r *Resolver) (any, error) {
	cond, err := n.cond.eval(r)
	if err != nil {
		return nil, err
	}
	if truthy(cond) {
		return n.then.eval(r)
	}
	return n.otherwise.eval(r)
}

func truthy(v any) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if n, ok := toFloat64(v); ok {
		return n != 0
	}
	if s, ok := v.(string); ok {
		return s != ""
	}
	return true
}
