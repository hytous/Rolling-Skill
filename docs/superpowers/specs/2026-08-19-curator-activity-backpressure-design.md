# Curator Activity Backpressure Design

## Goal

Prevent Case Draft, Case calibration, and Rubric Agent progress reporting from flooding Electron IPC and blocking the renderer while keeping meaningful progress visible.

## Root cause

DeepSeek Harness emits a reasoning item update for every reasoning chunk. CurationManager and RubricManager currently convert every update into a new activity object and synchronously forward it through Electron IPC. The renderer then performs DOM queries and writes for every event even when stage and summary did not change. This event and DOM-write flood can make macOS show the busy cursor.

## Design

Add a shared main-process activity coalescer. The first event and every visible stage/summary change are emitted immediately. Repeated identical activity updates retain the newest timestamp but are emitted at most once per 250ms window. Terminal events cancel pending work and emit immediately. Both Curator and Rubric managers use the same component.

The renderer adds a final keyed queue for Curator and Rubric activity-card patches. It coalesces any residual same-frame IPC events without rebuilding either drawer. Terminal activity is flushed immediately so completed/failed state never lingers.

## Compatibility

Activity payloads and persistence remain unchanged. The change affects only delivery frequency. No reasoning text, shell output, or trace data is added to Case Drafts.

