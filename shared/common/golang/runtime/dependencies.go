package runtime

import (
	"fmt"
	"sort"
)

type DependencyGraph struct {
	services map[string]any
	adjList  map[string][]string
}

func NewDependencyGraph() *DependencyGraph {
	return &DependencyGraph{
		services: make(map[string]any),
		adjList:  make(map[string][]string),
	}
}

func (g *DependencyGraph) AddService(name string, svc any) error {
	if _, exists := g.services[name]; exists {
		return fmt.Errorf("service %s already registered", name)
	}

	g.services[name] = svc
	
	// Get dependencies using type assertion
	if typedSvc, ok := svc.(interface{ Dependencies() []string }); ok {
		g.adjList[name] = typedSvc.Dependencies()
	} else {
		g.adjList[name] = []string{}
	}

	return nil
}

func (g *DependencyGraph) Validate() error {
	for name, deps := range g.adjList {
		for _, dep := range deps {
			if _, exists := g.services[dep]; !exists {
				return fmt.Errorf("service %s declares dependency on %s which is not registered", name, dep)
			}
		}
	}

	visited := make(map[string]bool)
	recStack := make(map[string]bool)

	for name := range g.services {
		if err := g.detectCycle(name, visited, recStack); err != nil {
			return err
		}
	}

	return nil
}

func (g *DependencyGraph) detectCycle(name string, visited, recStack map[string]bool) error {
	visited[name] = true
	recStack[name] = true

	for _, dep := range g.adjList[name] {
		if !visited[dep] {
			if err := g.detectCycle(dep, visited, recStack); err != nil {
				return err
			}
		} else if recStack[dep] {
			return fmt.Errorf("circular dependency detected: %s -> %s", name, dep)
		}
	}

	recStack[name] = false
	return nil
}

func (g *DependencyGraph) GetServiceBatches() ([][]any, error) {
	if err := g.Validate(); err != nil {
		return nil, err
	}

	inDegree := make(map[string]int)
	for name, deps := range g.adjList {
		inDegree[name] = len(deps)
	}

	batches := [][]any{}
	processed := make(map[string]bool)

	for len(processed) < len(g.services) {
		batch := []string{}
		for name, degree := range inDegree {
			if degree == 0 && !processed[name] {
				batch = append(batch, name)
			}
		}

		if len(batch) == 0 {
			return nil, fmt.Errorf("circular dependency detected during topological sort")
		}

		sort.Strings(batch)

		serviceBatch := []any{}
		for _, name := range batch {
			serviceBatch = append(serviceBatch, g.services[name])
			processed[name] = true
		}

		batches = append(batches, serviceBatch)

		for _, name := range batch {
			for serviceName, deps := range g.adjList {
				for _, dep := range deps {
					if dep == name && !processed[serviceName] {
						inDegree[serviceName]--
					}
				}
			}
		}
	}

	return batches, nil
}
