// Command gen writes the Go and TypeScript code for the engine's
// cross-language contracts in shared/common/contracts. Each contract is one
// JSON file; the generator refuses unknown keys and contradictory entries, so
// a mistake in the contract stops generation instead of reaching the code.
//
// Usage (scripts/gen-contracts.sh runs every contract):
//
//	gen platform-gateway <contract.json> <go-output> <ts-output>
package main

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

// generator turns the arguments after the contract name into written files.
type generator struct {
	usage string
	run   func(args []string) error
}

func generators() map[string]generator {
	return map[string]generator{
		"platform-gateway": {
			usage: "platform-gateway <contract.json> <go-output> <ts-output>",
			run:   runPlatformGateway,
		},
	}
}

func main() {
	if err := dispatch(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "gen:", err)
		os.Exit(1)
	}
}

func dispatch(args []string) error {
	known := generators()
	if len(args) == 0 {
		return fmt.Errorf("usage: gen <contract> ...; contracts: %s", strings.Join(contractNames(known), ", "))
	}
	g, ok := known[args[0]]
	if !ok {
		return fmt.Errorf("unknown contract %q; contracts: %s", args[0], strings.Join(contractNames(known), ", "))
	}
	if err := g.run(args[1:]); err != nil {
		return fmt.Errorf("%s: %w", args[0], err)
	}
	return nil
}

func contractNames(known map[string]generator) []string {
	names := make([]string, 0, len(known))
	for name := range known {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func runPlatformGateway(args []string) error {
	if len(args) != 3 {
		return fmt.Errorf("usage: gen %s", generators()["platform-gateway"].usage)
	}
	contractPath, goPath, tsPath := args[0], args[1], args[2]
	raw, err := os.ReadFile(contractPath)
	if err != nil {
		return fmt.Errorf("reading contract: %w", err)
	}
	contract, err := parsePlatformGateway(raw)
	if err != nil {
		return fmt.Errorf("%s: %w", contractPath, err)
	}
	goSource, err := emitGo(contract)
	if err != nil {
		return err
	}
	tsSource, err := emitTS(contract)
	if err != nil {
		return err
	}
	if err := os.WriteFile(goPath, goSource, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", goPath, err)
	}
	if err := os.WriteFile(tsPath, tsSource, 0o644); err != nil {
		return fmt.Errorf("writing %s: %w", tsPath, err)
	}
	return nil
}
