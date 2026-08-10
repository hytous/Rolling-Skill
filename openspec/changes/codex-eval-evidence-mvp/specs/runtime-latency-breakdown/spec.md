## ADDED Requirements

### Requirement: Native observable timing source
Latency calculations SHALL use native event wall-clock timestamps and runner lifecycle marks. The output SHALL name provider request/stream duration as provider sampling or provider wait and SHALL NOT call it hidden thinking or reasoning time.

#### Scenario: An inference interval is observed
- **WHEN** inference start and terminal events have valid timestamps
- **THEN** the report attributes that interval to provider sampling/wait with its event locators

### Requirement: Interval-union aggregation
The analyzer SHALL calculate elapsed duration for a category as the union of its intervals rather than the arithmetic sum, so overlapping tool calls, child agents, or provider operations are not double-counted. Invalid negative intervals SHALL make the affected metric unavailable with a reason code.

#### Scenario: Two tools overlap
- **WHEN** tool A runs from 0-100 ms and tool B runs from 50-150 ms
- **THEN** aggregate tool wall time is 150 ms and summed work is separately reported as 200 ms

#### Scenario: An interval ends before it starts
- **WHEN** a terminal event timestamp precedes its matching start
- **THEN** the analyzer marks the metric invalid rather than clamping or silently reordering it

### Requirement: Critical-path-aware attribution
The analyzer SHALL derive a critical path across root turns, inference calls, tools, terminal operations, code cells, and child-agent lifecycles using parent/causal identifiers and temporal containment. The report SHALL distinguish critical-path elapsed time from parallel off-path work.

#### Scenario: Parallel child work is off the critical path
- **WHEN** a child finishes before another blocking branch that determines root completion
- **THEN** the child contributes to total work but not beyond its overlap on the critical-path elapsed duration

### Requirement: Complete wall-time accounting
The report SHALL include total wall time, acquisition/setup when runner marks exist, provider interval union, tool interval union, child-agent interval union, trace finalization, unattributed wall time, summed work, and critical-path duration. Categories MAY overlap and therefore SHALL include documented overlap semantics rather than being presented as additive percentages.

#### Scenario: Some time has no classified interval
- **WHEN** total wall time exceeds the union of classified observable intervals
- **THEN** the difference is reported as unattributed runtime overhead and not guessed to be model reasoning

### Requirement: Bottleneck ranking with evidence
The analyzer SHALL rank slow phases using critical-path contribution first and interval-union wall time second. Each reported bottleneck SHALL cite the responsible lifecycle object and interval, and SHALL distinguish retries, queue/wait, provider sampling, tool execution, child-agent work, and trace finalization when observable.

#### Scenario: A retry dominates elapsed time
- **WHEN** repeated provider attempts occupy the largest critical-path interval
- **THEN** the bottleneck report identifies provider retries and their attempt intervals rather than aggregating them into an unexplained model duration

### Requirement: Deterministic latency output
For the same validated ordered evidence, the analyzer SHALL emit the same millisecond values, interval ordering, critical-path choice, and tie-breaking result.

#### Scenario: Two bottlenecks tie
- **WHEN** two phases have equal critical-path contribution and union duration
- **THEN** the analyzer uses stable event sequence and identifier ordering to break the tie
