## ADDED Requirements

### Requirement: DSH remains a standard plugin distribution
The DSH artifact SHALL install through `dsh plugin add`, retain valid Cordis Host/Client/Worker manifests, and MUST NOT contain Electron, Chromium, `.app`, Electron Framework, native desktop executables, user-specific absolute paths, or unrelated runtime bundles.

#### Scenario: Package inspection
- **WHEN** the DSH tarball is built
- **THEN** inspection reports packed/unpacked bytes and files and rejects prohibited contents without applying an arbitrary fixed byte limit

#### Scenario: Plugin install
- **WHEN** the built tarball is force-installed into the local web profile and DSH is restarted
- **THEN** the installed bundle version/content matches the newly built artifact and all registered slots and Host tools load

### Requirement: Electron remains a separate macOS App distribution
The Electron archive branch SHALL receive the managed-Skill domain repair, pass its complete regression suite, build the macOS App and adjacent CLI, verify signing, and install the resulting App for user inspection.

#### Scenario: Electron build and install
- **WHEN** the archive-branch implementation passes verification
- **THEN** the new App is built, signature-checked, installed to the agreed local destination, and launches with the repaired Dataset behavior

### Requirement: Data roots remain isolated and user-owned data is preserved
DSH and Electron SHALL keep separate product data roots. Build, install, upgrade, import inspection, and rollback MUST NOT move or delete existing user data.

#### Scenario: Legacy import
- **WHEN** the user explicitly confirms Electron legacy import into an empty compatible DSH root
- **THEN** schemas are validated and data is copied while the Electron source remains unchanged

#### Scenario: Ordinary plugin or App install
- **WHEN** either binary is replaced
- **THEN** no product data directory is deleted, renamed, or merged

### Requirement: Delivery requires real-surface verification
Automated tests alone SHALL NOT complete delivery. The DSH artifact SHALL receive real browser checks and the Electron artifact SHALL receive renderer smoke plus installed App checks for the capability families assigned to each surface.

#### Scenario: Final delivery report
- **WHEN** both artifacts have been installed
- **THEN** the report records commands, versions, package/signature results, UI evidence, parity ledger status, and rollback locations
