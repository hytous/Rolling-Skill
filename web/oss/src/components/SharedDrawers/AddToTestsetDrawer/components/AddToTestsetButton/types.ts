import {ButtonProps} from "antd"
import {KeyValuePair} from "tailwindcss/types/config"

import type {CaseCaptureType} from "../../assets/caseCapture"

export interface AddToTestsetButtonProps extends ButtonProps {
    label?: string
    icon?: boolean
    children?: React.ReactNode
    /** Span IDs to open drawer with - preferred approach (fetches from entity cache) */
    spanIds?: string[]
    /** Resolve this trace's root span lazily when the operator clicks. */
    traceId?: string
    /** Enable manual evaluation-case classification and provenance columns. */
    caseCapture?: boolean
    defaultCaseType?: CaseCaptureType
    /** @deprecated Use spanIds instead - legacy prop for backward compatibility */
    testsetData?: {
        data: KeyValuePair
        key: string
        id: number
    }[]
}
