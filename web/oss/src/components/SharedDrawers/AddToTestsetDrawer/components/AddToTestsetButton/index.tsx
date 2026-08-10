import {
    cloneElement,
    isValidElement,
    ReactElement,
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react"

import {traceEntityAtomFamily, traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {message} from "@agenta/ui/app-message"
import {EnhancedButton} from "@agenta/ui/components/presentational"
import {Database} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {closeDrawerAtom, isDrawerOpenAtom, openDrawerWithSpanIdsAtom} from "../../atoms/drawerState"
import TestsetDrawer from "../../TestsetDrawer"

import {AddToTestsetButtonProps} from "./types"

const AddToTestsetButton = ({
    label,
    icon = true,
    children,
    spanIds,
    traceId,
    caseCapture = false,
    defaultCaseType = "badcase",
    testsetData,
    disabled,
    loading,
    ...props
}: AddToTestsetButtonProps) => {
    const [isDrawerOpen, setIsDrawerOpen] = useAtom(isDrawerOpenAtom)
    const [ownsDrawer, setOwnsDrawer] = useState(false)
    const [resolveRequested, setResolveRequested] = useState(false)
    const [resolvedSpanIds, setResolvedSpanIds] = useState<string[]>(spanIds ?? [])
    const openDrawerWithSpanIds = useSetAtom(openDrawerWithSpanIdsAtom)
    const closeDrawer = useSetAtom(closeDrawerAtom)
    const traceQuery = useAtomValue(
        traceEntityAtomFamily(resolveRequested ? (traceId ?? null) : null),
    )
    const rootSpan = useAtomValue(
        traceRootSpanAtomFamily(resolveRequested ? (traceId ?? null) : null),
    )

    useEffect(() => {
        if (!resolveRequested || !rootSpan?.span_id) return
        const nextSpanIds = [rootSpan.span_id]
        setResolvedSpanIds(nextSpanIds)
        setOwnsDrawer(true)
        setResolveRequested(false)
        openDrawerWithSpanIds(nextSpanIds)
    }, [openDrawerWithSpanIds, resolveRequested, rootSpan?.span_id])

    useEffect(() => {
        if (!resolveRequested || !traceQuery.isError) return
        setResolveRequested(false)
        message.error("The run trace is not available yet. Try again in a moment.")
    }, [resolveRequested, traceQuery.isError])

    useEffect(() => {
        if (!resolveRequested || !traceQuery.isSuccess || rootSpan) return
        setResolveRequested(false)
        message.error("The run trace has no span data to save.")
    }, [resolveRequested, rootSpan, traceQuery.isSuccess])

    // Handle click - prefer spanIds over testsetData
    const handleClick = useCallback(
        (e?: React.MouseEvent) => {
            e?.preventDefault()
            e?.stopPropagation()

            if (spanIds && spanIds.length > 0) {
                // Preferred: open drawer with span IDs (fetches from entity cache)
                setResolvedSpanIds(spanIds)
                setOwnsDrawer(true)
                openDrawerWithSpanIds(spanIds)
            } else if (traceId) {
                setResolveRequested(true)
            } else {
                // Legacy: just open drawer, data will be passed via props
                setOwnsDrawer(true)
                setIsDrawerOpen(true)
            }
        },
        [spanIds, traceId, openDrawerWithSpanIds, setIsDrawerOpen],
    )

    const caseCaptureConfig = useMemo(
        () =>
            caseCapture && traceId && resolvedSpanIds[0]
                ? {
                      sourceTraceId: traceId,
                      sourceSpanId: resolvedSpanIds[0],
                      defaultCaseType,
                  }
                : undefined,
        [caseCapture, defaultCaseType, resolvedSpanIds, traceId],
    )

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as ReactElement<{
                        onClick: () => void
                        disabled?: boolean
                        loading?: AddToTestsetButtonProps["loading"]
                    }>,
                    {
                        onClick: handleClick,
                        disabled: disabled || resolveRequested,
                        loading: loading || resolveRequested,
                    },
                )
            ) : (
                <EnhancedButton
                    label={label}
                    icon={icon && <Database size={14} />}
                    onClick={handleClick}
                    disabled={disabled || resolveRequested}
                    loading={loading || resolveRequested}
                    {...props}
                />
            )}

            {ownsDrawer ? (
                <TestsetDrawer
                    open={isDrawerOpen}
                    spanIds={resolvedSpanIds}
                    caseCapture={caseCaptureConfig}
                    showSelectedSpanText={false}
                    onClose={() => {
                        closeDrawer()
                        setOwnsDrawer(false)
                    }}
                />
            ) : null}
        </>
    )
}

export default AddToTestsetButton
