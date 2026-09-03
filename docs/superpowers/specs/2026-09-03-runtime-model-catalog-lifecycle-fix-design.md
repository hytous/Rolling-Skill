# Runtime Model Catalog Lifecycle Fix

## Problem

The self-operation workbench loads model catalogs for every discovered Runtime. For a Runtime that is not currently active, the App creates a temporary client, starts `listModels()`, and enters `finally` without awaiting that request. The temporary client is therefore stopped while the request is still pending. Its normal exit with code 0 rejects the pending request and is surfaced as a global “Task could not continue” error.

## Chosen Design

Keep the existing eager catalog loading and temporary-client ownership model. Await the temporary client's model-list request inside the `try` block so `finally` cannot stop the client until the request has either completed or failed. Continue stopping the client on both success and failure.

Do not reinterpret every exit code 0 as success: an App Server that exits while it is expected to serve requests is still an error. The lifecycle ordering, not the exit classification, is the root cause.

## Alternatives Rejected

- Load catalogs only after a Runtime is selected. This reduces background work but changes workbench behavior and only avoids the lifecycle defect.
- Add retries or special-case exit code 0. This can hide deterministic client shutdown bugs and leave pending requests unresolved.

## Verification

Add a focused regression test around `listModelsForRuntimeFromControl` using a deferred model-list request. The test must prove that `stop()` is not called while the request is pending, that the model result is returned, and that the temporary client is stopped exactly once after settlement. Run the focused test, the desktop test suite, renderer smoke test, tool build, and macOS App build. Reinstall the App and verify that opening the self-operation workbench loads Runtime catalogs without the global error.
