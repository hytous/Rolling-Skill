import {Alert, Tag, Typography} from "antd"

import type {CodexEvidenceView} from "./codexEvidence"

const {Text} = Typography

const ValueRow = ({label, value}: {label: string; value: React.ReactNode}) => (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-start gap-2 text-xs">
        <Text type="secondary">{label}</Text>
        <div className="min-w-0 break-words">{value}</div>
    </div>
)

const statusColor = (status?: string): string => {
    if (status === "INVALID_TRACE" || status === "CANCELLED") return "error"
    if (status === "READY_FOR_EVALUATION") return "processing"
    if (status === "PENDING_TERMINAL") return "warning"
    return "default"
}

const CodexEvidencePanel = ({evidence}: {evidence: CodexEvidenceView}) => {
    const counts = [
        ["Events", evidence.counts.events],
        ["Payloads", evidence.counts.payloads],
        ["Tool calls", evidence.counts.toolCalls],
        ["Tool errors", evidence.counts.toolErrors],
        ["Open objects", evidence.counts.openRuntimeObjects],
    ].filter((entry): entry is [string, number] => entry[1] !== undefined)

    return (
        <div className="flex flex-col gap-3">
            {evidence.diagnosticOnly ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Diagnostic evidence only"
                    description="The evaluated runtime can write to the same trace files. Use this evidence to inspect Skill execution and latency, not as a trusted A-class score."
                />
            ) : null}

            <div className="flex flex-col gap-2">
                {evidence.collectionStatus ? (
                    <ValueRow
                        label="Collection"
                        value={
                            <Tag color={statusColor(evidence.collectionStatus)}>
                                {evidence.collectionStatus}
                            </Tag>
                        }
                    />
                ) : null}
                {evidence.completeness ? (
                    <ValueRow label="Completeness" value={evidence.completeness} />
                ) : null}
                {evidence.sourceTrust ? (
                    <ValueRow label="Source trust" value={evidence.sourceTrust} />
                ) : null}
                {evidence.schemaVersion ? (
                    <ValueRow label="Schema" value={evidence.schemaVersion} />
                ) : null}
                {counts.length > 0 ? (
                    <ValueRow
                        label="Observed"
                        value={counts.map(([label, value]) => `${label} ${value}`).join(" · ")}
                    />
                ) : null}
                {evidence.reasonCodes.length > 0 ? (
                    <ValueRow
                        label="Reasons"
                        value={
                            <div className="flex flex-wrap gap-1">
                                {evidence.reasonCodes.map((reason) => (
                                    <Tag key={reason} className="!m-0 font-mono text-[11px]">
                                        {reason}
                                    </Tag>
                                ))}
                            </div>
                        }
                    />
                ) : null}
                {evidence.digest ? (
                    <ValueRow
                        label="Digest"
                        value={
                            <Text copyable={{text: evidence.digest}} code>
                                {evidence.digest}
                            </Text>
                        }
                    />
                ) : null}
                {evidence.artifactRef ? (
                    <ValueRow
                        label="Artifact"
                        value={
                            <Text copyable={{text: evidence.artifactRef}} code>
                                {evidence.artifactRef}
                            </Text>
                        }
                    />
                ) : null}
            </div>
        </div>
    )
}

export default CodexEvidencePanel
