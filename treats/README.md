# Rules Engine Architecture Overview

## Core Components

### Event Processing Pipeline
- Raw events flow through an ingestion layer that determines which facts need updating
- Events are batched for efficiency and processed incrementally
- Only affected facts are recomputed to avoid unnecessary work

### Fact Management System
- Facts are versioned and indexed by entity (user) and fact type
- Support for direct facts (field extraction), aggregated facts (sum, count, avg), and derived facts (computed from other facts)
- Incremental updates for aggregations to avoid full recomputation
- Three-tier storage: hot facts in memory, warm facts compressed, cold facts in database
- Database-driven fact definitions with configurable computation from various data sources

### Rules Engine with Smart Evaluation
- Rules contain conditions that reference facts and actions to execute when satisfied
- Rule states are cached with version tracking to avoid re-evaluation
- Only rules with invalidated dependencies are re-evaluated
- Dependency graph tracks which rules depend on which fact types

### Rete Algorithm Integration
- Precompiled rule networks using Rete algorithm for efficient pattern matching
- Alpha nodes filter individual facts by type and conditions
- Beta nodes join multiple conditions with shared computation
- Hybrid approach: simple rules use direct evaluation, complex rules use Rete network
- Per-user segment networks to share compiled patterns across similar users

### Database-Driven Configuration
- Dynamic rule definitions stored in database tables (criteria_definitions, criteria_conditions)
- User-specific rule assignments through user_criteria_assignments table
- Fact definitions with configurable computation types (direct, aggregation, derived)
- Real-time configuration changes with cache invalidation and network recompilation

### User Fact Graph Caching
- Per-user fact graphs stored in tiered memory system (hot/warm/cold)
- LRU eviction with intelligent scoring based on recency, frequency, and memory size
- Predictive preloading based on user activity patterns
- Compression using bincode + lz4 for warm storage

## Data Flow

**Event Ingestion** → **Fact Updates** → **Rule Invalidation** → **Rete Network Processing** → **Selective Rule Evaluation** → **Action Execution**

### Database Integration Flow
**Configuration Changes** → **Cache Invalidation** → **Network Recompilation** → **User Re-evaluation**

## Key Optimizations

### Incremental Processing
- Only update facts that depend on incoming events
- Only invalidate rules that depend on changed facts
- Cache rule evaluation results until dependencies change

### Smart Caching Strategy
- Version-based staleness detection prevents unnecessary rule re-evaluation
- Dependency tracking enables surgical invalidation of only affected rules
- Memory pressure-based eviction keeps working set in memory

### Performance Features
- Batched event processing to amortize overhead
- Rule condition short-circuiting for early termination
- Indexed rule lookup by fact type for efficient candidate selection
- Background preloading of likely-to-be-accessed user graphs
- Rete network shared computation eliminates redundant condition checking
- Database bulk operations for multi-user fact computation
- Configuration caching with TTL-based invalidation

## Scalability Characteristics

- **Per-user partitioning** enables horizontal scaling
- **Memory-efficient** through compression and intelligent eviction
- **Event-driven** architecture supports real-time processing
- **Dependency-aware** evaluation prevents cascading recomputation
- **Database-driven configuration** allows dynamic rule changes without code deployment
- **Rete network compilation** scales efficiently with rule complexity
- **User segmentation** enables shared pattern matching across similar user groups

## Database Schema

### Configuration Tables
- `fact_definitions`: Define computation types and data sources for facts
- `criteria_definitions`: Store rule definitions with associated actions
- `criteria_conditions`: Define fact-based conditions for each criteria
- `user_criteria_assignments`: Map users to applicable criteria

### Runtime Tables  
- `user_facts`: Cache computed fact values per user with versioning
- `user_criteria_states`: Track criteria satisfaction state and evaluation metadata
